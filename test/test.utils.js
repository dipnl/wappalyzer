'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { limitHtml, sleep } = require('../src/utils')

test('limitHtml: returns input when no limits', () => {
  assert.equal(limitHtml('abc', {}), 'abc')
  assert.equal(limitHtml('', { maxRows: 2, maxCols: 10 }), '')
})

test('limitHtml: trims middle, keeps head and tail batches', () => {
  const html = 'x'.repeat(100)
  const out = limitHtml(html, { maxRows: 2, maxCols: 10 })
  const parts = out.split('\n')
  // Two batches (head and tail)
  assert.equal(parts.length, 2)
  assert.equal(parts[0].length, 10)
  assert.equal(parts[1].length, 10)
})

test('limitHtml (lineAware): keeps head/tail lines and enforces maxCols per line', () => {
  const lines = [
    'A'.repeat(50),
    'B'.repeat(50),
    'C'.repeat(50),
    'D'.repeat(50),
    'E'.repeat(50),
    'F'.repeat(50),
  ]
  const html = lines.join('\n')
  const out = limitHtml(html, { maxRows: 4, maxCols: 10, lineAware: true })
  const parts = out.split('\n')
  // Should keep 2 head + 2 tail lines
  assert.equal(parts.length, 4)
  assert.equal(parts[0], 'A'.repeat(10))
  assert.equal(parts[1], 'B'.repeat(10))
  assert.equal(parts[2], 'E'.repeat(10))
  assert.equal(parts[3], 'F'.repeat(10))
})

test('sleep: waits roughly the requested time', async () => {
  const t0 = Date.now()
  await sleep(20)
  const dt = Date.now() - t0
  assert.ok(dt >= 15)
})
