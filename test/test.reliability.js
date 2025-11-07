"use strict"
const test = require('node:test')
const assert = require('node:assert/strict')
const { computeBackoffDelay, computeRateLimitWait } = require('../src/driver/policies')

// Fixed now timestamp for deterministic tests
const NOW = Date.parse('2024-01-01T00:00:00Z')

test('computeBackoffDelay: numeric Retry-After seconds', () => {
  const d429 = computeBackoffDelay(429, '7', NOW, { capMs: 60000, jitterPct: 0 })
  assert.equal(d429, 7000)
  const d503 = computeBackoffDelay(503, '1', NOW, { capMs: 60000, jitterPct: 0 })
  assert.equal(d503, 1000)
})

test('computeBackoffDelay: HTTP-date Retry-After', () => {
  const date = new Date(NOW + 9000).toUTCString()
  const d = computeBackoffDelay(429, date, NOW, { capMs: 60000, jitterPct: 0 })
  assert.equal(d, 9000)
})

test('computeBackoffDelay: default delay and cap', () => {
  // No Retry-After header -> default for 429 is 5000ms
  const d = computeBackoffDelay(429, undefined, NOW, { capMs: 3000, jitterPct: 0 })
  assert.equal(d, 3000, 'should cap to 3000ms')
})

test('computeRateLimitWait: computes remaining wait', () => {
  const last = NOW - 100
  const wait = computeRateLimitWait(last, NOW, 200)
  assert.equal(wait, 100)
})

test('computeRateLimitWait: returns 0 when enough time elapsed or disabled', () => {
  assert.equal(computeRateLimitWait(NOW - 500, NOW, 200), 0)
  assert.equal(computeRateLimitWait(NOW - 500, NOW, 0), 0)
  // When there is no lastAt timestamp, current behavior is to proceed immediately (no initial wait)
  assert.equal(computeRateLimitWait(undefined, NOW, 200), 0)
})
