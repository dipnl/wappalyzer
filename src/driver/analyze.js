'use strict'

// Thin facade around the core Wappalyzer analyze helpers.
// This indirection allows driver.js to depend on a small module boundary
// and makes future testing/mocking easier without touching the core.

const Wappalyzer = require('../../wappalyzer')

const { analyze, analyzeManyToMany, resolve } = Wappalyzer

module.exports = {
  analyze,
  analyzeManyToMany,
  resolve,
}
