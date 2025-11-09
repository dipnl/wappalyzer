'use strict'

const benchmarkEnvEnabled =
  typeof process !== 'undefined' ? Boolean(process.env.WAPPALYZER_BENCHMARK) : false

class MatchMemo {
  constructor() {
    this.clear()
  }

  _getKey(regex, value) {
    return `${regex.source}__${regex.flags}__${value}`
  }

  exec(regex, value) {
    const key = this._getKey(regex, value)
    if (this.cache.has(key)) {
      return this.cache.get(key)
    }

    const result = regex.exec(value)
    this.cache.set(key, result)
    return result
  }

  clear() {
    this.cache = new Map()
  }

  size() {
    return this.cache.size
  }
}

class BenchmarkRecorder {
  constructor(enabled = benchmarkEnvEnabled) {
    this.enabled = enabled
    this.reset()
  }

  record(duration, pattern, value = '', technology) {
    if (!this.enabled) return

    this.entries.push({
      duration,
      pattern: String(pattern.regex),
      value: String(value).slice(0, 100),
      valueLength: value.length,
      technology: technology.name,
    })
  }

  reset() {
    this.entries = []
  }

  summarize() {
    if (!this.enabled || !this.entries.length) {
      return null
    }

    const totalPatterns = this.entries.length
    const totalDuration = this.entries.reduce((sum, { duration }) => sum + duration, 0)

    const slowestByTechnology = Object.values(
      this.entries.reduce((accumulator, { duration, technology }) => {
        if (!accumulator[technology]) {
          accumulator[technology] = { technology, duration: 0 }
        }
        accumulator[technology].duration += duration
        return accumulator
      }, {})
    )
      .sort((a, b) => (a.duration > b.duration ? -1 : 1))
      .filter(({ duration }) => duration)
      .slice(0, 5)
      .reduce((technologies, { technology, duration }) => {
        technologies[technology] = duration
        return technologies
      }, {})

    const slowestPatterns = this.entries
      .slice()
      .sort((a, b) => (a.duration > b.duration ? -1 : 1))
      .filter(({ duration }) => duration)
      .slice(0, 5)

    return {
      totalPatterns,
      totalDuration,
      averageDuration: Math.round(totalDuration / totalPatterns),
      slowestTechnologies: slowestByTechnology,
      slowestPatterns,
    }
  }

  logSummary() {
    const summary = this.summarize()
    if (!summary) return

    // eslint-disable-next-line no-console
    console.log(summary)
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : [value]
}

function slugify(string) {
  return string
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/(?:^-|-$)/g, '')
}

