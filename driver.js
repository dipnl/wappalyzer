const fs = require('fs')
const dns = require('dns').promises
const path = require('path')
const Wappalyzer = require('./wappalyzer')
const { sleep, limitHtml } = require('./src/utils')
const { loadConfig } = require('./src/config')
const { getJs, getDom } = require('./src/driver/extract')
const {
  hostMatches: _hostMatches,
  isBlockedDomain: _isBlockedDomain,
  isAllowedDomain: _isAllowedDomain,
  fetchRobots: _fetchRobots,
  isAllowedByRobots: _isAllowedByRobots,
} = require('./src/driver/policies')
const { computeBackoffDelay, computeRateLimitWait } = require('./src/driver/policies')
const { launchOrConnect } = require('./src/driver/browser')
const { analyzeJs, analyzeDom } = require('./src/driver/analyze-helpers')
const { reduceLinks, applyCrawlFilters } = require('./src/driver/links')
const { get } = require('./src/driver/net')
const { collectPageData } = require('./src/driver/pageData')
const { setPageData, getPageData, getCookieNames } = require('./src/driver/cache')

const { setTechnologies, setCategories } = Wappalyzer
const { analyze, resolve } = require('./src/driver/analyze')


const { categoryMap, technologies } = loadConfig()

setTechnologies(technologies)
setCategories(categoryMap)

const xhrDebounce = []




