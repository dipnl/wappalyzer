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

module.exports = { reduceLinks }
