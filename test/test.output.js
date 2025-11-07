"use strict"
const test = require('node:test')
const assert = require('node:assert/strict')
const { formatTechnologyList } = require('../src/driver/output')

function mkTech(name, cats, confidence) {
  return {
    name,
    categories: (cats || []).map((n) => ({ id: n, name: `Cat${n}` })),
    confidence,
  }
}

test('formatTechnologyList: formats with categories and confidence', () => {
  const results = {
    technologies: [
      mkTech('BTech', [1, 2], 50),
      mkTech('ATech', [], 90),
      mkTech('CTech', [3], undefined),
    ],
  }
  const lines = formatTechnologyList(results)
  // Sorted by name
  assert.deepEqual(lines[0], 'ATech (90)')
  assert.deepEqual(lines[1], 'BTech (Cat1, Cat2 / 50)')
  assert.deepEqual(lines[2], 'CTech (Cat3)')
})
