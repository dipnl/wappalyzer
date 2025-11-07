'use strict'

// Consolidated page data collection utilities extracted from driver.js
// Behavior-preserving: mirrors the evaluateHandle patterns and timeouts used inline.

const { getJs, getDom } = require('./extract')

/**
 * Collects data from a Puppeteer page in parallel.
 * Note: All timeouts and labels are preserved to match historical behavior.
 *
 * @param {import('puppeteer').Page} page
 * @param {{ recursive?: boolean, noScripts?: boolean, htmlMaxRows?: number }} options
 * @param {any[]} activeTechnologies
 * @param {(promise: Promise<any>, fallback: any, label: string, timeout?: number) => Promise<any>} promiseTimeout
 * @returns {Promise<{links: any[], text: string, css: string, scripts: string[], scriptSrc: string[], meta: Record<string,string[]>, js: any[], dom: any[]}>}
 */
async function collectPageData(page, options, activeTechnologies, promiseTimeout) {
  let links = []
  let text = ''
  let css = ''
  let scriptSrc = []
  let scripts = []
  let meta = []
  let js = []
  let dom = []

  await Promise.all([
    (async () => {
      // Links
      links = !options.recursive
        ? []
        : await promiseTimeout(
            (
              await promiseTimeout(
                page.evaluateHandle(() =>
                  Array.from(document.getElementsByTagName('a')).map(
                    ({ hash, hostname, href, pathname, protocol, rel }) => ({
                      hash,
                      hostname,
                      href,
                      pathname,
                      protocol,
                      rel,
                    })
                  )
                ),
                { jsonValue: () => [] },
                'Timeout (links)'
              )
            ).jsonValue(),
            [],
            'Timeout (links)'
          )
    })(),
    (async () => {
      // Text
      text = await promiseTimeout(
        (
          await promiseTimeout(
            page.evaluateHandle(
              () => document.body && document.body.innerText // eslint-disable-line unicorn/prefer-text-content
            ),
            { jsonValue: () => '' },
            'Timeout (text)'
          )
        ).jsonValue(),
        '',
        'Timeout (text)'
      )
    })(),
    (async () => {
      // CSS
      css = await promiseTimeout(
        (
          await promiseTimeout(
            page.evaluateHandle((maxRows) => {
              const css = []

              try {
                if (!document.styleSheets.length) {
                  return ''
                }

                const getCssRules = (styleSheet, attempts = 0) => {
                  try {
                    return styleSheet.cssRules || []
                  } catch (error) {
                    if (attempts < 3) {
                      return getCssRules(styleSheet, attempts + 1)
                    }

                    return []
                  }
                }

                Array.from(document.styleSheets).forEach((styleSheet) => {
                  try {
                    Array.from(getCssRules(styleSheet)).forEach((cssRule) =>
                      css.push(cssRule && cssRule.cssText)
                    )
                  } catch (error) {
                    // Continue
                  }
                })
              } catch (error) {
                // Continue
              }

              return css.slice(0, maxRows).join('\n')
            }, options.htmlMaxRows || 3000),
            { jsonValue: () => '' },
            'Timeout (css)'
          )
        ).jsonValue(),
        '',
        'Timeout (css)'
      )
    })(),
    (async () => {
      // Scripts (src + inline)
      ;[scriptSrc, scripts] = await promiseTimeout(
        (
          await promiseTimeout(
            page.evaluateHandle(() => {
              const nodes = Array.from(document.scripts)

              return [
                nodes
                  .map((node) => node.src)
                  .filter((src) => src),
                nodes
                  .map((node) => node.textContent)
                  .filter((script) => script),
              ]
            }),
            { jsonValue: () => [] },
            'Timeout (scripts)'
          )
        ).jsonValue(),
        [],
        'Timeout (scripts)'
      )
    })(),
    (async () => {
      // Meta tags
      meta = await promiseTimeout(
        (
          await promiseTimeout(
            page.evaluateHandle(() =>
              Array.from(document.querySelectorAll('meta')).reduce(
                (metas, meta) => {
                  const key = meta.getAttribute('name') || meta.getAttribute('property')

                  if (key) {
                    metas[key.toLowerCase()] = metas[key.toLowerCase()] || []

                    metas[key.toLowerCase()].push(meta.getAttribute('content'))
                  }

                  return metas
                },
                {}
              )
            ),
            { jsonValue: () => [] },
            'Timeout (meta)'
          )
        ).jsonValue(),
        [],
        'Timeout (meta)'
      )
    })(),
    (async () => {
      // JavaScript
      js = options.noScripts
        ? []
        : await promiseTimeout(getJs(page, activeTechnologies), [], 'Timeout (js)')
    })(),
    (async () => {
      // DOM
      dom = await promiseTimeout(getDom(page, activeTechnologies), [], 'Timeout (dom)')
    })(),
  ])

  return { links, text, css, scripts, scriptSrc, meta, js, dom }
}

module.exports = { collectPageData }
