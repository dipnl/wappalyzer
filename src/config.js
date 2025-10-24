/**
 * Centralized configuration loader for categories and technologies.
 * This keeps file I/O and environment-specific overrides in one place,
 * making the driver easier to understand.
 */
'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Load categories from categories.json with optional overrides.
 * @returns {Record<string, {name:string,priority?:number}>}
 */
function loadCategories() {
  const categories = JSON.parse(
    fs.readFileSync(path.resolve(`${__dirname}/../categories.json`))
  )

  if (fs.existsSync('wappalyzer-custom-categories.json')) {
    const customJson = fs.readFileSync('wappalyzer-custom-categories.json')
    const customCats = JSON.parse(customJson.length ? customJson : '{}')
    for (const catId in customCats) {
      categories[catId] = customCats[catId]
    }
  }

  return categories
}

/**
 * Load technologies by merging all shard files and optional custom file.
 * @returns {Record<string, any>}
 */
function loadTechnologies() {
  let technologies = {}

  for (const index of Array(27).keys()) {
    const character = index ? String.fromCharCode(index + 96) : '_'

    technologies = {
      ...technologies,
      ...JSON.parse(
        fs.readFileSync(
          path.resolve(`${__dirname}/../technologies/${character}.json`)
        )
      ),
    }
  }

  if (fs.existsSync('wappalyzer-custom-technologies.json')) {
    const customJson = fs.readFileSync('wappalyzer-custom-technologies.json')
    technologies = {
      ...technologies,
      ...JSON.parse(customJson.length ? customJson : '{}'),
    }
  }

  return technologies
}

/**
 * Load both technologies and categoryMap in one call.
 */
function loadConfig() {
  return {
    categoryMap: loadCategories(),
    technologies: loadTechnologies(),
  }
}

module.exports = {
  loadCategories,
  loadTechnologies,
  loadConfig,
}
