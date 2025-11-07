'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

const mod = require('../src/driver/analyze')

test('analyze facade exports functions from wappalyzer', () => {
  assert.ok(mod && typeof mod === 'object')
  assert.equal(typeof mod.analyze, 'function')
  assert.equal(typeof mod.analyzeManyToMany, 'function')
  assert.equal(typeof mod.resolve, 'function')
})