class Driver {
  constructor(options = {}) {
    this.options = {
      batchSize: 5,
      debug: false,
      delay: 500,
      htmlMaxCols: 2000,
      htmlMaxRows: 3000,
      maxDepth: 3,
      maxUrls: 10,
      maxWait: 30000,
      recursive: false,
      probe: false,
      proxy: false,
      noScripts: false,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.97 Safari/537.36',
      extended: false,
      headers: {},
      // New optional flags (backward compatible defaults)
      blockAssets: undefined, // if undefined, will default to fast
      log: undefined, // error|warn|info|debug
      traceTimings: false,
      ...options,
    }

    this.options.debug = Boolean(+this.options.debug)
    this.options.fast = Boolean(+this.options.fast)
    this.options.recursive = Boolean(+this.options.recursive)
    this.options.probe =
      String(this.options.probe || '').toLowerCase() === 'basic'
        ? 'basic'
        : String(this.options.probe || '').toLowerCase() === 'full'
        ? 'full'
        : Boolean(+this.options.probe) && 'full'
    this.options.delay = parseInt(this.options.delay, 10)
    this.options.maxDepth = parseInt(this.options.maxDepth, 10)
    this.options.maxUrls = parseInt(this.options.maxUrls, 10)
    this.options.maxWait = parseInt(this.options.maxWait, 10)
    this.options.htmlMaxCols = parseInt(this.options.htmlMaxCols, 10)
    this.options.htmlMaxRows = parseInt(this.options.htmlMaxRows, 10)
    this.options.noScripts = Boolean(+this.options.noScripts)
    this.options.extended = Boolean(+this.options.extended)

    // Normalize new flags
    this.options.traceTimings = Boolean(+this.options.traceTimings)

    // Technology source selection (external repo support)
    this.options.wip = Boolean(+this.options.wip)
    // Paths may be provided via CLI or environment variables; if not, auto-detect repo-root prod.json/wip.json
    this.options.techProd = this.options.techProd || process.env.WAPPALYZER_TECH_PROD
    this.options.techWip = this.options.techWip || process.env.WAPPALYZER_TECH_WIP
    try {
      const cwd = process.cwd()
      if (!this.options.techProd) {
        const prodPath = path.resolve(cwd, 'prod.json')
        if (fs.existsSync(prodPath)) {
          this.options.techProd = prodPath
        }
      }
      if (!this.options.techWip) {
        const wipPath = path.resolve(cwd, 'wip.json')
        if (fs.existsSync(wipPath)) {
          this.options.techWip = wipPath
        }
      }
    } catch (e) {
      // ignore auto-detect errors
    }

    // DNT header (privacy)
    this.options.dnt = Boolean(+this.options.dnt)
    if (this.options.dnt) {
      this.options.headers = { ...(this.options.headers || {}), DNT: '1' }
    }

    // UA suffix
    if (typeof this.options.uaSuffix !== 'undefined' && this.options.uaSuffix !== false) {
      const suffix = String(this.options.uaSuffix || '').trim()
      if (suffix) {
        this.options.userAgent = `${this.options.userAgent} ${suffix}`
          .replace(/\s+/g, ' ')
          .trim()
      }
    }

    // blockAssets: default to fast when undefined; otherwise coerce to boolean
    if (typeof this.options.blockAssets === 'undefined') {
      this.options.blockAssets = !!this.options.fast
    } else {
      this.options.blockAssets = Boolean(+this.options.blockAssets)
    }
    if (typeof this.options.log === 'string') {
      const level = this.options.log.toLowerCase()
      this.options.log = ['error', 'warn', 'info', 'debug'].includes(level)
        ? level
        : undefined
    } else {
      this.options.log = undefined
    }

    // Politeness options (opt-in)
    this.options.backoff = Boolean(+this.options.backoff)
    this.options.rateLimitMs = parseInt(this.options.rateLimitMs || 0, 10)
    this.options.respectRobots = Boolean(+this.options.respectRobots)
    const parseDomains = (v) =>
      (v || '')
        .toString()
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    this.options.allowDomains = Array.isArray(this.options.allowDomains)
      ? this.options.allowDomains
      : parseDomains(this.options.allowDomains)
    this.options.blockDomains = Array.isArray(this.options.blockDomains)
      ? this.options.blockDomains
      : parseDomains(this.options.blockDomains)

    // Category filter (ids). Accept comma-separated or repeated flags
    const parseCategoryIds = (v) => {
      const arr = Array.isArray(v) ? v : (v != null ? [v] : [])
      const parts = arr
        .map(String)
        .join(',')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const ids = parts
        .map((s) => parseInt(s, 10))
        .filter((n) => !Number.isNaN(n))
      return Array.from(new Set(ids))
    }
    this.options.categoryIds = parseCategoryIds(this.options.category)

    if (this.options.proxy) {
      chromiumArgs.push(`--proxy-server=${this.options.proxy}`)
    }

    // Merge external technologies on top of bundled: prod.json by default, plus wip.json when --wip
    try {
      let merged = { ...technologies }

      // Merge prod.json if available/configured
      const prodPath = this.options.techProd
      if (prodPath && fs.existsSync(prodPath)) {
        try {
          const buf = fs.readFileSync(prodPath)
          const prodParsed = JSON.parse(buf.length ? buf : '{}')
          merged = { ...merged, ...prodParsed }
          this.log(`Merged technologies from ${prodPath} (prod overlay)`)
        } catch (e) {
          this.log(`Failed to parse prod technologies at ${prodPath}: ${e.message || e}`, 'driver', 'warn')
        }
      } else if (prodPath) {
        this.log(`Technologies file not found: ${prodPath} — skipping prod overlay`, 'driver', 'warn')
      }

      // Optionally merge wip.json if --wip is set
      if (this.options.wip) {
        const wipPath = this.options.techWip
        if (wipPath && fs.existsSync(wipPath)) {
          try {
            const buf = fs.readFileSync(wipPath)
            const wipParsed = JSON.parse(buf.length ? buf : '{}')
            merged = { ...merged, ...wipParsed }
            this.log(`Merged technologies from ${wipPath} (wip overlay)`)
          } catch (e) {
            this.log(`Failed to parse wip technologies at ${wipPath}: ${e.message || e}`, 'driver', 'warn')
          }
        } else if (wipPath) {
          this.log(`Technologies file not found: ${wipPath} — skipping wip overlay`, 'driver', 'warn')
        }
      }

      // Apply local custom overrides if present (final layer)
      if (fs.existsSync('wappalyzer-custom-technologies.json')) {
        try {
          const customBuf = fs.readFileSync('wappalyzer-custom-technologies.json')
          const customObj = JSON.parse(customBuf.length ? customBuf : '{}')
          merged = { ...merged, ...customObj }
        } catch (e) {
          this.log(`Failed to merge custom technologies: ${e.message || e}`, 'driver', 'warn')
        }
      }

      // Re-set technologies with merged overlays (if any overlay occurred, this is idempotent too)
      setTechnologies(merged)

      // Prepare active technologies filtered by category IDs if provided
      let ids = Array.isArray(this.options.categoryIds) ? this.options.categoryIds : []

      // Backward-compatible: derive categoryIds from --category flag if provided
      if (ids.length === 0 && typeof this.options.category !== 'undefined') {
        const raw = Array.isArray(this.options.category)
          ? this.options.category
          : String(this.options.category).split(',')
        ids = raw
          .map((s) => parseInt(String(s).trim(), 10))
          .filter((n) => !Number.isNaN(n))
        // De-duplicate and persist on options for downstream use/debugging
        ids = Array.from(new Set(ids))
        this.options.categoryIds = ids
      }

      if (ids.length > 0) {
        const idSet = new Set(ids)
        this.activeTechnologies = (Wappalyzer.technologies || []).filter((t) => {
          return t && Array.isArray(t.categories) && t.categories.some((cid) => idSet.has(cid))
        })
        // Basic validation: if filter yields zero, fall back to all but warn
        if (!this.activeTechnologies.length) {
          this.log(`No technologies match category filter ${ids.join(',')}. Using all technologies.`, 'driver', 'warn')
          this.activeTechnologies = Wappalyzer.technologies
        }
      } else {
        this.activeTechnologies = Wappalyzer.technologies
      }
    } catch (e) {
      this.log(`Failed to load external technologies JSON: ${e.message || e}`, 'driver', 'error')
      this.activeTechnologies = Wappalyzer.technologies
    }

    this.destroyed = false
  }

  async init() {
    for (let attempt = 1; attempt <= 2; attempt++) {
      this.log(`Launching browser (attempt ${attempt})...`)

      try {
        // Use modular launcher (env-compatible) to start or connect to Chromium
        this.browser = await launchOrConnect({
          fast: this.options.fast,
          maxWait: this.options.maxWait,
          proxy: this.options.proxy,
        })

        break
      } catch (error) {
        this.log(error)

        if (attempt >= 2) {
          throw new Error(error.message || error.toString())
        }
      }
    }

    this.browser.on('disconnected', () => {
      this.browser = undefined

      this.log('Browser disconnected')
    })
  }

  async destroy() {
    if (this.browser) {
      try {
        await sleep(1)

        await this.browser.close()

        this.log('Browser closed')
      } catch (error) {
        throw new Error(error.toString())
      }
    }
  }

