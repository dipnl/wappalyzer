"use strict"
const test = require('node:test')
const assert = require('node:assert/strict')

const Driver = require('../driver')

function hasAnyCategory(tech, ids) {
  const set = new Set(ids)
  return Array.isArray(tech.categories) && tech.categories.some((cid) => set.has(cid))
}

test('Driver: filters active technologies by --category (single)', () => {
  const driver = new Driver({ category: '1' })
  assert.ok(Array.isArray(driver.activeTechnologies))
  assert.ok(driver.activeTechnologies.length > 0, 'no technologies selected for category 1')
  for (const t of driver.activeTechnologies) {
    assert.equal(hasAnyCategory(t, [1]), true, `tech ${t && t.name} missing expected category`)
  }
})

test('Driver: filters active technologies by --category (multiple, comma-separated)', () => {
  const driver = new Driver({ category: '1,6' })
  assert.ok(Array.isArray(driver.activeTechnologies))
  assert.ok(driver.activeTechnologies.length > 0, 'no technologies selected for categories 1,6')
  for (const t of driver.activeTechnologies) {
    assert.equal(hasAnyCategory(t, [1, 6]), true, `tech ${t && t.name} missing expected categories`)
  }
})
