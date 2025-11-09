'use strict'

const Wappalyzer = require('../../wappalyzer')
const { loadConfig } = require('../config')
const { sleep, limitHtml } = require('../utils')
const { launchOrConnect } = require('./browser')
const { collectPageData } = require('./pageData')
const { reduceLinks } = require('./links')
const { buildRuntimeOptions } = require('../config/options')
const { DetectionStore } = require('./detections')

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

class Driver {
  constructor(options = {}) {
    const runtimeOptions = buildRuntimeOptions(options)

    this.options = runtimeOptions.driver
    this.chromium = runtimeOptions.chromium

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
    }, this.chromium)
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
    this.detectionStore = new DetectionStore()
    Object.defineProperty(this, 'detections', {
      enumerable: false,
      get: () => this.detectionStore.items,
    })

    this.context = null
    this.pages = new Set()
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

    const analysisInput = {
      url,
      html,
      cookies,
      cookieNames,
      ...pageData,
    }

    const detections = this.detectionStore.runAnalysis(
      analysisInput,
      this.driver.baseTechnologies
    )

    this.detectionStore.addDetections(url, detections)

    this.detectionStore.runDependentAnalyses(
      url,
      pageData,
      {
        html,
        cookies,
        cookieNames,
      },
      this.driver.dependentByTechnology,
      this.driver.dependentByCategory
    )

    await page.close().catch(() => {})
    this.pages.delete(page)

    timings.total = Date.now() - visitStart
    this.analyzedUrls[key].timings = timings

    const links = reduceLinks(pageData.links || [], url)
    return links
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
    return this.detectionStore.buildResult(this.analyzedUrls, this.cookieNameSet)
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
}

module.exports = {
  Driver,
}

