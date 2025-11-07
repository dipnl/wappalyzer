'use strict'

const Wappalyzer = require('../../wappalyzer')
const { loadConfig } = require('../config')
const { sleep, limitHtml } = require('../utils')
const { launchOrConnect } = require('./browser')
const { analyze, resolve } = require('./analyze')
const { analyzeJs, analyzeDom } = require('./analyze-helpers')
const { collectPageData } = require('./pageData')
const { reduceLinks } = require('./links')

const { setTechnologies, setCategories } = Wappalyzer

const config = loadConfig()
setTechnologies(config.technologies)
setCategories(config.categoryMap)

const BASE_TECHNOLOGIES = Wappalyzer.technologies || []
const REQUIRE_BY_TECH = Array.isArray(Wappalyzer.requires) ? Wappalyzer.requires : []
const REQUIRE_BY_CATEGORY = Array.isArray(Wappalyzer.categoryRequires)
  ? Wappalyzer.categoryRequires
  : []

function dedupeByName(list = []) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    if (!item || !item.name) continue
    if (seen.has(item.name)) continue
    seen.add(item.name)
    out.push(item)
  }
  return out
}

const DEPENDENT_TECHNOLOGIES = dedupeByName(
  REQUIRE_BY_TECH.flatMap((entry) => entry.technologies || []).concat(
    REQUIRE_BY_CATEGORY.flatMap((entry) => entry.technologies || [])
  )
)

const ALL_TECHNOLOGIES = dedupeByName([
  ...BASE_TECHNOLOGIES,
  ...DEPENDENT_TECHNOLOGIES,
])

const DEFAULT_OPTIONS = {
  batchSize: 5,
  debug: false,
  delay: 500,
  fast: false,
  htmlMaxCols: 2000,
  htmlMaxRows: 3000,
  maxDepth: 3,
  maxUrls: 10,
  maxWait: 30000,
  noRedirect: false,
  noScripts: false,
  recursive: false,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  headers: {},
}

function normaliseInteger(value, fallback) {
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

class Driver {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    }

    this.options.batchSize = normaliseInteger(this.options.batchSize, DEFAULT_OPTIONS.batchSize)
    this.options.delay = normaliseInteger(this.options.delay, DEFAULT_OPTIONS.delay)
    this.options.htmlMaxCols = normaliseInteger(
      this.options.htmlMaxCols,
      DEFAULT_OPTIONS.htmlMaxCols
    )
    this.options.htmlMaxRows = normaliseInteger(
      this.options.htmlMaxRows,
      DEFAULT_OPTIONS.htmlMaxRows
    )
    this.options.maxDepth = normaliseInteger(this.options.maxDepth, DEFAULT_OPTIONS.maxDepth)
    this.options.maxUrls = normaliseInteger(this.options.maxUrls, DEFAULT_OPTIONS.maxUrls)
    this.options.maxWait = normaliseInteger(this.options.maxWait, DEFAULT_OPTIONS.maxWait)

    this.options.fast = Boolean(+this.options.fast || this.options.fast)
    this.options.debug = Boolean(+this.options.debug || this.options.debug)
    this.options.noScripts = Boolean(+this.options.noScripts || this.options.noScripts)
    this.options.recursive = Boolean(+this.options.recursive || this.options.recursive)
    this.options.noRedirect = Boolean(+this.options.noRedirect || this.options.noRedirect)

    this.options.headers = this.options.headers || {}

    this.browser = null
    this.destroyed = false

    this.baseTechnologies = BASE_TECHNOLOGIES
    this.dependentByTechnology = REQUIRE_BY_TECH
    this.dependentByCategory = REQUIRE_BY_CATEGORY
    this.allTechnologies = ALL_TECHNOLOGIES
  }

  async init() {
    if (this.browser) return
    this.browser = await launchOrConnect({
      fast: this.options.fast,
      maxWait: this.options.maxWait,
      proxy: this.options.proxy,
    })
  }

  async destroy() {
    if (this.destroyed) return
    this.destroyed = true
    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
    }
  }

  async open(url, headers = {}, storage = {}) {
    const site = new Site(url, headers, storage, this)
    await site.prepareStorage()
    return site
  }
}

class Site {
  constructor(url, headers, storage, driver) {
    this.driver = driver
    try {
      this.originalUrl = new URL(url)
    } catch (error) {
      throw new Error(`Invalid URL: ${url}`)
    }

    this.extraHeaders = headers || {}
    this.storage = storage || { local: {}, session: {} }

    this.analyzedUrls = {}
    this.cookieNameSet = new Set()
    this.detections = []

    this.context = null
    this.pages = new Set()

    this.requireChecks = new Set()
  }

