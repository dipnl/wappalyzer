'use strict'

const puppeteer = require('puppeteer')

const { CHROMIUM_BIN, CHROMIUM_WEBSOCKET, CHROMIUM_ARGS } = process.env

/**
 * Compute Chromium flags from environment or provide safe defaults.
 * Mirrors driver.js behavior to preserve compatibility.
 * @param {{ proxy?: string }} [options]
 * @returns {string[]}
 */
function getChromiumArgs(options = {}) {
  const base = CHROMIUM_ARGS
    ? CHROMIUM_ARGS.split(' ')
    : [
        '--headless',
        // '--single-process',
        // '--no-sandbox',
        // '--no-zygote',
        '--disable-gpu',
        // '--ignore-certificate-errors',
        // '--allow-running-insecure-content',
        // '--disable-web-security',
        // `--user-data-dir=${process.env.CHROMIUM_DATA_DIR || '/tmp/chromium'}`,
      ]
  // Append proxy if provided via options (CLI --proxy)
  if (options && options.proxy) {
    base.push(`--proxy-server=${options.proxy}`)
  }
  return base
}

/**
 * Launch a browser or connect to an existing one via websocket, honoring env vars.
 * @param {{ fast?: boolean, maxWait?: number, proxy?: string }} options
 * @returns {Promise<import('puppeteer').Browser>}
 */
async function launchOrConnect(options = {}) {
  if (CHROMIUM_WEBSOCKET) {
    return puppeteer.connect({
      ignoreHTTPSErrors: true,
      acceptInsecureCerts: true,
      browserWSEndpoint: CHROMIUM_WEBSOCKET,
    })
  }

  return puppeteer.launch({
    headless: 'new',
    ignoreHTTPSErrors: true,
    acceptInsecureCerts: true,
    args: getChromiumArgs({ proxy: options.proxy }),
    executablePath: CHROMIUM_BIN,
    timeout: options.fast ? Math.min(options.maxWait || 30000, 10000) : options.maxWait,
  })
}

/**
 * Close a Puppeteer browser instance, swallowing Puppeteer's internal string errors to a clean Error.
 * @param {import('puppeteer').Browser|undefined} browser
 */
async function close(browser) {
  if (!browser) return
  await browser.close()
}

module.exports = {
  getChromiumArgs,
  launchOrConnect,
  close,
}
