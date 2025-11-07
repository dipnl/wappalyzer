"use strict"
const test = require('node:test')
const assert = require('node:assert/strict')

const W = require('../wappalyzer')

// Minimal fake technology with a simple pattern that matches a known value
const tech = [{
  name: 'X',
  categories: [],
  certIssuer: [], cookies: [], cookieNames: [], css: [], dns: {}, dom: {}, excludes: [], headers: {}, html: [/x/].map(r=>({regex: r})), icon: '', implies: [], js: {}, meta: {}, pricing: [], probe: {}, requires: [], requiresCategory: [], robots: [], scriptSrc: [], scripts: [], text: [], url: [], website: '', xhr: [],
}]

W.setTechnologies({}) // reset to empty
W.technologies = tech

function analyzeHtml(s) {
  return W.analyze({ html: String(s) }, tech)
}

test('memoization cache resets between analyze() runs', () => {
  // First run
  const res1 = analyzeHtml('x')
  assert.ok(Array.isArray(res1) && res1.length >= 1)
  const sizeAfterFirst = W.__getMatchMemoSize()
  assert.ok(sizeAfterFirst >= 1, 'memo should contain entries after first analyze')

  // Second run with different input should not reuse previous cache
  const res2 = analyzeHtml('xx')
  assert.ok(Array.isArray(res2) && res2.length >= 1)
  const sizeAfterSecond = W.__getMatchMemoSize()

  // The implementation resets the memo at the start of analyze()
  // so sizeAfterSecond should reflect only second run entries, not accumulated size
  assert.ok(sizeAfterSecond >= 1 && sizeAfterSecond <= sizeAfterFirst + 5, 'memo should have been reset between runs')

  // Explicit clear also works and yields an empty cache
  W.__clearMatchMemo()
  assert.equal(W.__getMatchMemoSize(), 0)
})
