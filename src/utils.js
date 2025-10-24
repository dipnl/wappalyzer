/**
 * Shared utility helpers for the Wappalyzer CLI and driver.
 * These are extracted to make the codebase more modular and understandable,
 * without changing any runtime behavior.
 */

'use strict'

/**
 * Pause for the specified milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Limit the size of HTML processed by keeping head and tail slices.
 * Matches the previous implementation used in driver.js.
 *
 * @param {string} html
 * @param {{ maxRows?: number, maxCols?: number }} opts
 * @returns {string}
 */
function limitHtml(html, { maxRows, maxCols } = {}) {
  if (!html || !maxRows || !maxCols) return html || ''

  const batches = []
  const rows = html.length / maxCols

  for (let i = 0; i < rows; i += 1) {
    if (i < maxRows / 2 || i > rows - maxRows / 2) {
      batches.push(html.slice(i * maxCols, (i + 1) * maxCols))
    }
  }

  return batches.join('\n')
}

module.exports = {
  sleep,
  limitHtml,
}