  async prepareStorage() {
    const needsStorage =
      (this.storage.local && Object.keys(this.storage.local).length) ||
      (this.storage.session && Object.keys(this.storage.session).length)

    if (!needsStorage) return

    const page = await this._createPage()
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      request.respond({ status: 200, contentType: 'text/plain', body: 'ok' })
    })

    try {
      await page.goto(this.originalUrl.href, {
        waitUntil: 'domcontentloaded',
        timeout: this.driver.options.maxWait,
      })
    } catch (_) {
      // ignore navigation errors while seeding storage
    }

    await page.evaluate((storage) => {
      const apply = (type) => {
        const obj = storage[type] || {}
        const target = window[`${type}Storage`]
        if (!target) return
        Object.keys(obj).forEach((key) => {
          try {
            target.setItem(key, obj[key])
          } catch (_) {
            // continue
          }
        })
      }

      apply('local')
      apply('session')
    }, this.storage)

    await page.close().catch(() => {})
    this.pages.delete(page)
  }

  async analyze() {
    await this.driver.init()

    const queue = [{ url: this.originalUrl, depth: 0 }]
    const seen = new Set()

    while (queue.length) {
      if (Object.keys(this.analyzedUrls).length >= this.driver.options.maxUrls) break

      const { url, depth } = queue.shift()
      const key = url.href
      if (seen.has(key)) continue
      seen.add(key)

      try {
        const links = await this.visit(url, depth)
        if (this.driver.options.recursive && depth < this.driver.options.maxDepth - 1) {
          for (const link of links) {
            if (Object.keys(this.analyzedUrls).length + queue.length >= this.driver.options.maxUrls) {
              break
            }
            queue.push({ url: link, depth: depth + 1 })
          }
        }
      } catch (error) {
        this.analyzedUrls[key] = this.analyzedUrls[key] || {}
        this.analyzedUrls[key].error = error.message || String(error)
      }
    }

    return this._buildResult()
  }

  async visit(url, depth) {
    const key = url.href
    if (this.analyzedUrls[key]) return []

    const timings = {}
    const visitStart = Date.now()

    const page = await this._createPage()

    await page.setRequestInterception(true)
    const allowedTypes = ['document', 'xhr', 'fetch']
    if (!this.driver.options.noScripts) allowedTypes.push('script')

    page.on('request', (request) => {
      if (
        request.isNavigationRequest() ||
        (request.frame() === page.mainFrame() && allowedTypes.includes(request.resourceType()))
      ) {
        const requestHeaders = {
          ...request.headers(),
          ...this.driver.options.headers,
          ...this.extraHeaders,
        }
        request.continue({ headers: requestHeaders }).catch(() => {})
      } else {
        request.abort('blockedbyclient').catch(() => {})
      }
    })

    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}))

    const navStart = Date.now()
    const response = await page.goto(url.href, {
      waitUntil: this.driver.options.fast ? 'domcontentloaded' : 'load',
      timeout: this.driver.options.maxWait,
    })
    timings.nav = Date.now() - navStart

    const status = response ? response.status() : 0
    const headers = response ? response.headers() : {}

    this.analyzedUrls[key] = { status, headers, depth }

    const cookiesList = await page.cookies().catch(() => [])
    const cookies = {}
    const cookieNames = []
    for (const cookie of cookiesList) {
      const name = (cookie.name || '').toLowerCase()
      if (!cookies[name]) cookies[name] = []
      cookies[name].push(cookie.value)
      cookieNames.push(cookie.name)
      this.cookieNameSet.add(cookie.name)
    }

    let html = await page.content()
    if (this.driver.options.htmlMaxCols && this.driver.options.htmlMaxRows) {
      html = limitHtml(html, {
        maxCols: this.driver.options.htmlMaxCols,
        maxRows: this.driver.options.htmlMaxRows,
      })
    }

    const dataStart = Date.now()
    const pageData = await collectPageData(
      page,
      this.driver.options,
      this.driver.allTechnologies,
      this._withTimeout.bind(this)
    )
    timings.capture = Date.now() - dataStart

    const detections = this._runAnalysis(
      {
        url,
        html,
        cookies,
        cookieNames,
        ...pageData,
      },
      this.driver.baseTechnologies
    )

    this._addDetections(url, detections)

    this._runDependentAnalyses(url, pageData, {
      html,
      cookies,
      cookieNames,
    })

    await page.close().catch(() => {})
    this.pages.delete(page)

    timings.total = Date.now() - visitStart
    this.analyzedUrls[key].timings = timings

    const links = reduceLinks(pageData.links || [], url)
    return links
  }

  _runAnalysis(data, technologies) {
    const { url, html, cookies, cookieNames, text, css, scripts, scriptSrc, meta, js, dom } = data

    const results = []

    if (dom && dom.length) {
      results.push(...analyzeDom(dom, technologies))
    }
    if (js && js.length) {
      results.push(...analyzeJs(js, technologies))
    }
    results.push(
      ...analyze(
        {
          url,
          html,
          cookies,
          cookieNames,
          text,
          css,
          scripts,
          scriptSrc,
          meta,
        },
        technologies
      )
    )

    return results
  }

  _runDependentAnalyses(url, pageData, baseSignals) {
    const data = {
      url,
      ...baseSignals,
      ...pageData,
    }

    let updated = false
    do {
      updated = false
      const resolved = resolve(this.detections)
      const detectedNames = new Set(resolved.map(({ name }) => name))
      const detectedCategoryIds = new Set(
        resolved.flatMap((entry) => (entry.categories || []).map((cat) => cat.id))
      )

      for (const entry of this.driver.dependentByTechnology) {
        if (!detectedNames.has(entry.name)) continue
        if (this.requireChecks.has(`tech:${entry.name}`)) continue
        this.requireChecks.add(`tech:${entry.name}`)
        const detections = this._runAnalysis(data, entry.technologies || [])
        const added = this._addDetections(url, detections)
        if (added) updated = true
      }

      for (const entry of this.driver.dependentByCategory) {
        if (!detectedCategoryIds.has(entry.categoryId)) continue
        const key = `cat:${entry.categoryId}`
        if (this.requireChecks.has(key)) continue
        this.requireChecks.add(key)
        const detections = this._runAnalysis(data, entry.technologies || [])
        const added = this._addDetections(url, detections)
        if (added) updated = true
      }
    } while (updated)
  }

  _addDetections(url, detections) {
    const existing = new Map(
      this.detections.map((det) => [Site._detectionKey(det), det])
    )

    let added = false
    for (const detection of detections) {
      if (!detection || !detection.technology) continue
      const key = Site._detectionKey(detection)
      if (existing.has(key)) continue
      detection.lastUrl = url.href
      detection.rootPath = url.pathname === '/'
      this.detections.push(detection)
      existing.set(key, detection)
      added = true
    }
    return added
  }

  async _createPage() {
    if (!this.driver.browser) {
      await this.driver.init()
    }

    if (!this.context && this.driver.browser && this.driver.browser.createIncognitoBrowserContext) {
      try {
        this.context = await this.driver.browser.createIncognitoBrowserContext()
      } catch (_) {
        this.context = null
      }
    }

    const page = this.context
      ? await this.context.newPage()
      : await this.driver.browser.newPage()

    await page.setUserAgent(this.driver.options.userAgent)
    await page.setJavaScriptEnabled(!this.driver.options.noScripts)
    page.setDefaultTimeout(this.driver.options.maxWait)

    this.pages.add(page)

    return page
  }

  _withTimeout(promise, fallback, label) {
    const maxWait = this.driver.options.fast
      ? Math.min(this.driver.options.maxWait, 2000)
      : this.driver.options.maxWait

    return Promise.race([
      promise,
      sleep(maxWait).then(() => {
        if (fallback !== undefined) {
          return fallback
        }
        throw new Error(`Timeout (${label || 'operation'})`)
      }),
    ])
  }

  _buildResult() {
    const resolved = resolve(this.detections)

    const technologies = resolved.map(
      ({ name, slug, description, confidence, version, icon, website, cpe, categories, rootPath }) => ({
        name,
        slug,
        description,
        confidence,
        version: version || null,
        icon,
        website,
        cpe,
        categories: (categories || []).map(({ id, slug, name }) => ({ id, slug, name })),
        rootPath,
      })
    )

    return {
      urls: this.analyzedUrls,
      technologies,
      cookieNames: Array.from(this.cookieNameSet),
    }
  }

  async destroy() {
    for (const page of this.pages) {
      await page.close().catch(() => {})
    }
    this.pages.clear()
    if (this.context) {
      await this.context.close().catch(() => {})
      this.context = null
    }
  }

  static _detectionKey(detection) {
    const tech = detection.technology || {}
    const pattern = detection.pattern || {}
    return [tech.name || '', pattern.type || '', pattern.regex ? pattern.regex.toString() : '', pattern.version || ''].join('#')
  }
}

module.exports = {
  Driver,
}