function parsePattern(pattern, isRegex = true) {
  if (pattern && typeof pattern === 'object' && !Array.isArray(pattern)) {
    return Object.keys(pattern).reduce((parsed, key) => {
      parsed[key] = parsePattern(pattern[key], isRegex)
      return parsed
    }, {})
  }

  const rawPattern = pattern != null ? pattern.toString() : ''
  const [firstSegment, ...segments] = rawPattern.split('\\;')

  const attributes = segments.reduce((attrs, segment) => {
    const [key, ...rest] = segment.split(':')
    if (key) {
      attrs[key] = rest.join(':')
    }
    return attrs
  }, {})

  const regexSource = isRegex
    ? firstSegment
        .replace(/\//g, '\\/')
        .replace(/\\\+/g, '__escapedPlus__')
        .replace(/\+/g, '{1,250}')
        .replace(/\*/g, '{0,250}')
        .replace(/__escapedPlus__/g, '\\+')
    : firstSegment

  return {
    value: typeof pattern === 'number' ? pattern : firstSegment,
    regex: new RegExp(regexSource, 'i'),
    confidence: Number.parseInt(attributes.confidence || 100, 10),
    version: attributes.version || '',
  }
}

function transformPatterns(patterns, caseSensitive = false, isRegex = true) {
  if (!patterns) {
    return []
  }

  const normalized =
    typeof patterns === 'string' || typeof patterns === 'number' || Array.isArray(patterns)
      ? { main: patterns }
      : patterns

  const parsed = Object.keys(normalized).reduce((accumulator, key) => {
    const targetKey = caseSensitive ? key : key.toLowerCase()
    accumulator[targetKey] = toArray(normalized[key]).map((pattern) => parsePattern(pattern, isRegex))
    return accumulator
  }, {})

  return Object.prototype.hasOwnProperty.call(parsed, 'main') ? parsed.main : parsed
}

function normalizeDomRules(dom) {
  if (typeof dom === 'string' || Array.isArray(dom)) {
    return toArray(dom).reduce((accumulator, selector) => {
      return {
        ...accumulator,
        [selector]: { exists: '' },
      }
    }, {})
  }

  return dom
}

function runPattern({
  pattern,
  type,
  value,
  technology,
  origKey,
  execMatch,
  resolveVersion,
  benchmark,
}) {
  const startedAt = Date.now()
  const matches = execMatch(pattern.regex, value)

  if (!matches) {
    benchmark(Date.now() - startedAt, pattern, value, technology)
    return null
  }

  const detection = {
    technology,
    pattern: {
      ...pattern,
      type,
      value,
      match: matches[0],
      ...(origKey ? { origKey } : {}),
    },
    version: resolveVersion(pattern, value),
  }

  benchmark(Date.now() - startedAt, pattern, value, technology)

  return detection
}

function analyzeOneToOne(technology, type, value, helpers) {
  const patterns = technology[type] || []

  return patterns
    .map((pattern) =>
      runPattern({
        pattern,
        type,
        value,
        technology,
        execMatch: helpers.execMatch,
        resolveVersion: helpers.resolveVersion,
        benchmark: helpers.benchmark,
      })
    )
    .filter(Boolean)
}

function analyzeOneToMany(technology, type, items = [], helpers) {
  const patterns = technology[type] || []

  return items
    .map((value) =>
      patterns
        .map((pattern) =>
          runPattern({
            pattern,
            type,
            value,
            technology,
            execMatch: helpers.execMatch,
            resolveVersion: helpers.resolveVersion,
            benchmark: helpers.benchmark,
          })
        )
        .filter(Boolean)
    )
    .flat()
}

function analyzeManyToMany(technology, types, items = {}, helpers) {
  if (!technology || typeof technology !== 'object') {
    return []
  }

  const [type, ...subtypes] = types.split('.')
  if (!technology[type] || typeof technology[type] !== 'object') {
    return []
  }

  return Object.keys(technology[type])
    .map((key) => {
      const patterns = technology[type][key] || []
      const values = items[key] || []

      return patterns
        .map((originalPattern) => {
          const pattern = subtypes.reduce(
            (current, subtype) => (current && current[subtype]) || {},
            originalPattern
          )

          return values
            .map((value) =>
              runPattern({
                pattern,
                type,
                value,
                technology,
                origKey: key,
                execMatch: helpers.execMatch,
                resolveVersion: helpers.resolveVersion,
                benchmark: helpers.benchmark,
              })
            )
            .filter(Boolean)
        })
        .flat()
    })
    .flat()
}

function aggregateDetections(detections) {
  const byTechnology = new Map()

  detections.forEach((detection) => {
    if (!detection || !detection.technology) {
      return
    }

    const name = detection.technology.name
    if (!byTechnology.has(name)) {
      byTechnology.set(name, [])
    }
    byTechnology.get(name).push(detection)
  })

  return Array.from(byTechnology.values()).map((entries) => {
    const [first] = entries
    let confidence = 0
    let version = ''
    let rootPath
    let lastUrl

    entries.forEach(({ pattern, version: detectedVersion, rootPath: detectionRootPath, lastUrl: detectionLastUrl }) => {
      confidence = Math.min(100, confidence + pattern.confidence)

      if (
        detectedVersion &&
        detectedVersion.length > version.length &&
        detectedVersion.length <= 15 &&
        (parseInt(detectedVersion, 10) || 0) < 10000
      ) {
        version = detectedVersion
      }

      if (!rootPath && detectionRootPath !== undefined) {
        rootPath = detectionRootPath || undefined
      }

      if (detectionLastUrl) {
        lastUrl = detectionLastUrl
      }
    })

    return {
      technology: first.technology,
      confidence,
      version,
      rootPath,
      lastUrl,
    }
  })
}

function resolveExcludes(resolved, getTechnology) {
  resolved.forEach(({ technology }) => {
    technology.excludes.forEach(({ name }) => {
      const excluded = getTechnology(name)
      if (!excluded) {
        throw new Error(`Excluded technology does not exist: ${name}`)
      }

      for (let index = resolved.length - 1; index >= 0; index -= 1) {
        if (resolved[index].technology.name === excluded.name) {
          resolved.splice(index, 1)
        }
      }
    })
  })
}

function resolveImplies(resolved, getTechnology) {
  let updated

  do {
    updated = false

    resolved.forEach(({ technology, confidence, lastUrl }) => {
      technology.implies.forEach(({ name, confidence: impliedConfidence, version }) => {
        const implied = getTechnology(name)
        if (!implied) {
          throw new Error(`Implied technology does not exist: ${name}`)
        }

        const contribution = Math.round((confidence * impliedConfidence) / 100)

        const existing = resolved.find(({ technology: current }) => current.name === implied.name)
        if (existing) {
          const previous = existing.confidence
          existing.confidence = Math.max(existing.confidence, contribution)
          if (existing.confidence !== previous) {
            updated = true
          }
          return
        }

        resolved.push({
          technology: implied,
          confidence: contribution,
          version: version || '',
          lastUrl,
        })
        updated = true
      })
    })
  } while (resolved.length && updated)
}

function mapResolvedOutput(resolved, getCategory) {
  const priority = ({ technology: { categories } }) =>
    categories.reduce((max, id) => Math.max(max, getCategory(id).priority), 0)

  return resolved
    .sort((a, b) => (priority(a) > priority(b) ? 1 : -1))
    .map(
      ({
        technology: { name, description, slug, categories, icon, website, pricing, cpe },
        confidence,
        version,
        rootPath,
        lastUrl,
      }) => ({
        name,
        description,
        slug,
        categories: categories.map((id) => getCategory(id)),
        confidence,
        version,
        icon,
        website,
        pricing,
        cpe,
        rootPath,
        lastUrl,
      })
    )
}

class WappalyzerCore {
  constructor({ benchmarkEnabled = benchmarkEnvEnabled } = {}) {
    this.matchMemo = new MatchMemo()
    this.benchmarks = new BenchmarkRecorder(benchmarkEnabled)

    this.technologies = []
    this.categories = []
    this.requires = []
    this.categoryRequires = []
    this._technologyByName = new Map()
  }

  slugify(string) {
    return slugify(string)
  }

  getTechnology(name) {
    return this._technologyByName.get(name)
  }

  getCategory(id) {
    return this.categories.find((category) => category.id === id)
  }

  resolve(detections = []) {
    const aggregated = aggregateDetections(detections)

    resolveExcludes(aggregated, (name) => this.getTechnology(name))
    resolveImplies(aggregated, (name) => this.getTechnology(name))

    return mapResolvedOutput(aggregated, (id) => this.getCategory(id))
  }

  resolveVersion({ version, regex }, match) {
    let resolved = version

    if (!version) {
      return resolved
    }

    const matches = regex.exec(match)
    if (!matches) {
      return resolved
    }

    matches.forEach((matched, index) => {
      if (String(matched).length > 10) {
        return
      }

      const ternary = new RegExp(`\\\\${index}\\?([^:]+):(.*)$`).exec(version)
      if (ternary && ternary.length === 3) {
        resolved = version.replace(ternary[0], matched ? ternary[1] : ternary[2])
      }

      resolved = resolved.trim().replace(new RegExp(`\\\\${index}`, 'g'), matched || '')
    })

    return resolved.replace(/\\\d/, '')
  }

  analyze(items, technologies = this.technologies) {
    this.benchmarks.reset()
    this.matchMemo.clear()

    const helpers = {
      execMatch: (regex, value) => this.matchMemo.exec(regex, value),
      resolveVersion: (pattern, value) => this.resolveVersion(pattern, value),
      benchmark: (duration, pattern, value, technology) =>
        this.benchmarks.record(duration, pattern, value, technology),
    }

    const relations = {
      certIssuer: (technology, type, value) => analyzeOneToOne(technology, type, value, helpers),
      cookies: (technology, type, value) => analyzeManyToMany(technology, type, value, helpers),
      cookieNames: (technology, type, value) => analyzeOneToMany(technology, type, value, helpers),
      css: (technology, type, value) => analyzeOneToOne(technology, type, value, helpers),
      dns: (technology, type, value) => analyzeManyToMany(technology, type, value, helpers),
      headers: (technology, type, value) => analyzeManyToMany(technology, type, value, helpers),
      html: (technology, type, value) => analyzeOneToOne(technology, type, value, helpers),
      meta: (technology, type, value) => analyzeManyToMany(technology, type, value, helpers),
      probe: (technology, type, value) => analyzeManyToMany(technology, type, value, helpers),
      robots: (technology, type, value) => analyzeOneToOne(technology, type, value, helpers),
      scriptSrc: (technology, type, value) => analyzeOneToMany(technology, type, value, helpers),
      scripts: (technology, type, value) => analyzeOneToOne(technology, type, value, helpers),
      text: (technology, type, value) => analyzeOneToOne(technology, type, value, helpers),
      url: (technology, type, value) => analyzeOneToOne(technology, type, value, helpers),
      xhr: (technology, type, value) => analyzeOneToOne(technology, type, value, helpers),
    }

    try {
      const detections = technologies
        .map((technology) =>
          Object.keys(relations)
            .map((type) => (items[type] ? relations[type](technology, type, items[type]) : []))
            .flat()
        )
        .flat()
        .filter(Boolean)

      this.benchmarks.logSummary()

      return detections
    } catch (error) {
      throw new Error(error.message || error.toString())
    }
  }

  setTechnologies(data) {
    const technologyList = Object.keys(data).map((name) => {
      const definition = data[name]

      const {
        cats,
        certIssuer,
        cookies,
        cookieNames,
        cpe,
        css,
        description,
        dns,
        dom,
        excludes,
        headers,
        html,
        icon,
        implies,
        js,
        meta,
        pricing,
        probe,
        requires,
        requiresCategory,
        robots,
        scriptSrc,
        scripts,
        text,
        url,
        website,
        xhr,
      } = definition

      return {
        name,
        slug: this.slugify(name),
        categories: (cats || []).map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id)),
        certIssuer: transformPatterns(certIssuer),
        cookies: transformPatterns(cookies),
        cookieNames: transformPatterns(cookieNames),
        cpe: cpe || null,
        css: transformPatterns(css),
        description: description || null,
        dns: transformPatterns(dns),
        dom: transformPatterns(normalizeDomRules(dom), true, false),
        excludes: transformPatterns(excludes).map(({ value }) => ({ name: value })),
        headers: transformPatterns(headers),
        html: transformPatterns(html),
        icon: icon || 'default.svg',
        implies: transformPatterns(implies).map(({ value, confidence, version }) => ({
          name: value,
          confidence,
          version,
        })),
        js: transformPatterns(js, true),
        meta: transformPatterns(meta),
        pricing: pricing || [],
        probe: transformPatterns(probe, true),
        requires: transformPatterns(requires).map(({ value }) => ({ name: value })),
        requiresCategory: transformPatterns(requiresCategory).map(({ value }) => ({
          id: value,
        })),
        robots: transformPatterns(robots),
        scriptSrc: transformPatterns(scriptSrc),
        scripts: transformPatterns(scripts),
        text: transformPatterns(text),
        url: transformPatterns(url),
        website: website || null,
        xhr: transformPatterns(xhr),
      }
    })

    const technologyByName = new Map(technologyList.map((technology) => [technology.name, technology]))

    const requiresMap = {}
    const categoryRequiresMap = {}

    technologyList
      .filter(({ requires }) => requires.length)
      .forEach((technology) => {
        technology.requires.forEach(({ name }) => {
          if (!technologyByName.has(name)) {
            throw new Error(`Required technology does not exist: ${name}`)
          }

          requiresMap[name] = requiresMap[name] || []
          requiresMap[name].push(technology)
        })
      })

    technologyList
      .filter(({ requiresCategory }) => requiresCategory.length)
      .forEach((technology) => {
        technology.requiresCategory.forEach(({ id }) => {
          categoryRequiresMap[id] = categoryRequiresMap[id] || []
          categoryRequiresMap[id].push(technology)
        })
      })

    this.requires = Object.keys(requiresMap).map((name) => ({
      name,
      technologies: requiresMap[name],
    }))

    this.categoryRequires = Object.keys(categoryRequiresMap).map((id) => ({
      categoryId: parseInt(id, 10),
      technologies: categoryRequiresMap[id],
    }))

    this.technologies = technologyList.filter(
      ({ requires, requiresCategory }) => !requires.length && !requiresCategory.length
    )

    this._technologyByName = technologyByName
  }

  setCategories(data) {
    this.categories = Object.keys(data)
      .map((id) => {
        const category = data[id]
        return {
          id: parseInt(id, 10),
          slug: this.slugify(category.name),
          ...category,
        }
      })
      .sort(({ priority: a }, { priority: b }) => (a > b ? -1 : 0))
  }

  transformPatterns(patterns, caseSensitive = false, isRegex = true) {
    return transformPatterns(patterns, caseSensitive, isRegex)
  }

  parsePattern(pattern, isRegex = true) {
    return parsePattern(pattern, isRegex)
  }

  analyzeOneToOne(technology, type, value) {
    return analyzeOneToOne(technology, type, value, {
      execMatch: (regex, input) => this.matchMemo.exec(regex, input),
      resolveVersion: (pattern, input) => this.resolveVersion(pattern, input),
      benchmark: (duration, pattern, input, tech) =>
        this.benchmarks.record(duration, pattern, input, tech),
    })
  }

  analyzeOneToMany(technology, type, items = []) {
    return analyzeOneToMany(technology, type, items, {
      execMatch: (regex, value) => this.matchMemo.exec(regex, value),
      resolveVersion: (pattern, value) => this.resolveVersion(pattern, value),
      benchmark: (duration, pattern, value, tech) =>
        this.benchmarks.record(duration, pattern, value, tech),
    })
  }

  analyzeManyToMany(technology, types, items = {}) {
    return analyzeManyToMany(technology, types, items, {
      execMatch: (regex, value) => this.matchMemo.exec(regex, value),
      resolveVersion: (pattern, value) => this.resolveVersion(pattern, value),
      benchmark: (duration, pattern, value, tech) =>
        this.benchmarks.record(duration, pattern, value, tech),
    })
  }

  __getMatchMemoSize() {
    return this.matchMemo.size()
  }

  __clearMatchMemo() {
    this.matchMemo.clear()
  }
}

