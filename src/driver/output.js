'use strict'

// Output shaping helpers.

function formatTechnologyList(results) {
  const list = (results.technologies || [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => {
      const cats = (t.categories || []).map((c) => c.name).filter(Boolean)
      const catStr = cats.join(', ')
      const conf =
        typeof t.confidence === 'number' && !Number.isNaN(t.confidence)
          ? String(t.confidence)
          : t.confidence != null
          ? String(t.confidence)
          : ''
      if (catStr && conf !== '') {
        return `${t.name} (${catStr} / ${conf})`
      } else if (catStr) {
        return `${t.name} (${catStr})`
      } else if (conf !== '') {
        return `${t.name} (${conf})`
      }
      return `${t.name}`
    })
  return list
}

function structureDetections(detections) {
  const out = {
    certIssuer: [],
    cookies: [],
    cookieNames: [],
    css: [],
    dns: [],
    headers: [],
    html: [],
    meta: [],
    probe: [],
    robots: [],
    scriptSrc: [],
    scripts: [],
    text: [],
    url: [],
    xhr: [],
    js: [],
    dom: [],
  }

  const push = (key, obj) => {
    if (!out[key]) out[key] = []
    out[key].push(obj)
  }

  const safeStr = (v) => {
    if (v == null) return v
    const s = String(v)
    return s.length <= 1000 ? s : s.slice(0, 1000)
  }

  for (const det of detections || []) {
    const tech = det.technology && det.technology.name
    const conf = det.pattern && det.pattern.confidence
    const ver = det.version || ''
    const type = det.pattern && det.pattern.type
    const value = det.pattern && det.pattern.value
    const match = det.pattern && det.pattern.match
    const origKey = det.pattern && det.pattern.origKey

    if (!type) continue

    // DOM subtypes
    if (type.startsWith('dom')) {
      // dom.exists | dom.text | dom.properties.NAME | dom.attributes.NAME
      const parts = type.split('.')
      const kind = parts[1] || 'exists'
      let name = null
      if (parts[2]) name = parts[2]
      push('dom', {
        technology: tech,
        selector: origKey, // for dom we stored selector as origKey in analyzeManyToMany call
        kind,
        name: name || undefined,
        value: safeStr(value),
        match: safeStr(match),
        version: ver,
        confidence: conf,
      })
      continue
    }

    switch (type) {
      case 'cookies':
        push('cookies', {
          technology: tech,
          key: origKey,
          value: safeStr(value),
          match: safeStr(match),
          version: ver,
          confidence: conf,
        })
        break
      case 'cookieNames':
        push('cookieNames', {
          technology: tech,
          name: safeStr(value),
          match: safeStr(match),
          version: ver,
          confidence: conf,
        })
        break
      case 'headers':
        push('headers', {
          technology: tech,
          key: origKey,
          value: safeStr(value),
          match: safeStr(match),
          version: ver,
          confidence: conf,
        })
        break
      case 'meta':
        push('meta', {
          technology: tech,
          key: origKey,
          value: safeStr(value),
          match: safeStr(match),
          version: ver,
          confidence: conf,
        })
        break
      case 'scriptSrc':
        push('scriptSrc', {
          technology: tech,
          value: safeStr(value),
          match: safeStr(match),
          version: ver,
          confidence: conf,
        })
        break
      case 'scripts':
        push('scripts', {
          technology: tech,
          match: safeStr(match),
          version: ver,
          confidence: conf,
        })
        break
      case 'js':
        push('js', {
          technology: tech,
          chain: origKey,
          value: safeStr(value),
          match: safeStr(match),
          version: ver,
          confidence: conf,
        })
        break
      case 'dns':
      case 'url':
      case 'xhr':
      case 'text':
      case 'html':
      case 'css':
      case 'robots':
      case 'probe':
      case 'certIssuer':
        push(type, {
          technology: tech,
          value: safeStr(value),
          match: safeStr(match),
          version: ver,
          confidence: conf,
        })
        break
      default:
        // Unknown/new type: place under its type key to avoid data loss
        push(type, {
          technology: tech,
          value: safeStr(value),
          match: safeStr(match),
          version: ver,
          confidence: conf,
        })
    }
  }

  return out
}

module.exports = { formatTechnologyList, structureDetections }
