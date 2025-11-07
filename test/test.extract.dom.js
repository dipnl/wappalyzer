"use strict"
const test = require('node:test')
const assert = require('node:assert/strict')
const puppeteer = require('puppeteer')

// Use same headless args as other tests via env CHROMIUM_ARGS if provided
function getLaunchArgs() {
  const env = process.env.CHROMIUM_ARGS || ''
  return env.split(' ').filter(Boolean)
}

async function withPage(html, fn) {
  const browser = await puppeteer.launch({ headless: 'new', args: getLaunchArgs() })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    return await fn(page)
  } finally {
    await browser.close()
  }
}

const { getDom } = require('../src/driver/extract')

// Technology stubs mirroring schema used by getDom
const TechAttr = {
  name: 'AttrTech',
  dom: {
    'a.link': [
      {
        attributes: { 'data-preactroot': '' },
      },
    ],
  },
}

const TechProp = {
  name: 'PropTech',
  dom: {
    'div#root': [
      {
        properties: { __k: '' },
      },
    ],
  },
}

test('getDom does not emit attribute detections when attribute is absent', async () => {
  const html = `<!doctype html><html><body>
    <a class="link" href="#">hello</a>
  </body></html>`
  const out = await withPage(html, (page) => getDom(page, [TechAttr]))
  assert.equal(Array.isArray(out), true)
  const attrDetections = out.filter(x => x.attribute === 'data-preactroot')
  assert.equal(attrDetections.length, 0, 'should not emit attribute when missing')
})

test('getDom emits attribute detection only when attribute exists', async () => {
  const html = `<!doctype html><html><body>
    <a class="link" href="#" data-preactroot="">with attr</a>
  </body></html>`
  const out = await withPage(html, (page) => getDom(page, [TechAttr]))
  const attrDetections = out.filter(x => x.attribute === 'data-preactroot')
  assert.equal(attrDetections.length, 1, 'should emit exactly one attribute detection')
  assert.equal(attrDetections[0].selector, 'a.link')
})

test('getDom does not emit property detections when element does not have own property', async () => {
  const html = `<!doctype html><html><body>
    <div id="root"></div>
  </body></html>`
  const out = await withPage(html, (page) => getDom(page, [TechProp]))
  const propDetections = out.filter(x => x.property === '__k')
  assert.equal(propDetections.length, 0, 'should not emit property when not an own property')
})

test('getDom emits property detection only when element has own property', async () => {
  const html = `<!doctype html><html><body>
    <div id="root"></div>
    <script>
      // Define an own property on the element to simulate frameworks like Preact
      const el = document.getElementById('root');
      Object.defineProperty(el, '__k', { value: 123, enumerable: true, configurable: true });
    </script>
  </body></html>`
  const out = await withPage(html, (page) => getDom(page, [TechProp]))
  const propDetections = out.filter(x => x.property === '__k')
  assert.equal(propDetections.length, 1, 'should emit exactly one property detection')
  assert.equal(propDetections[0].selector, 'div#root')
})
