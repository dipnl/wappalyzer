'use strict'

const Wappalyzer = require('../../wappalyzer')

/**
 * Evaluate JS variables on the page based on technology.js chains.
 * Extracted from driver.js for modularity. Behavior unchanged.
 * @param {import('puppeteer').Page} page
 * @param {Array} technologies
 * @returns {Promise<Array<{name:string,chain:string,value:any}>>}
 */
async function getJs(page, technologies = Wappalyzer.technologies) {
  // Prepare a minimal, serializable snapshot to pass into the page context.
  const techs = (technologies || [])
    .filter((t) => t && t.js && typeof t.js === 'object')
    .map((t) => ({ name: t.name, js: t.js }))

  return page.evaluate((technologies) => {
    technologies = Array.isArray(technologies) ? technologies : []

    return technologies
      .filter(({ js }) => js && Object.keys(js).length)
      .map(({ name, js }) => ({ name, chains: Object.keys(js) }))
      .reduce((technologies, { name, chains }) => {
        chains.forEach((chain) => {
          // Parse chain into tokens supporting dot and bracket notation without losing hyphenated keys
          // Example inputs: "dataLayer", "window.google_tag_manager['GTM-XXXX']", "foo['bar-baz'][0]"
          const tokens = []
          let first = null
          const head = /^\s*([a-z_$][a-z0-9_$]*)/i.exec(chain)
          if (head) {
            first = head[1]
            let rest = chain.slice(head[0].length)
            const re = /(?:\.([a-z_$][a-z0-9_$]*))|(?:\[\s*(['"]?)(.*?)\2\s*\])/gi
            let m
            while ((m = re.exec(rest)) !== null) {
              if (m[1]) {
                tokens.push(m[1])
              } else {
                tokens.push(m[3])
              }
            }
          } else {
            // If no valid head identifier, abort this chain to avoid false positives
            first = null
          }

          let root
          try {
            if (first) {
              root = window[first]
            } else {
              root = undefined
            }
          } catch (e) {
            root = undefined
          }

          const value = (tokens || []).reduce(
            (value, key) =>
              value &&
              value instanceof Object &&
              Object.prototype.hasOwnProperty.call(value, key)
                ? value[key]
                : '__UNDEFINED__',
            root || '__UNDEFINED__'
          )

          if (value !== '__UNDEFINED__') {
            technologies.push({
              name,
              chain,
              value:
                typeof value === 'string' || typeof value === 'number'
                  ? value
                  : !!value,
            })
          }
        })

        return technologies
      }, [])
  }, techs)
}

/**
 * Query the DOM for selectors and extract properties/attributes/text.
 * Extracted from driver.js for modularity. Behavior unchanged.
 * @param {import('puppeteer').Page} page
 * @param {Array} technologies
 * @returns {Promise<Array>}
 */
async function getDom(page, technologies = Wappalyzer.technologies) {
  // Prepare a minimal, serializable snapshot for DOM extraction.
  const techs = (technologies || [])
    .filter((t) => t && t.dom && typeof t.dom === 'object')
    .map((t) => ({ name: t.name, dom: t.dom }))

  return page.evaluate((techDefs) => {
    const list = Array.isArray(techDefs) ? techDefs : []
    const results = []

    const toScalar = (value) =>
      typeof value === 'string' || typeof value === 'number' ? value : !!value

    for (let i = 0; i < list.length; i++) {
      const def = list[i]
      if (!def || !def.dom || def.dom.constructor !== Object) continue
      const name = def.name
      const dom = def.dom

      const selectors = Object.keys(dom)
      for (let s = 0; s < selectors.length; s++) {
        const selector = selectors[s]
        let nodes = []
        try {
          nodes = document.querySelectorAll(selector)
        } catch (error) {
          // continue
        }
        if (!nodes || !nodes.length) continue

        const rules = Array.isArray(dom[selector]) ? dom[selector] : []
        for (let r = 0; r < rules.length; r++) {
          const { exists, text, properties, attributes } = rules[r]

          // iterate NodeList
          for (let n = 0; n < nodes.length; n++) {
            const node = nodes[n]

            // Limit matches per technology
            if (results.filter(({ name: _name }) => _name === name).length >= 50) {
              break
            }

            if (
              exists &&
              results.findIndex(
                ({ name: _name, selector: _selector, exists }) =>
                  name === _name && selector === _selector && exists === ''
              ) === -1
            ) {
              results.push({ name, selector, exists: '' })
            }

            if (text) {
              const value = (node.textContent ? node.textContent.trim() : '').slice(
                0,
                1000000
              )
              if (
                value &&
                results.findIndex(
                  ({ name: _name, selector: _selector, text }) =>
                    name === _name && selector === _selector && text === value
                ) === -1
              ) {
                results.push({ name, selector, text: value })
              }
            }

            if (properties) {
              const propertyKeys = Object.keys(properties)
              for (let pk = 0; pk < propertyKeys.length; pk++) {
                const property = propertyKeys[pk]
                if (
                  results.findIndex(
                    ({ name: _name, selector: _selector, property: _property }) =>
                      name === _name && selector === _selector && property === _property
                  ) !== -1
                ) {
                  continue
                }
                // Only record when the property actually exists on this element (not via prototype)
                if (Object.prototype.hasOwnProperty.call(node, property)) {
                  const raw = node[property]
                  const value = toScalar(raw)
                  results.push({ name, selector, property, value })
                }
              }
            }

            if (attributes) {
              const attributeKeys = Object.keys(attributes)
              for (let ak = 0; ak < attributeKeys.length; ak++) {
                const attribute = attributeKeys[ak]
                if (
                  results.findIndex(
                    ({ name: _name, selector: _selector, attribute: _attribute }) =>
                      name === _name && selector === _selector && attribute === _attribute
                  ) !== -1
                ) {
                  continue
                }
                const raw = node.getAttribute(attribute)
                // Only record attribute when it is actually present on the element
                if (raw !== null) {
                  const value = toScalar(raw)
                  results.push({ name, selector, attribute, value })
                }
              }
            }
          }
        }
      }
    }

    return results
  }, techs)
}

module.exports = { getJs, getDom }
