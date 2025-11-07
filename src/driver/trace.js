'use strict'

const fs = require('fs')

/**
 * Print timings as a single JSON line and, if configured, append to a file (NDJSON).
 * Behavior-preserving: mirrors prior stdout/stderr usage.
 *
 * @param {{ traceSave?: string }} options
 * @param {string} url
 * @param {{ dns: number|null, nav: number|null, idle: number|null, html: number|null, headers: number|null, js: number|null, dom: number|null, resolve: number|null, bytes: number|null, total: number|null }} timings
 */
function printAndSaveTimings(options, url, timings) {
  const line = JSON.stringify({ url: String(url), timings })
  // eslint-disable-next-line no-console
  console.log(line)
  if (options && options.traceSave) {
    try {
      fs.appendFileSync(options.traceSave, `${line}\n`)
    } catch (e) {
      const err = new Error(`Failed to append timings to file: ${e.message || String(e)}`)
      // eslint-disable-next-line no-console
      console.error(err.message)
    }
  }
}

module.exports = { printAndSaveTimings }
