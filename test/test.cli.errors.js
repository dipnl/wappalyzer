"use strict"
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

// Minimal regression: invalid URL should cause non-zero exit and a helpful message
// cli.js currently prints the error to stdout and exits with code 1.

test('cli: invalid URL exits with code 1 and prints message', () => {
  const res = spawnSync('node', ['cli.js', 'not-a-url'], { encoding: 'utf8' })
  assert.equal(res.status, 1)
  const out = (res.stdout || '').trim()
  assert.ok(/Invalid URL/i.test(out), `expected 'Invalid URL' message, got: ${out}`)
})
