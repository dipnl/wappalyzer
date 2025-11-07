'use strict'

const http = require('http')
const https = require('https')

/**
 * Simple HTTP(S) GET that resolves with the UTF-8 body or rejects on HTTP >= 300, timeout, or error.
 * @param {URL} url
 * @param {{ userAgent?: string, timeoutMs?: number }} [options]
 * @returns {Promise<string>}
 */
function get(url, options = {}) {
  const timeout = options.timeoutMs || 30000

  if (!['http:', 'https:'].includes(url.protocol)) {
    return Promise.reject(new Error(`Invalid protocol: ${url.protocol}`))
  }

  const lib = url.protocol === 'http:' ? http : https

  return new Promise((resolve, reject) => {
    const req = lib.get(
      url,
      {
        rejectUnauthorized: false,
        headers: {
          'User-Agent': options.userAgent,
        },
      },
      (response) => {
        if (response.statusCode >= 300) {
          return reject(new Error(`${response.statusCode} ${response.statusMessage}`))
        }

        response.setEncoding('utf8')

        let body = ''

        response.on('data', (data) => (body += data))
        response.on('error', (error) => reject(new Error(error.message)))
        response.on('end', () => resolve(body))
      }
    )

    req.setTimeout(timeout, () => {
      try { req.destroy() } catch (_) {}
      reject(new Error(`Timeout (${url}, ${timeout}ms)`))
    })

    req.on('error', (error) => reject(new Error(error.message)))
  })
}

module.exports = { get }
