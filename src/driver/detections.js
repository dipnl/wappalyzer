'use strict'

const { analyze, resolve } = require('./analyze')
const { analyzeJs, analyzeDom } = require('./analyze-helpers')

class DetectionStore {
  constructor() {
    this.items = []
    this.requireChecks = new Set()
  }

  runAnalysis(data, technologies) {
    const { url, html, cookies, cookieNames, text, css, scripts, scriptSrc, meta, js, dom } = data

    const results = []

    if (dom && dom.length) {
      results.push(...analyzeDom(dom, technologies))
    }
    if (js && js.length) {
      results.push(...analyzeJs(js, technologies))
    }
    results.push(
      ...analyze(
        {
          url,
          html,
          cookies,
          cookieNames,
          text,
          css,
          scripts,
          scriptSrc,
          meta,
        },
        technologies
      )
    )

    return results
  }

  addDetections(url, detections) {
    const existing = new Map(this.items.map((det) => [DetectionStore.detectionKey(det), det]))

    let added = false
    for (const detection of detections) {
      if (!detection || !detection.technology) continue
      const key = DetectionStore.detectionKey(detection)
      if (existing.has(key)) continue
      detection.lastUrl = url.href
      detection.rootPath = url.pathname === '/'
      this.items.push(detection)
      existing.set(key, detection)
      added = true
    }

    return added
  }

  runDependentAnalyses(url, pageData, baseSignals, dependentByTechnology, dependentByCategory) {
    const data = {
      url,
      ...baseSignals,
      ...pageData,
    }

    let updated = false
    do {
      updated = false
      const resolved = resolve(this.items)
      const detectedNames = new Set(resolved.map(({ name }) => name))
      const detectedCategoryIds = new Set(
        resolved.flatMap((entry) => (entry.categories || []).map((cat) => cat.id))
      )

      for (const entry of dependentByTechnology) {
        if (!detectedNames.has(entry.name)) continue
        if (this.requireChecks.has(`tech:${entry.name}`)) continue
        this.requireChecks.add(`tech:${entry.name}`)
        const detections = this.runAnalysis(data, entry.technologies || [])
        const added = this.addDetections(url, detections)
        if (added) updated = true
      }

      for (const entry of dependentByCategory) {
        if (!detectedCategoryIds.has(entry.categoryId)) continue
        const key = `cat:${entry.categoryId}`
        if (this.requireChecks.has(key)) continue
        this.requireChecks.add(key)
        const detections = this.runAnalysis(data, entry.technologies || [])
        const added = this.addDetections(url, detections)
        if (added) updated = true
      }
    } while (updated)
  }

  buildResult(analyzedUrls, cookieNameSet) {
    const resolved = resolve(this.items)

    const technologies = resolved.map(
      ({
        name,
        slug,
        description,
        confidence,
        version,
        icon,
        website,
        cpe,
        categories,
        rootPath,
      }) => ({
        name,
        slug,
        description,
        confidence,
        version: version || null,
        icon,
        website,
        cpe,
        categories: (categories || []).map(({ id, slug, name: categoryName }) => ({
          id,
          slug,
          name: categoryName,
        })),
        rootPath,
      })
    )

    return {
      urls: analyzedUrls,
      technologies,
      cookieNames: Array.from(cookieNameSet),
    }
  }

  static detectionKey(detection) {
    const tech = detection.technology || {}
    const pattern = detection.pattern || {}
    return [
      tech.name || '',
      pattern.type || '',
      pattern.regex ? pattern.regex.toString() : '',
      pattern.version || '',
    ].join('#')
  }
}

module.exports = {
  DetectionStore,
}

