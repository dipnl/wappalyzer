'use strict'

// Consolidated page data collection utilities extracted from driver.js
// Behavior-preserving: mirrors the evaluateHandle patterns and timeouts used inline.

const { getJs, getDom } = require('./extract')

const DEFAULT_OPTIONS = {
  htmlMaxRows: 3000,
}

const createHandleFallback = (fallback) => ({ jsonValue: () => fallback })

async function collectWithTimeout(promiseTimeout, handlePromise, fallback, label) {
  const handle = await promiseTimeout(handlePromise, createHandleFallback(fallback), label)

  return promiseTimeout(handle.jsonValue(), fallback, label)
}

async function collectLinks(page, promiseTimeout, recursive) {
  if (!recursive) {
    return []
  }

  return collectWithTimeout(
    promiseTimeout,
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
    [],
    'Timeout (links)'
  )
}

async function collectText(page, promiseTimeout) {
  return collectWithTimeout(
    promiseTimeout,
    page.evaluateHandle(
      () => document.body && document.body.innerText // eslint-disable-line unicorn/prefer-text-content
    ),
    '',
    'Timeout (text)'
  )
}

async function collectCss(page, promiseTimeout, htmlMaxRows) {
  return collectWithTimeout(
    promiseTimeout,
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
    }, htmlMaxRows),
    '',
    'Timeout (css)'
  )
}

async function collectScripts(page, promiseTimeout) {
  const [scriptSrc = [], scripts = []] = await collectWithTimeout(
    promiseTimeout,
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
    [],
    'Timeout (scripts)'
  )

  return { scriptSrc, scripts }
}

async function collectMeta(page, promiseTimeout) {
  return collectWithTimeout(
    promiseTimeout,
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
    [],
    'Timeout (meta)'
  )
}

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
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options }

  const [links, text, css, scriptData, meta, js, dom] = await Promise.all([
    collectLinks(page, promiseTimeout, resolvedOptions.recursive),
    collectText(page, promiseTimeout),
    collectCss(page, promiseTimeout, resolvedOptions.htmlMaxRows),
    collectScripts(page, promiseTimeout),
    collectMeta(page, promiseTimeout),
    resolvedOptions.noScripts
      ? []
      : promiseTimeout(getJs(page, activeTechnologies), [], 'Timeout (js)'),
    promiseTimeout(getDom(page, activeTechnologies), [], 'Timeout (dom)'),
  ])

  return {
    links,
    text,
    css,
    scripts: scriptData.scripts,
    scriptSrc: scriptData.scriptSrc,
    meta,
    js,
    dom,
  }
}

module.exports = { collectPageData }
