'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

function loadBrowserModule() {
  // Reload module to pick up current env values captured at import time
  delete require.cache[require.resolve('../src/driver/browser')]
  return require('../src/driver/browser')
}

test('browser.getChromiumArgs: defaults when CHROMIUM_ARGS not set', () => {
  const prev = process.env.CHROMIUM_ARGS
  delete process.env.CHROMIUM_ARGS
  const { getChromiumArgs } = loadBrowserModule()
  const args = getChromiumArgs()
  assert.ok(Array.isArray(args))
  assert.ok(args.includes('--headless'))
  process.env.CHROMIUM_ARGS = prev
})

test('browser.getChromiumArgs: splits CHROMIUM_ARGS by spaces', () => {
  const prev = process.env.CHROMIUM_ARGS
  process.env.CHROMIUM_ARGS = '--headless=new --no-sandbox --disable-gpu'
  const { getChromiumArgs } = loadBrowserModule()
  const args = getChromiumArgs()
  assert.deepEqual(args, ['--headless=new', '--no-sandbox', '--disable-gpu'])
  if (prev == null) {
    delete process.env.CHROMIUM_ARGS
  } else {
    process.env.CHROMIUM_ARGS = prev
  }
})

test('browser.getChromiumArgs: includes proxy flag when provided', () => {
  const { getChromiumArgs } = loadBrowserModule()
  const proxy = 'http://127.0.0.1:8080'
  const args = getChromiumArgs({ proxy })
  assert.ok(args.some(a => a === `--proxy-server=${proxy}`), 'proxy flag missing')
})
