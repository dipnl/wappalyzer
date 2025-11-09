'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const puppeteer = require('puppeteer')

const { buildChromiumConfig } = require('../config/browser')

function ensureChromiumConfig(config) {
  if (config && typeof config === 'object') {
    const clone = { ...config }
    clone.args = Array.isArray(config.args) ? config.args.slice() : []
    return clone
  }

  return buildChromiumConfig()
}

/**
 * Compute Chromium flags from environment/config or provide safe defaults.
 * @param {{ proxy?: string, userDataDir?: string }} [options]
 * @param {{ args?: string[] }} [chromiumConfig]
 * @returns {string[]}
 */
function getChromiumArgs(options = {}, chromiumConfig) {
  const config = ensureChromiumConfig(chromiumConfig)
  const base = Array.isArray(config.args) ? config.args.slice() : []

  if (options && options.proxy) {
    base.push(`--proxy-server=${options.proxy}`)
  }
  if (options && options.userDataDir && !base.some((arg) => arg.startsWith('--user-data-dir'))) {
    base.push(`--user-data-dir=${options.userDataDir}`)
  }

  return base
}

/**
 * Launch a browser or connect to an existing one via websocket, honoring env vars.
 * @param {{ fast?: boolean, maxWait?: number, proxy?: string }} options
 * @returns {Promise<import('puppeteer').Browser>}
 */
async function launchOrConnect(options = {}, chromiumOverrides) {
  const chromiumConfig = ensureChromiumConfig(chromiumOverrides)

  if (chromiumConfig.websocket) {
    return puppeteer.connect({
      ignoreHTTPSErrors: true,
      acceptInsecureCerts: true,
      browserWSEndpoint: chromiumConfig.websocket,
    })
  }

  let userDataDir = chromiumConfig.userDataDir
  if (userDataDir) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true })
    } catch (_) {
      // ignore directory creation failures; puppeteer will attempt its fallback
    }
  } else {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wappalyzer-chromium-'))
  }

  const launchArgs = getChromiumArgs({ proxy: options.proxy, userDataDir }, chromiumConfig)

  return puppeteer.launch({
    headless: chromiumConfig.headless || 'new',
    ignoreHTTPSErrors: true,
    acceptInsecureCerts: true,
    args: launchArgs,
    executablePath: chromiumConfig.bin,
    timeout: options.fast ? Math.min(options.maxWait || 30000, 10000) : options.maxWait,
    userDataDir,
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
