'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  hostMatches,
  isAllowedDomain,
  isBlockedDomain,
  parseRobots,
  isAllowedByRobots,
} = require('../src/driver/policies')

test('hostMatches: exact and suffix rules', () => {
  assert.equal(hostMatches('example.com', 'example.com'), true)
  assert.equal(hostMatches('a.example.com', 'example.com'), true)
  assert.equal(hostMatches('a.example.com', '.example.com'), true)
  assert.equal(hostMatches('example.net', '.example.com'), false)
})

test('isAllowedDomain: defaults to true, allows main host', () => {
  assert.equal(isAllowedDomain({}, 'foo.bar', 'example.com'), true)
  assert.equal(isAllowedDomain({ allowDomains: ['cdn.example.com'] }, 'example.com', 'example.com'), true)
  assert.equal(isAllowedDomain({ allowDomains: ['cdn.example.com'] }, 'a.example.com', 'example.com'), true)
  assert.equal(isAllowedDomain({ allowDomains: ['cdn.example.com'] }, 'cdn.example.com', 'example.com'), true)
  assert.equal(isAllowedDomain({ allowDomains: ['cdn.example.com'] }, 'other.com', 'example.com'), false)
})

test('isBlockedDomain: blocks when rule matches', () => {
  assert.equal(isBlockedDomain({ blockDomains: ['.tracker.com'] }, 'a.tracker.com'), true)
  assert.equal(isBlockedDomain({ blockDomains: ['ads.example.com'] }, 'ads.example.com'), true)
  assert.equal(isBlockedDomain({ blockDomains: ['ads.example.com'] }, 'cdn.example.com'), false)
})

test('parseRobots: extracts allow/disallow for UA * only', () => {
  const body = `# Sample\nUser-agent: *\nAllow: /public\nDisallow: /private\n\nUser-agent: Googlebot\nDisallow: /gbot-only\n`
  const { allow, disallow } = parseRobots(body)
  assert.deepEqual(allow, ['/public'])
  assert.deepEqual(disallow, ['/private'])
})

test('isAllowedByRobots: uses cache to decide without network', async () => {
  const url = new URL('https://example.com/private/page')
  const cache = { robots: { 'example.com': { allow: ['/public'], disallow: ['/private'], loaded: true } } }
  const allowed = await isAllowedByRobots(url, { respectRobots: true }, cache)
  assert.equal(allowed, false)
  const url2 = new URL('https://example.com/public/page')
  const allowed2 = await isAllowedByRobots(url2, { respectRobots: true }, cache)
  assert.equal(allowed2, true)
})


// Additional precedence test: longest allow vs disallow
const { isAllowedByRobots: _isAllowedByRobots } = require('../src/driver/policies')

test('robots precedence: longer allow beats shorter disallow', async () => {
  const url = new URL('https://example.com/public/section/page')
  const cache = { robots: { 'example.com': { allow: ['/public/section'], disallow: ['/public'], loaded: true } } }
  const allowed = await _isAllowedByRobots(url, { respectRobots: true }, cache)
  assert.equal(allowed, true)
})
