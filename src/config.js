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
  const categoriesPath = path.resolve(`${__dirname}/../categories.json`)
  let categories
  try {
    categories = JSON.parse(fs.readFileSync(categoriesPath, 'utf8'))
  } catch (error) {
    throw new Error(`Failed to load categories.json: ${error.message}`)
  }

  const customPath = 'wappalyzer-custom-categories.json'
  if (fs.existsSync(customPath)) {
    try {
      const customJson = fs.readFileSync(customPath, 'utf8')
      const customCats = JSON.parse(customJson.length ? customJson : '{}')
      for (const catId in customCats) {
        categories[catId] = customCats[catId]
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Warning: Failed to load ${customPath}: ${error.message}`)
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
    const techPath = path.resolve(`${__dirname}/../technologies/${character}.json`)

    try {
      const content = fs.readFileSync(techPath, 'utf8')
      technologies = {
        ...technologies,
        ...JSON.parse(content),
      }
    } catch (error) {
      throw new Error(`Failed to load technologies/${character}.json: ${error.message}`)
    }
  }

  const customPath = 'wappalyzer-custom-technologies.json'
  if (fs.existsSync(customPath)) {
    try {
      const customJson = fs.readFileSync(customPath, 'utf8')
      technologies = {
        ...technologies,
        ...JSON.parse(customJson.length ? customJson : '{}'),
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Warning: Failed to load ${customPath}: ${error.message}`)
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
