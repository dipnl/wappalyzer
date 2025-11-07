// Tests for src/cli/args.js
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseArgs } = require('../src/cli/args')

test('parseArgs: basic flag and url collection', () => {
  const { options, urls } = parseArgs(['-P', 'https://example.com'])
  assert.equal(options.pretty, true)
  assert.deepEqual(urls, ['https://example.com'])
})

test('parseArgs: long flags and key=value', () => {
  const { options } = parseArgs(['--batch-size=3', '--max-urls', '10'])
  assert.equal(options.batchSize, '3')
  assert.equal(options.maxUrls, '10')
})

test('parseArgs: repeated flags become arrays', () => {
  const { options } = parseArgs(['-H', 'A:1', '-H', 'B:2'])
  assert.ok(Array.isArray(options.header))
  assert.deepEqual(options.header, ['A:1', 'B:2'])
})

test('parseArgs: kebab-case -> camelCase', () => {
  const { options } = parseArgs(['--no-scripts', '--user-agent', 'UA'])
  assert.equal(options.noScripts, true)
  assert.equal(options.userAgent, 'UA')
})