  async open(url, headers = {}, storage = {}) {
    const site = new Site(url.split('#')[0], headers, this)

    if (true) {
      const page = await site.newPage(site.originalUrl)

      try {
        this.log('Clearing cookies...');
        await page._client().send('Network.clearBrowserCookies');
      }
      catch (ex) {
        this.log(ex);
      }

      this.log('Setting storage...')

      await page.setRequestInterception(true)

      page.on('request', (request) =>
        request.respond({
          status: 200,
          contentType: 'text/plain',
          body: 'ok',
        })
      )

      await page.goto(url)

      await page.evaluate((storage) => {
        ;['local', 'session'].forEach((type) => {
          Object.keys(storage[type] || {}).forEach((key) => {
            window[`${type}Storage`].setItem(key, storage[type][key])
          })
        })
      }, storage)

      try {
        await page.close()
      } catch {
        // Continue
      }
    }

    return site
  }

  log(message, source = 'driver') {
    const level = this.options.log
    const shouldLog = this.options.debug || level === 'debug' || level === 'info'
    if (shouldLog) {
      // eslint-disable-next-line no-console
      console.log(`log | ${source} |`, message)
    }
  }
}

class Site {
  constructor(url, headers = {}, driver) {
    this.driver = driver;

    this.driver.options.headers = {
      ...this.driver.options.headers,
      ...headers,
    }

    try {
      this.originalUrl = new URL(url)
    } catch (error) {
      throw new Error(error.toString())
    }

    this.analyzedUrls = {}
    this.analyzedXhr = {}
    this.analyzedRequires = {}
    this.detections = []

    this.listeners = {}

    this.pages = []
    // Use an incognito browser context per Site to isolate cookies/storage between different URLs
    this.context = null

    this.cache = {}

    this.perHost = {
      lastRequestAt: {},
      backoffUntil: {},
      robots: {},
    }

    this.probed = false
  }

  log(message, source = 'driver', type = 'log') {
    const ranks = { error: 0, warn: 1, log: 2, info: 2, debug: 3 }
    const configured = this.driver.options.log
    const allowByLevel =
      !!configured && ranks[type] <= (configured === 'error' ? 0 : configured === 'warn' ? 1 : configured === 'info' ? 2 : configured === 'debug' ? 3 : -1)

    if (this.driver.options.debug || allowByLevel) {
      // eslint-disable-next-line no-console
      const out = type === 'debug' ? 'log' : type
      console[out](`${type} | ${source} |`, message)
    }

    this.emit(type, { message, source })
  }

  error(error, source = 'driver') {
    this.log(error, source, 'error')
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }

