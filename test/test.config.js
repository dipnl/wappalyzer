'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadCategories, loadTechnologies, loadConfig } = require('../src/config')

test('loadCategories: loads known category', () => {
  const cats = loadCategories()
  assert.ok(cats && typeof cats === 'object')
  assert.equal(cats['1'].name, 'CMS')
})

test('loadTechnologies: returns non-empty object', () => {
  const tech = loadTechnologies()
  assert.ok(tech && typeof tech === 'object')
  assert.ok(Object.keys(tech).length > 0)
})

test('loadConfig: returns both categoryMap and technologies', () => {
  const cfg = loadConfig()
  assert.ok(cfg.categoryMap && typeof cfg.categoryMap === 'object')
  assert.ok(cfg.technologies && typeof cfg.technologies === 'object')
})
