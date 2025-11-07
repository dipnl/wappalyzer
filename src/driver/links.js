'use strict'

const { extensions } = require('./constants')

/**
 * Reduce a NodeList/Array-like of anchor elements into filtered same-host URLs with acceptable extensions.
 * @param {ArrayLike<{ protocol:string, hostname:string, pathname:string, href:string }>} links
 * @param {URL} url - current page URL
 * @returns {URL[]}
 */
function reduceLinks(links, url) {
  return Array.prototype.reduce.call(
    links,
    (results, link) => {
      if (
        results &&
        Object.prototype.hasOwnProperty.call(
          Object.getPrototypeOf(results),
          'push'
        ) &&
        link.protocol &&
        link.protocol.match(/https?:/) &&
        link.hostname === url.hostname &&
        extensions.test(link.pathname.slice(-5))
      ) {
        results.push(new URL(link.href.split('#')[0]))
      }

      return results
    },
    []
  )
}

/**
 * Apply robots.txt and allowDomains filters to candidate links based on driver options.
 * @param {URL[]} links
 * @param {any} site - the Site instance (needs driver.options, isAllowedByRobots, isAllowedDomain)
 * @param {URL} currentUrl
 * @returns {Promise<URL[]>}
 */
async function applyCrawlFilters(links, site, currentUrl) {
  let out = links

  if (site.driver.options.respectRobots) {
    const filtered = []
    for (const l of out) {
      try {
        if (await site.isAllowedByRobots(l)) filtered.push(l)
      } catch {
        filtered.push(l)
      }
    }
    out = filtered
  }

  if (site.driver.options.allowDomains && site.driver.options.allowDomains.length) {
    out = out.filter((l) => site.isAllowedDomain(l.hostname, currentUrl.hostname))
  }

  return out
}

module.exports = { reduceLinks, applyCrawlFilters }
