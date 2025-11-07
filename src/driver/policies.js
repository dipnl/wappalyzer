"use strict"

const http = require('http')
const https = require('https')

function hostMatches(domain, rule) {
  if (!rule) return false
  if (domain === rule) return true
  if (rule.startsWith('.')) {
    return domain.endsWith(rule)
  }
  return domain === rule || domain.endsWith(`.${rule}`)
}

function isBlockedDomain(options, domain) {
  const { blockDomains = [] } = options || {}
  return (blockDomains || []).some((rule) => hostMatches(domain, rule))
}

function isAllowedDomain(options, domain, mainHost) {
  const { allowDomains = [] } = options || {}
  if (!allowDomains || !allowDomains.length) return true
  if (domain === mainHost || domain.endsWith(`.${mainHost}`)) return true
  return allowDomains.some((rule) => hostMatches(domain, rule))
}

function getUrl(url, { timeout = 3000, headers = {} } = {}) {
  if (url.protocol === 'http:') {
    return new Promise((resolve, reject) =>
      http
        .get(url, { rejectUnauthorized: false, headers }, (response) => {
          if (response.statusCode >= 300) {
            return reject(
              new Error(`${response.statusCode} ${response.statusMessage}`)
            )
          }
          response.setEncoding('utf8')
          let body = ''
          response.on('data', (data) => (body += data))
          response.on('error', (error) => reject(new Error(error.message)))
          response.on('end', () => resolve(body))
        })
        .setTimeout(timeout, () => reject(new Error(`Timeout (${url}, ${timeout}ms)`)))
        .on('error', (error) => reject(new Error(error.message)))
    )
  } else if (url.protocol === 'https:') {
    return new Promise((resolve, reject) =>
      https
        .get(url, { rejectUnauthorized: false, headers }, (response) => {
          if (response.statusCode >= 300) {
            return reject(
              new Error(`${response.statusCode} ${response.statusMessage}`)
            )
          }
          response.setEncoding('utf8')
          let body = ''
          response.on('data', (data) => (body += data))
          response.on('error', (error) => reject(new Error(error.message)))
          response.on('end', () => resolve(body))
        })
        .setTimeout(timeout, () => reject(new Error(`Timeout (${url}, ${timeout}ms)`)))
        .on('error', (error) => reject(new Error(error.message)))
    )
  }
  throw new Error(`Invalid protocol: ${url.protocol}`)
}

function parseRobots(body) {
  const lines = String(body || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
  let active = false
  const allow = []
  const disallow = []
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue
    const m = /^(user-agent|allow|disallow)\s*:\s*(.+)$/i.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'user-agent') {
      active = val === '*'
    } else if (active && key === 'allow') {
      allow.push(val)
    } else if (active && key === 'disallow') {
      disallow.push(val)
    }
  }
  return { allow, disallow }
}

async function fetchRobots(url, options = {}, cache = {}) {
  const host = url.hostname
  cache.robots = cache.robots || {}
  if (cache.robots[host]) return cache.robots[host]
  const robotsUrl = new URL(`${url.protocol}//${host}/robots.txt`)
  let body = ''
  try {
    body = await getUrl(robotsUrl, {
      timeout: Math.min(3000, parseInt(options.maxWait || 30000, 10)),
      headers: { 'User-Agent': options.userAgent },
    })
  } catch (_e) {
    cache.robots[host] = { allow: [], disallow: [], loaded: true }
    return cache.robots[host]
  }
  const parsed = parseRobots(body)
  cache.robots[host] = { ...parsed, loaded: true }
  return cache.robots[host]
}

async function isAllowedByRobots(url, options = {}, cache = {}) {
  if (!options.respectRobots) return true
  const { allow, disallow } = await fetchRobots(url, options, cache)
  const path = url.pathname || '/'
  const matches = (rule) => {
    if (rule === '') return true
    if (rule === '/') return false
    return path.startsWith(rule)
  }
  let bestAllow = ''
  let bestDisallow = ''
  for (const r of allow) {
    if (matches(r) && r.length > bestAllow.length) bestAllow = r
  }
  for (const r of disallow) {
    if (matches(r) && r.length > bestDisallow.length) bestDisallow = r
  }
  if (!bestAllow && !bestDisallow) return true
  if (bestAllow.length >= bestDisallow.length) return true
  return false
}

function computeBackoffDelay(status, retryAfter, now = Date.now(), { capMs = 60000, jitterPct = 0 } = {}) {
  let delayMs = status === 429 ? 5000 : status === 503 ? 10000 : 0
  if (retryAfter) {
    const n = parseInt(retryAfter, 10)
    if (!Number.isNaN(n)) {
      delayMs = n * 1000
    } else {
      const d = Date.parse(retryAfter)
      if (!Number.isNaN(d)) {
        delayMs = Math.max(0, d - now)
      }
    }
  }
  // cap and apply optional jitter (deterministic if jitterPct=0)
  delayMs = Math.min(capMs, Math.max(0, delayMs))
  if (jitterPct && delayMs > 0) {
    const jitter = Math.floor(delayMs * Math.min(Math.max(jitterPct, 0), 1) * 0.5)
    // +/- jitter; we bias to + for simplicity in deterministic tests jitterPct can be 0
    delayMs = delayMs - jitter
  }
  return delayMs
}

function computeRateLimitWait(lastAt, now, rateLimitMs) {
  if (!rateLimitMs || rateLimitMs <= 0) return 0
  const last = lastAt || 0
  const wait = rateLimitMs - (now - last)
  return wait > 0 ? wait : 0
}

module.exports = {
  hostMatches,
  isBlockedDomain,
  isAllowedDomain,
  parseRobots,
  fetchRobots,
  isAllowedByRobots,
  computeBackoffDelay,
  computeRateLimitWait,
}
