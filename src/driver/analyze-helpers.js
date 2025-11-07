'use strict'

const Wappalyzer = require('../../wappalyzer')
const { analyzeManyToMany } = require('./analyze')

/**
 * Analyze JavaScript detections produced by getJs.
 * @param {Array<{ name: string, chain: string, value: any }>} js
 * @param {Array} [technologies=Wappalyzer.technologies]
 * @returns {Array}
 */
function analyzeJs(js, technologies = Wappalyzer.technologies) {
  return (js || [])
    .map(({ name, chain, value }) => {
      const technology = technologies.find(({ name: _name }) => name === _name)
      if (!technology) return []
      return analyzeManyToMany(technology, 'js', { [chain]: [value] })
    })
    .flat()
}

/**
 * Analyze DOM detections produced by getDom.
 * Supports dom.exists, dom.text, dom.properties.NAME, dom.attributes.NAME
 * @param {Array} dom
 * @param {Array} [technologies=Wappalyzer.technologies]
 * @returns {Array}
 */
function analyzeDom(dom, technologies = Wappalyzer.technologies) {
  return (dom || [])
    .map(({ name, selector, exists, text, property, attribute, value }) => {
      const technology = technologies.find(tech => tech && tech.name === name)
      if (!technology) return []

      if (typeof exists !== 'undefined') {
        return analyzeManyToMany(technology, 'dom.exists', {
          [selector]: [''],
        })
      }

      if (typeof text !== 'undefined') {
        return analyzeManyToMany(technology, 'dom.text', {
          [selector]: [text],
        })
      }

      if (typeof property !== 'undefined') {
        return analyzeManyToMany(technology, `dom.properties.${property}`, {
          [selector]: [value],
        })
      }

      if (typeof attribute !== 'undefined') {
        return analyzeManyToMany(technology, `dom.attributes.${attribute}`, {
          [selector]: [value],
        })
      }

      return []
    })
    .flat()
}

module.exports = { analyzeJs, analyzeDom }