    this.listeners[event].push(callback)
  }

  emit(event, params) {
    if (this.listeners[event]) {
      return Promise.allSettled(
        this.listeners[event].map((listener) => listener(params))
      )
    }
  }

  promiseTimeout(
    promise,
    fallback,
    errorMessage = 'Operation took too long to complete',
    maxWait = this.driver.options.fast
      ? Math.min(this.driver.options.maxWait, 2000)
      : this.driver.options.maxWait
  ) {
    let timeout = null

    if (!(promise instanceof Promise)) {
      return Promise.resolve(promise)
    }

    return Promise.race([
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
          clearTimeout(timeout)

          const error = new Error(errorMessage)

          error.code = 'PROMISE_TIMEOUT_ERROR'

          if (fallback !== undefined) {
            this.error(error)

            resolve(fallback)
          } else {
            reject(error)
          }
        }, maxWait)
      }),
      promise.then((value) => {
        clearTimeout(timeout)

        return value
      }),
    ])
  }

  // Check domain against allow/block lists
  hostMatches(domain, rule) {
    return _hostMatches(domain, rule)
  }

  isBlockedDomain(domain) {
    return _isBlockedDomain(this.driver.options, domain)
  }

  isAllowedDomain(domain, mainHost) {
    return _isAllowedDomain(this.driver.options, domain, mainHost)
  }

  async fetchRobots(url) {
    return _fetchRobots(url, this.driver.options, this.perHost)
  }

  async isAllowedByRobots(url) {
    return _isAllowedByRobots(url, this.driver.options, this.perHost)
  }

  async goto(url) {
    // Return when the URL is a duplicate or maxUrls has been reached
    if (this.analyzedUrls[url.href]) {
      return []
    }

    this.log(`Navigate to ${url}`)

    this.analyzedUrls[url.href] = {
      status: 0,
      timings: {},
    }
    // Also map timings to the original URL key to keep a stable bucket across redirects
    try {
      if (this.originalUrl && this.originalUrl.href && this.originalUrl.href !== url.href) {
        this.analyzedUrls[this.originalUrl.href] = this.analyzedUrls[url.href]
      }
    } catch (_) { /* ignore */ }

    // Pre-navigation DNS resolve timing
    try {
      const __dnsStart = Date.now()
      const dnsPromise = dns.lookup(url.hostname).catch(() => null)
      const dnsRes = await this.promiseTimeout(dnsPromise, null, 'Timeout (dns)', this.driver.options.fast ? Math.min(this.driver.options.maxWait, 15000) : this.driver.options.maxWait)
      const __dnsMs = Date.now() - __dnsStart
      const t = this.analyzedUrls[url.href].timings
      t.dns = dnsRes ? __dnsMs : null
    } catch (_) {
      // ignore DNS timing errors
    }

    // Respect robots.txt before navigation
    if (this.driver.options.respectRobots) {
      try {
        const allowed = await this.isAllowedByRobots(url)
        if (!allowed) {
          this.log(`Skipping disallowed by robots.txt: ${url.href}`, 'driver', 'warn')
          this.analyzedUrls[url.href] = {
            status: 0,
            error: 'Disallowed by robots.txt',
            timings: {},
          }
          return []
        }
      } catch (e) {
        // Continue on robots errors
      }
    }

    const page = await this.newPage(url)

    // Track failed script loads (HTTP >= 400) to avoid false positive scriptSrc detections
    this.failedScriptSrc = new Set()

    await page.setRequestInterception(true)

    let responseReceived = false

    page.on('request', async (request) => {
      try {
        let reqHost
        try {
          reqHost = new URL(request.url()).hostname
        } catch (e) {
          request.abort('blockedbyclient')
          return
        }

        if (['xhr', 'fetch'].includes(request.resourceType())) {
          if (!xhrDebounce.includes(reqHost)) {
            xhrDebounce.push(reqHost)

            setTimeout(async () => {
              xhrDebounce.splice(xhrDebounce.indexOf(reqHost), 1)

              this.analyzedXhr[url.hostname] =
                this.analyzedXhr[url.hostname] || []

              if (!this.analyzedXhr[url.hostname].includes(reqHost)) {
                this.analyzedXhr[url.hostname].push(reqHost)

                await this.onDetect(url, analyze({ xhr: reqHost }, this.driver.activeTechnologies), 'xhr')
              }
            }, 1000)
          }
        }

        // Domain allow/block checks (opt-in allow list)
        if (this.isBlockedDomain(reqHost)) {
          return request.abort('blockedbyclient')
        }
        if (!this.isAllowedDomain(reqHost, url.hostname)) {
          return request.abort('blockedbyclient')
        }

        // Backoff gate
        if (this.driver.options.backoff) {
          const until = this.perHost.backoffUntil[reqHost]
          if (until && until > Date.now()) {
            return request.abort('blockedbyclient')
          }
        }

        const allowedTypes = ['document', 'fetch', 'xhr', ...(this.driver.options.noScripts ? [] : ['script'])]
        const allowedWithAssets = [...allowedTypes, 'image', 'stylesheet', 'font', 'media']
        const isAllowed = (this.driver.options.blockAssets ? allowedTypes : allowedWithAssets).includes(request.resourceType())

        if (
          (responseReceived && request.isNavigationRequest()) ||
          request.frame() !== page.mainFrame() ||
          !isAllowed
        ) {
          request.abort('blockedbyclient')
        } else {
          await this.emit('request', { page, request })

          // Per-host rate limiting (opt-in)
          if (this.driver.options.rateLimitMs > 0) {
            const now = Date.now()
            const last = this.perHost.lastRequestAt[reqHost] || 0
            const wait = computeRateLimitWait(last, now, this.driver.options.rateLimitMs)
            if (wait > 0 && wait < this.driver.options.maxWait) {
              await sleep(wait)
            }
            this.perHost.lastRequestAt[reqHost] = Date.now()
          }

          if (Object.keys(this.driver.options.headers).length) {
            const headers = {
              ...request.headers(),
              ...this.driver.options.headers,
            }

            request.continue({ headers })
          } else {
            request.continue()
          }
        }
      } catch (error) {
        error.message += ` (${url})`

        this.error(error)
      }
    })

    page.on('response', async (response) => {
      if (!page || page.__closed || page.isClosed()) {
        return
      }

      // Backoff handling on 429/503
      try {
        if (this.driver.options.backoff) {
          const status = response.status()
          if (status === 429 || status === 503) {
            const ra = response.headers()['retry-after']
            const now = Date.now()
            const delayMs = computeBackoffDelay(status, ra, now, { capMs: 60000, jitterPct: 0 })
            if (delayMs > 0) {
              try {
                const h = new URL(response.url()).hostname
                this.perHost.backoffUntil[h] = now + delayMs
                this.log(`Backoff set for ${h} (${delayMs}ms) due to ${status}`, 'driver', 'warn')
              } catch {}
            }
          }
        }
      } catch {}

      try {
        if (
          response.status() < 300 &&
          response.frame().url() === url.href &&
          response.request().resourceType() === 'script'
        ) {
          const scripts = await response.text()

          await this.onDetect(response.url(), analyze({ scripts }, this.driver.activeTechnologies), 'scripts')
        } else if (
          response.request().resourceType() === 'script' &&
          typeof response.status() === 'number' &&
          response.status() >= 400
        ) {
          try { this.failedScriptSrc.add(response.url()) } catch (_) {}
        }
      } catch (error) {
        if (error.constructor.name !== 'ProtocolError') {
          error.message += ` (${url})`

          this.error(error)
        }
      }

      try {
        if (response.url() === url.href) {
          // Preserve existing record if present and augment; do not clobber timings set earlier
          const prev = this.analyzedUrls[url.href] || {}
          this.analyzedUrls[url.href] = {
            ...prev,
            status: response.status(),
          }
          // Keep original URL key pointing at the same record to avoid losing timings on redirects
          try {
            if (this.originalUrl && this.originalUrl.href && this.originalUrl.href !== url.href) {
              this.analyzedUrls[this.originalUrl.href] = this.analyzedUrls[url.href]
            }
          } catch (_) { /* ignore */ }

          const rawHeaders = response.headers()
          const headers = {}

          Object.keys(rawHeaders).forEach((key) => {
            headers[key] = [
              ...(headers[key] || []),
              ...(Array.isArray(rawHeaders[key])
                ? rawHeaders[key]
                : [rawHeaders[key]]),
            ]
          })

          // Capture bytes fetched for main document via Content-Length if present
          try {
            const lenHeader = (headers['content-length'] && headers['content-length'][headers['content-length'].length - 1]) || null
            const bytes = lenHeader != null ? parseInt(String(lenHeader), 10) : null
            if (!this.analyzedUrls[url.href].timings) this.analyzedUrls[url.href].timings = {}
            this.analyzedUrls[url.href].timings.bytes = Number.isFinite(bytes) ? bytes : null
          } catch (_) { /* ignore bytes parse errors */ }

          // Prevent cross-domain redirects
          if (response.status() >= 300 && response.status() < 400) {
            if (headers.location) {
              const _url = new URL(headers.location.slice(-1), url)

              const redirects = Object.keys(this.analyzedUrls).length - 1

              if (
                _url.hostname.replace(/^www\./, '') ===
                  this.originalUrl.hostname.replace(/^www\./, '') ||
                (redirects < 3 && !this.driver.options.noRedirect)
              ) {
                url = _url

                return
              }
            }
          }

          responseReceived = true

          const certIssuer = response.securityDetails()
            ? response.securityDetails().issuer()
            : ''

          const __hdrStart = Date.now()
          await this.onDetect(url, analyze({ headers, certIssuer }, this.driver.activeTechnologies), 'headers, certIssuer')
          const __hdrMs = Date.now() - __hdrStart
          try {
            const timings = this.analyzedUrls[url.href] && this.analyzedUrls[url.href].timings
            if (timings) timings.headers = (timings.headers || 0) + __hdrMs
          } catch (e) { /* ignore */ }

          await this.emit('response', { page, response, headers, certIssuer })
        }
      } catch (error) {
        error.message += ` (${url})`

        this.error(error)
      }
    })

    try {
      const __navStart = Date.now()
      await page.goto(url.href, {
        waitUntil: this.driver.options.fast ? 'domcontentloaded' : 'load',
        timeout: this.driver.options.maxWait,
      })
      const __navMs = Date.now() - __navStart
      this.analyzedUrls[url.href].navMs = __navMs
      if (this.analyzedUrls[url.href].timings) {
        this.analyzedUrls[url.href].timings.nav = __navMs
      }

      if (page.url() === 'about:blank') {
        const error = new Error(`The page failed to load (${url})`)

        error.code = 'WAPPALYZER_PAGE_EMPTY'

        throw error
      }

      if (!this.driver.options.noScripts) {
        const idleTime = this.driver.options.fast ? 500 : 1000
        // Give non-fast mode substantially more time to settle resources; cap at maxWait
        const timeout = this.driver.options.fast
          ? 1500
          : Math.min(this.driver.options.maxWait || 30000, 10000)
        this.log(`Waiting for network idle (idleTime=${idleTime}ms, timeout=${timeout}ms) or timeout sleep fallback`)
        const __idleStart = Date.now()
        try {
          // Prefer early bailout when network becomes idle; otherwise fall back to a bounded sleep
          await Promise.race([
            page.waitForNetworkIdle({ idleTime, timeout }).catch(() => {}),
            sleep(timeout),
          ])
        } catch (e) {
          // Ignore and continue
        }
        const __idleMs = Date.now() - __idleStart
        if (this.analyzedUrls[url.href] && this.analyzedUrls[url.href].timings) {
          this.analyzedUrls[url.href].timings.idle = __idleMs
        }
        this.log(`Continuing after network idle wait (or timeout)`)
      }

      // page.on('console', (message) => this.log(message.text()))

      // Cookies
      let cookies = {}
      let cookieNames = []
      try {
        // Only retrieve cookies scoped to the current page URL to avoid cross-site leakage in multi-URL runs
        const cookieList = await page.cookies();
        cookieList.forEach(cookie => {
          cookies[cookie.name.toLowerCase()] = [cookie.value];
          cookieNames.push(cookie.name);
        });
      } catch (error) {
        error.message += ` (${url})`

        this.error(error)
      }

      // HTML
      const __htmlStart = Date.now()
      let html = await this.promiseTimeout(page.content(), '', 'Timeout (html)')
      const __htmlMs = Date.now() - __htmlStart
      if (this.analyzedUrls[url.href] && this.analyzedUrls[url.href].timings) {
        this.analyzedUrls[url.href].timings.html = __htmlMs
      }

      if (this.driver.options.htmlMaxCols && this.driver.options.htmlMaxRows) {
        html = limitHtml(html, {
          maxRows: this.driver.options.htmlMaxRows,
          maxCols: this.driver.options.htmlMaxCols,
        })
      }
      // If we don't have a Content-Length based byte size, approximate from HTML length
      try {
        const t = this.analyzedUrls[url.href] && this.analyzedUrls[url.href].timings
        if (t && (typeof t.bytes === 'undefined' || t.bytes === null)) {
          t.bytes = typeof html === 'string' ? Buffer.byteLength(html, 'utf8') : null
        }
      } catch (_) { /* ignore */ }

      let links = []
      let text = ''
      let css = ''
      let scriptSrc = []
      let scripts = []
      let meta = []
      let js = []
      let dom = []

      if (html) {
        const data = await collectPageData(
          page,
          this.driver.options,
          this.driver.activeTechnologies,
          this.promiseTimeout.bind(this)
        )
        ;({ links, text, css, scripts, scriptSrc, meta, js, dom } = data)
      }

      // Filter out scriptSrcs that failed to load (HTTP >= 400) to avoid false positives
      if (Array.isArray(scriptSrc) && this.failedScriptSrc && this.failedScriptSrc.size > 0) {
        scriptSrc = scriptSrc.filter((src) => !this.failedScriptSrc.has(src))
      }

      setPageData(this.cache, url.href, {
        page,
        html,
        text,
        cookies,
        cookieNames,
        scripts,
        scriptSrc,
        meta,
      })


      const __domStart = Date.now();
      const analyzedDom = analyzeDom(dom, this.driver.activeTechnologies);
      const __domMs = Date.now() - __domStart;
      if (this.analyzedUrls[url.href] && this.analyzedUrls[url.href].timings) {
        this.analyzedUrls[url.href].timings.dom = __domMs;
      }
      const __jsStart = Date.now();
      const analyzedJs = analyzeJs(js, this.driver.activeTechnologies);
      const __jsMs = Date.now() - __jsStart;
      if (this.analyzedUrls[url.href] && this.analyzedUrls[url.href].timings) {
        this.analyzedUrls[url.href].timings.js = __jsMs;
      }
      const analyzedOthers = analyze({
        url,
        cookies,
        cookieNames,
        html,
        text,
        css,
        scripts,
        scriptSrc,
        meta,
      }, this.driver.activeTechnologies);
      await this.onDetect(url, [analyzedDom, analyzedJs, analyzedOthers].flat(), 'dom, js, url, cookies, cookieNames, html, text, css, scripts, scriptSrc, meta')

      let reducedLinks = reduceLinks(links, url)

      // Apply robots.txt filtering and allowlist for crawled links
      reducedLinks = await applyCrawlFilters(reducedLinks, this, url)

      await this.emit('goto', {
        page,
        url,
        links: reducedLinks,
        ...this.cache[url.href],
      })

      page.__closed = true

      try {
        await page.close()

        this.log(`Page closed (${url})`)
      } catch (error) {
        // Continue
      }

      return reducedLinks
    } catch (error) {
      page.__closed = true

      try {
        await page.close()

        this.log(`Page closed (${url})`)
      } catch (error) {
        // Continue
      }

      if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
        const newError = new Error(
          `Hostname could not be resolved (${url.hostname})`
        )

        newError.code = 'WAPPALYZER_DNS_ERROR'

        throw newError
      }

      if (
        error.constructor.name === 'TimeoutError' ||
        error.code === 'PROMISE_TIMEOUT_ERROR'
      ) {
        error.code = 'WAPPALYZER_TIMEOUT_ERROR'
      }

      error.message += ` (${url})`

      throw error
    }
  }

  async newPage(url) {
    if (!this.driver.browser) {
      await this.driver.init()

      if (!this.driver.browser) {
        throw new Error('Browser closed')
      }
    }

    let page

    try {
      if (!this.context) {
        const browser = this.driver.browser
        try {
          if (browser && typeof browser.createIncognitoBrowserContext === 'function') {
            this.context = await browser.createIncognitoBrowserContext()
          } else if (browser && typeof browser.createBrowserContext === 'function') {
            try {
              this.context = await browser.createBrowserContext({ incognito: true })
            } catch (e) {
              this.context = null
            }
          } else {
            this.context = null
          }
        } catch (e) {
          this.context = null
        }
        if (!this.context) {
          this.log('Incognito browser context not available; falling back to default context', 'driver', 'warn')
        }
      }
      page = this.context ? await this.context.newPage() : await this.driver.browser.newPage()

      if (!page || page.isClosed()) {
        throw new Error('Page did not open')
      }
    } catch (error) {
      error.message += ` (${url})`

      this.error(error)

      await this.driver.init()

      if (!this.context) {
        const browser = this.driver.browser
        try {
          if (browser && typeof browser.createIncognitoBrowserContext === 'function') {
            this.context = await browser.createIncognitoBrowserContext()
          } else if (browser && typeof browser.createBrowserContext === 'function') {
            try {
              this.context = await browser.createBrowserContext({ incognito: true })
            } catch (e) {
              this.context = null
            }
          } else {
            this.context = null
          }
        } catch (e) {
          this.context = null
        }
        if (!this.context) {
          this.log('Incognito browser context not available on retry; using default context', 'driver', 'warn')
        }
      }
      page = this.context ? await this.context.newPage() : await this.driver.browser.newPage()
    }

    this.pages.push(page)

    page.setJavaScriptEnabled(!this.driver.options.noScripts)

    page.setDefaultTimeout(this.driver.options.maxWait)

    await page.setUserAgent(this.driver.options.userAgent)

    page.on('dialog', (dialog) => dialog.dismiss())

    page.on('error', (error) => {
      error.message += ` (${url})`

      this.error(error)
    })

    return page
  }

  async analyze(url = this.originalUrl, index = 1, depth = 1) {
      const __anStart = Date.now()
    if (this.driver.options.recursive) {
      const ms = this.driver.options.delay * index;
      this.log(`Sleeping for ${ms} ms (before recursive)`);
      await sleep(ms);
    }

    await Promise.allSettled([
      (async () => {
        try {
          const links = ((await this.goto(url)) || []).filter(
            ({ href }) => !this.analyzedUrls[href]
          )

          if (
            links.length &&
            this.driver.options.recursive &&
            Object.keys(this.analyzedUrls).length < this.driver.options.maxUrls &&
            depth < this.driver.options.maxDepth
          ) {
            await this.batch(
              links.slice(
                0,
                this.driver.options.maxUrls - Object.keys(this.analyzedUrls).length
              ),
              depth + 1
            )
          }
        } catch (error) {
          this.analyzedUrls[url.href] = {
            status: this.analyzedUrls[url.href]?.status || 0,
            error: error.message || error.toString(),
            timings: this.analyzedUrls[url.href]?.timings || {},
          }

          // Fallback: if navigation timed out, attempt lightweight HTML-only analysis via direct fetch
          const isTimeout = error.code === 'WAPPALYZER_TIMEOUT_ERROR' || /Timeout/i.test(error.message || '')
          if (isTimeout) {
            try {
              const __fbStart = Date.now()
              const body = await get(new URL(url.href), {
                userAgent: this.driver.options.userAgent,
                timeoutMs: Math.min(this.driver.options.maxWait, 3000),
              })
              const html = this.driver.options.htmlMaxCols && this.driver.options.htmlMaxRows
                ? limitHtml(body, { maxRows: this.driver.options.htmlMaxRows, maxCols: this.driver.options.htmlMaxCols })
                : body
              const fbDetections = analyze({ url, html, text: '' }, this.driver.activeTechnologies)
              await this.onDetect(url, fbDetections, 'fallback: html')
              const t = this.analyzedUrls[url.href].timings || {}
              t.html = (t.html || 0) + (Date.now() - __fbStart)
              this.analyzedUrls[url.href].timings = t
              this.log(`Fallback HTML-only analysis succeeded for ${url.href}`, 'driver', 'warn')
            } catch (fbErr) {
              this.log(`Fallback HTML-only analysis failed for ${url.href}: ${fbErr.message || String(fbErr)}`, 'driver', 'warn')
            }
          }

          error.message += ` (${url})`

          this.error(error)
        }
      })(),
      (async () => {
        if (this.driver.options.probe && !this.probed) {
          this.probed = true

          await this.probe(url)
        }
      })(),
    ])

    const patterns = this.driver.options.extended
      ? this.detections.reduce(
          (
            patterns,
            {
              technology: { name, implies, excludes },
              pattern: { regex, origKey, value, match, confidence, type, version },
            }
          ) => {
            patterns[name] = patterns[name] || []

            patterns[name].push({
              type,
              regex: regex.source,
              value: String(value).length <= 999 ? value : null,
              origKey,
              match: match.length <= 999 ? match : null,
              confidence,
              version,
              implies: implies.map(({ name }) => name),
              excludes: excludes.map(({ name }) => name),
            })

            return patterns
          },
          {}
        )
      : undefined

    const __resolveStart = Date.now()
    let __resolvedTechs = resolve(this.detections)
    const __resolveMs = Date.now() - __resolveStart
    // If category filter is active, restrict resolved technologies to selected categoryMap
    const __catIds = (this.driver.options.categoryIds || [])
    if (__catIds.length > 0) {
      const __catSet = new Set(__catIds)
      __resolvedTechs = (__resolvedTechs || []).filter((item) => {
        const cats = item && item.categories
        return Array.isArray(cats) && cats.some(({ id }) => __catSet.has(id))
      })
    }
    try {
      const t = this.analyzedUrls[url.href] && this.analyzedUrls[url.href].timings
      if (t) t.resolve = __resolveMs
    } catch (e) { /* ignore */ }

    const results = {
      urls: this.analyzedUrls,
      technologies: __resolvedTechs.map(
        ({
          slug,
          name,
          description,
          confidence,
          version,
          icon,
          website,
          cpe,
          categories,
          rootPath,
        }) => ({
          slug,
          name,
          description,
          confidence,
          version: version || null,
          icon,
          website,
          cpe,
          categories: categories.map(({ id, slug, name }) => ({
            id,
            slug,
            name,
          })),
          rootPath,
        })
      ),
      patterns,
      cookieNames: getCookieNames(this.cache),
    }

    await this.emit('analyze', results)

    if (this.driver.options.traceTimings) {
      const nav = (this.analyzedUrls[url.href] && this.analyzedUrls[url.href].navMs) || null
      const total = Date.now() - __anStart
      const t = (this.analyzedUrls[url.href] && this.analyzedUrls[url.href].timings) || {}
      const timings = {
        dns: t.dns ?? null,
        nav: t.nav ?? nav,
        idle: t.idle ?? null,
        html: t.html ?? null,
        headers: t.headers ?? null,
        js: t.js ?? null,
        dom: t.dom ?? null,
        resolve: t.resolve ?? null,
        bytes: t.bytes ?? null,
        total,
      }
      const { printAndSaveTimings } = require('./src/driver/trace')
      printAndSaveTimings(this.driver.options, String(url), timings)
    }

    return results
  }

  async probe(url) {
    const paths = [
      {
        type: 'robots',
        path: '/robots.txt',
      },
    ]

    if (this.driver.options.probe === 'full') {
      Wappalyzer.technologies
        .filter(({ probe }) => Object.keys(probe).length)
        .forEach((technology) => {
          paths.push(
            ...Object.keys(technology.probe).map((path) => ({
              type: 'probe',
              path,
              technology,
            }))
          )
        })
    }

    // DNS
    const records = {}
    const resolveDns = (func, hostname) => {
      return this.promiseTimeout(
        func(hostname).catch((error) => {
          if (error.code !== 'ENODATA') {
            error.message += ` (${url})`

            this.error(error)
          }

          return []
        }),
        [],
        'Timeout (dns)',
        this.driver.options.fast
          ? Math.min(this.driver.options.maxWait, 15000)
          : this.driver.options.maxWait
      )
    }

    const domain = url.hostname.replace(/^www\./, '')

    await Promise.allSettled([
      // Static files
      ...paths.map(async ({ type, path, technology }, index) => {
        try {
          const ms = this.driver.options.delay * index;
          this.log(`Sleeping for ${ms} ms (probe static files)`);
          await sleep(ms);

          const body = await get(new URL(path, url.href), {
            userAgent: this.driver.options.userAgent,
            timeout: Math.min(this.driver.options.maxWait, 3000),
          })

          this.log(`Probe ok (${path})`)

          const text = body.slice(0, 100000)

          await this.onDetect(
            url,
            analyze(
              {
                [type]: path ? { [path]: [text] } : text,
              },
              technology && [technology]
            ),
            type
          )
        } catch (error) {
          this.error(`Probe failed (${path}): ${error.message || error}`)
        }
      }),
      // DNS
      // eslint-disable-next-line no-async-promise-executor
      new Promise(async (resolve, reject) => {
        ;[records.cname, records.ns, records.mx, records.txt, records.soa] =
          await Promise.all([
            resolveDns(dns.resolveCname, url.hostname),
            resolveDns(dns.resolveNs, domain),
            resolveDns(dns.resolveMx, domain),
            resolveDns(dns.resolveTxt, domain),
            resolveDns(dns.resolveSoa, domain),
          ])

        const dnsRecords = Object.keys(records).reduce((dns, type) => {
          dns[type] = dns[type] || []

          Array.prototype.push.apply(
            dns[type],
            Array.isArray(records[type])
              ? records[type].map((value) => {
                  return typeof value === 'object'
                    ? Object.values(value).join(' ')
                    : value
                })
              : [Object.values(records[type]).join(' ')]
          )

          return dns
        }, {})

        this.log(
          `Probe DNS ok: (${Object.values(dnsRecords).flat().length} records)`
        )

        await this.onDetect(url, analyze({ dns: dnsRecords }, this.driver.activeTechnologies), 'dns')

        resolve()
      }),
    ])
  }

  async batch(links, depth, batch = 0) {
    if (links.length === 0) {
      return
    }

    const batched = links.splice(0, this.driver.options.batchSize)

    await Promise.allSettled(
      batched.map((link, index) => this.analyze(link, index, depth))
    )

    await this.batch(links, depth, batch + 1)
  }

  async onDetect(url, detections, types) {
    this.log(`Adding ${detections.length} detections (${types})`);
    this.detections = this.detections
      .concat(detections)
      .filter(
        (
          { technology: { name }, pattern: { regex, type }, version },
          index,
          detections
        ) =>
          detections.findIndex(
            ({
              technology: { name: _name },
              pattern: { regex: _regex, type: _type },
              version: _version,
            }) =>
              type === _type &&
              name === _name &&
              version === _version &&
              (!regex || regex.toString() === _regex.toString())
          ) === index
      )

    // Track if technology was identified on website's root path
    detections.forEach(({ technology: { name } }) => {
      const detection = this.detections.find(
        ({ technology: { name: _name } }) => name === _name
      )

      detection.rootPath = detection.rootPath || url.pathname === '/'
    })

    if (this.cache[url.href]) {
      const resolved = resolve(this.detections)

      const requires = [
        ...Wappalyzer.requires.filter(({ name }) =>
          resolved.some(({ name: _name }) => _name === name)
        ),
        ...Wappalyzer.categoryRequires.filter(({ categoryId }) =>
          resolved.some((item) => {
            const categories = item && item.categories
            return Array.isArray(categories) && categories.some(({ id }) => id === categoryId)
          })
        ),
      ]

      await Promise.allSettled(
        requires.map(async ({ name, categoryId, technologies }) => {
          const id = categoryId
            ? `category:${categoryId}`
            : `technology:${name}`

          this.analyzedRequires[url.href] =
            this.analyzedRequires[url.href] || []

          if (!this.analyzedRequires[url.href].includes(id)) {
            this.analyzedRequires[url.href].push(id)

            const { page, cookies, cookieNames, html, text, css, scripts, scriptSrc, meta } =
              this.cache[url.href]

            const js = await this.promiseTimeout(
              getJs(page, technologies),
              [],
              'Timeout (js)'
            )
            const dom = await this.promiseTimeout(
              getDom(page, technologies),
              [],
              'Timeout (dom)'
            )

            await this.onDetect(
              url,
              [
                analyzeDom(dom, technologies),
                analyzeJs(js, technologies),
                analyze(
                  {
                    url,
                    cookies,
                    cookieNames,
                    html,
                    text,
                    css,
                    scripts,
                    scriptSrc,
                    meta,
                  },
                  technologies
                ),
              ].flat(),
              'dom, js, url, cookies, cookieNames, html, text, css, scripts, scriptSrc, meta'
            )
          }
        })
      )
    }
  }

  async destroy() {
    await Promise.allSettled(
      this.pages.map(async (page) => {
        if (page) {
          page.__closed = true

          try {
            await page.close()
          } catch (error) {
            // Continue
          }
        }
      })
    )

    try {
      if (this.context && typeof this.context.close === 'function') {
        await this.context.close()
      }
    } catch (e) {
      // ignore context close errors
    }

    this.log('Site closed')
  }
}

module.exports = Driver
