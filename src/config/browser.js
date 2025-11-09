'use strict'

const DEFAULT_CHROMIUM_ARGS = [
  '--headless',
  '--disable-gpu',
  '--disable-crashpad',
  '--disable-crash-reporter',
  '--disable-breakpad',
]

function parseArgs(argString) {
  if (typeof argString !== 'string') {
    return null
  }
  return argString
    .split(' ')
    .map((item) => item.trim())
    .filter(Boolean)
}

function ensureArray(value, fallback) {
  if (Array.isArray(value)) {
    return value.slice()
  }
  if (typeof value === 'string') {
    const parsed = parseArgs(value)
    return parsed !== null ? parsed : fallback.slice()
  }
  return fallback.slice()
}

function buildChromiumConfig(env = process.env, overrides = {}) {
  const args =
    overrides.args != null
      ? ensureArray(overrides.args, DEFAULT_CHROMIUM_ARGS)
      : env && env.CHROMIUM_ARGS
      ? ensureArray(env.CHROMIUM_ARGS, DEFAULT_CHROMIUM_ARGS)
      : DEFAULT_CHROMIUM_ARGS.slice()

  return {
    args,
    bin:
      overrides.bin != null
        ? overrides.bin
        : env && env.CHROMIUM_BIN
        ? env.CHROMIUM_BIN
        : undefined,
    websocket:
      overrides.websocket != null
        ? overrides.websocket
        : env && env.CHROMIUM_WEBSOCKET
        ? env.CHROMIUM_WEBSOCKET
        : undefined,
    userDataDir:
      overrides.userDataDir != null
        ? overrides.userDataDir
        : env && env.CHROMIUM_DATA_DIR
        ? env.CHROMIUM_DATA_DIR
        : undefined,
    headless:
      overrides.headless != null
        ? overrides.headless
        : env && env.CHROMIUM_HEADLESS
        ? env.CHROMIUM_HEADLESS
        : 'new',
  }
}

module.exports = {
  DEFAULT_CHROMIUM_ARGS,
  buildChromiumConfig,
}

