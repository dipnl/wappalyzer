'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('cli --trace-timings prints a JSON timing line and result JSON', () => {
  const res = spawnSync('node', ['cli.js', 'https://example.com', '--no-scripts', '--fast', '-w', '3000', '--trace-timings'], {
    encoding: 'utf8',
    env: { ...process.env, CHROMIUM_ARGS: '--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage' }
  })
  assert.equal(res.status, 0, res.stderr || 'non-zero exit')
  const lines = res.stdout.trim().split(/\r?\n/)
  assert.ok(lines.length >= 2)
  // Find a timings line (it should parse to an object with timings)
  const timingLine = lines.find(l => {
    try { const o = JSON.parse(l); return o && o.timings && typeof o.timings === 'object' } catch { return false }
  })
  assert.ok(timingLine, 'no timing line found')
  const timingObj = JSON.parse(timingLine)
  assert.ok('url' in timingObj)
  assert.ok('timings' in timingObj)
  // New: dns timing key should be present (may be null)
  assert.ok(Object.prototype.hasOwnProperty.call(timingObj.timings, 'dns'))
  // New: bytes timing key should be present (may be null)
  assert.ok(Object.prototype.hasOwnProperty.call(timingObj.timings, 'bytes'))
  // Strengthened: key timings should be numbers (idle may be null)
  for (const k of ['nav','html','dom','js','resolve','total']) {
    assert.equal(typeof timingObj.timings[k], 'number', `timings.${k} should be a number`)
  }
  // Last line should be result JSON
  const resultObj = JSON.parse(lines[lines.length - 1])
  assert.ok(resultObj && typeof resultObj === 'object')
  assert.ok(Array.isArray(resultObj.technologies))
})

// New: ensure --trace-timings also works when using --list output mode
test('cli --trace-timings with --list prints timing line followed by list', () => {
  const res = spawnSync('node', ['cli.js', 'https://example.com', '--no-scripts', '--fast', '-w', '3000', '--trace-timings', '--list'], {
    encoding: 'utf8',
    env: { ...process.env, CHROMIUM_ARGS: '--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage' }
  })
  assert.equal(res.status, 0, res.stderr || 'non-zero exit')
  const lines = res.stdout.trim().split(/\r?\n/)
  assert.ok(lines.length >= 2, 'expected at least timing line + 1 list line')
  let idx = 0
  // First JSON timing line
  const timingObj = JSON.parse(lines[idx++])
  assert.ok(timingObj && timingObj.timings)
  for (const k of ['nav','html','dom','js','resolve','total']) {
    assert.equal(typeof timingObj.timings[k], 'number', `timings.${k} should be a number`)
  }
  // Remaining should include list output lines (non-JSON is fine)
  const rest = lines.slice(idx)
  assert.ok(rest.length >= 1)
})

test('cli --trace-save writes NDJSON with per-URL timings', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wappa-trace-'))
  const file = path.join(tmp, 'timings.ndjson')
  const res = spawnSync('node', ['cli.js', 'https://example.com', '--no-scripts', '--fast', '-w', '3000', '--trace-timings', '--trace-save', file], {
    encoding: 'utf8',
    env: { ...process.env, CHROMIUM_ARGS: '--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage' }
  })
  assert.equal(res.status, 0, res.stderr || 'non-zero exit')
  assert.ok(fs.existsSync(file), 'trace file not created')
  const content = fs.readFileSync(file, 'utf8').trim()
  assert.ok(content.length > 0)
  // Each line should parse to an object with url+timings
  const lines = content.split(/\r?\n/)
  assert.ok(lines.length >= 1)
  const objs = lines.map(l => JSON.parse(l))
  for (const o of objs) {
    assert.ok(typeof o.url === 'string')
    assert.ok(o.timings && typeof o.timings === 'object')
    assert.ok('total' in o.timings)
    assert.ok(Object.prototype.hasOwnProperty.call(o.timings, 'dns'))
    assert.ok(Object.prototype.hasOwnProperty.call(o.timings, 'bytes'))
  }
})
