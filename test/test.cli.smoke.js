'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

test('cli single URL outputs JSON with technologies', () => {
  const res = spawnSync('node', ['cli.js', 'https://example.com', '--no-scripts', '--fast', '-w', '3000'], {
    encoding: 'utf8',
    env: { ...process.env, CHROMIUM_ARGS: '--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage' }
  })
  assert.equal(res.status, 0, res.stderr || 'non-zero exit')
  const out = res.stdout.trim()
  assert.ok(out.length > 0, 'no stdout')
  const json = JSON.parse(out)
  assert.ok(json && typeof json === 'object')
  assert.ok(json.urls && typeof json.urls === 'object')
  assert.ok(Array.isArray(json.technologies))
})
