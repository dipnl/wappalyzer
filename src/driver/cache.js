"use strict"

/**
 * Small cache facade for per-URL page data.
 * Behavior-preserving: keeps the same data shape that driver.js used directly.
 *
 * Each entry is keyed by url.href and contains:
 * { page, html, text, cookies, cookieNames, scripts, scriptSrc, meta }
 */

/**
 * Store page data for a given URL href into the cache.
 * @param {Record<string, any>} cache
 * @param {string} href
 * @param {{ page?: any, html?: string, text?: string, cookies?: Record<string,string[]>, cookieNames?: string[], scripts?: string[], scriptSrc?: string[], meta?: Record<string,string[]> }} data
 */
function setPageData(cache, href, data) {
  if (!cache || !href) return
  const prev = cache[href] || {}
  cache[href] = {
    ...prev,
    page: data.page !== undefined ? data.page : prev.page,
    html: data.html !== undefined ? data.html : prev.html,
    text: data.text !== undefined ? data.text : prev.text,
    cookies: data.cookies !== undefined ? data.cookies : prev.cookies,
    cookieNames: data.cookieNames !== undefined ? data.cookieNames : prev.cookieNames,
    scripts: data.scripts !== undefined ? data.scripts : prev.scripts,
    scriptSrc: data.scriptSrc !== undefined ? data.scriptSrc : prev.scriptSrc,
    meta: data.meta !== undefined ? data.meta : prev.meta,
  }
}

/**
 * Retrieve page data for a given URL href from the cache.
 * @param {Record<string, any>} cache
 * @param {string} href
 * @returns {any|null}
 */
function getPageData(cache, href) {
  if (!cache || !href) return null
  return cache[href] || null
}

/**
 * Flatten and de-duplicate cookie names from all cache entries.
 * @param {Record<string, any>} cache
 * @returns {string[]}
 */
function getCookieNames(cache) {
  if (!cache) return []
  const set = new Set()
  Object.values(cache).forEach((entry) => {
    const list = (entry && entry.cookieNames) || []
    for (const name of list) set.add(name)
  })
  return Array.from(set)
}

module.exports = { setPageData, getPageData, getCookieNames }
