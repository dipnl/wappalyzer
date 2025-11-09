'use strict'

const { buildChromiumConfig } = require('./browser')

const DEFAULT_DRIVER_OPTIONS = {
  batchSize: 5,
  debug: false,
  delay: 500,
  fast: false,
  htmlMaxCols: 2000,
  htmlMaxRows: 3000,
  maxDepth: 3,
  maxUrls: 10,
  maxWait: 30000,
  noRedirect: false,
  noScripts: false,
  recursive: false,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  headers: {},
}

const normaliseInteger = (value, fallback) => {
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const asBoolean = (value) => Boolean(+value || value)

const stripReservedKeys = (options = {}) => {
  const { chromium, env, ...rest } = options || {}
  return { driverOptions: rest, chromiumOverrides: chromium || {}, envOverrides: env }
}

function buildDriverOptions(options = {}) {
  const { driverOptions } = stripReservedKeys(options)

  const merged = {
    ...DEFAULT_DRIVER_OPTIONS,
    ...driverOptions,
  }

  merged.batchSize = normaliseInteger(merged.batchSize, DEFAULT_DRIVER_OPTIONS.batchSize)
  merged.delay = normaliseInteger(merged.delay, DEFAULT_DRIVER_OPTIONS.delay)
  merged.htmlMaxCols = normaliseInteger(merged.htmlMaxCols, DEFAULT_DRIVER_OPTIONS.htmlMaxCols)
  merged.htmlMaxRows = normaliseInteger(merged.htmlMaxRows, DEFAULT_DRIVER_OPTIONS.htmlMaxRows)
  merged.maxDepth = normaliseInteger(merged.maxDepth, DEFAULT_DRIVER_OPTIONS.maxDepth)
  merged.maxUrls = normaliseInteger(merged.maxUrls, DEFAULT_DRIVER_OPTIONS.maxUrls)
  merged.maxWait = normaliseInteger(merged.maxWait, DEFAULT_DRIVER_OPTIONS.maxWait)

  merged.fast = asBoolean(merged.fast)
  merged.debug = asBoolean(merged.debug)
  merged.noScripts = asBoolean(merged.noScripts)
  merged.recursive = asBoolean(merged.recursive)
  merged.noRedirect = asBoolean(merged.noRedirect)

  merged.headers = merged.headers || {}

  return merged
}

function buildRuntimeOptions(options = {}, env = process.env) {
  const { chromiumOverrides, envOverrides } = stripReservedKeys(options)

  const driver = buildDriverOptions(options)
  const chromium = buildChromiumConfig(envOverrides || env, chromiumOverrides)

  return { driver, chromium }
}

module.exports = {
  DEFAULT_DRIVER_OPTIONS,
  buildDriverOptions,
  buildRuntimeOptions,
}