const coreInstance = new WappalyzerCore()

const Wappalyzer = {}

Object.defineProperty(Wappalyzer, 'technologies', {
  get() {
    return coreInstance.technologies
  },
  set(value) {
    coreInstance.technologies = value
    coreInstance._technologyByName = new Map(
      (value || []).map((technology) => [technology && technology.name, technology]).filter(([name]) => Boolean(name))
    )
  },
  enumerable: true,
  configurable: true,
})

Object.defineProperty(Wappalyzer, 'categories', {
  get() {
    return coreInstance.categories
  },
  set(value) {
    coreInstance.categories = value
  },
  enumerable: true,
  configurable: true,
})

Object.defineProperty(Wappalyzer, 'requires', {
  get() {
    return coreInstance.requires
  },
  set(value) {
    coreInstance.requires = value
  },
  enumerable: true,
  configurable: true,
})

Object.defineProperty(Wappalyzer, 'categoryRequires', {
  get() {
    return coreInstance.categoryRequires
  },
  set(value) {
    coreInstance.categoryRequires = value
  },
  enumerable: true,
  configurable: true,
})

Object.assign(Wappalyzer, {
  slugify: (string) => coreInstance.slugify(string),
  getTechnology: (name) => coreInstance.getTechnology(name),
  getCategory: (id) => coreInstance.getCategory(id),
  resolve: (detections) => coreInstance.resolve(detections),
  resolveVersion: (pattern, match) => coreInstance.resolveVersion(pattern, match),
  analyze: (items, technologies) => coreInstance.analyze(items, technologies),
  analyzeOneToOne: (technology, type, value) =>
    coreInstance.analyzeOneToOne(technology, type, value),
  analyzeOneToMany: (technology, type, items) =>
    coreInstance.analyzeOneToMany(technology, type, items),
  analyzeManyToMany: (technology, types, items) =>
    coreInstance.analyzeManyToMany(technology, types, items),
  setTechnologies: (data) => coreInstance.setTechnologies(data),
  setCategories: (data) => coreInstance.setCategories(data),
  transformPatterns: (patterns, caseSensitive, isRegex) =>
    coreInstance.transformPatterns(patterns, caseSensitive, isRegex),
  parsePattern: (pattern, isRegex) => coreInstance.parsePattern(pattern, isRegex),
  __getMatchMemoSize: () => coreInstance.__getMatchMemoSize(),
  __clearMatchMemo: () => coreInstance.__clearMatchMemo(),
})

Wappalyzer.WappalyzerCore = WappalyzerCore

module.exports = Wappalyzer
