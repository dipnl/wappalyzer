"use strict"
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

// Regression: --dump should print raw detections

test('cli --dump single URL prints structured detections object', () => {
  const res = spawnSync('node', ['cli.js', 'https://example.com', '--no-scripts', '--fast', '-w', '3000', '--dump'], {
    encoding: 'utf8',
    env: { ...process.env, CHROMIUM_ARGS: '--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage' }
  })
  assert.equal(res.status, 0, res.stderr || 'non-zero exit')
  const out = res.stdout.trim()
  assert.ok(out.length > 0, 'no stdout')
  const json = JSON.parse(out)
  assert.ok(json && typeof json === 'object', 'expected an object')
  // Should have known keys that are arrays
  for (const key of ['headers','js','meta','cookies','scripts','dom']) {
    assert.ok(Array.isArray(json[key]), `expected array at json[${key}]`)
  }
})
