#!/usr/bin/env node

const Driver = require('./driver')
const { parseArgs } = require('./src/cli/args')
const { formatTechnologyList, structureDetections } = require('./src/driver/output')

const { options, urls } = parseArgs(process.argv.slice(2))

if (!urls.length || options.help) {
  process.stdout.write(`Usage:
  wappalyzer <url...> [options]

Examples:
  wappalyzer https://www.example.com
  wappalyzer https://a.example.com https://b.example.com --batch-size=3
  node cli.js https://www.example.com -r -D 3 -m 50 -H "Cookie: username=admin"
  docker wappalyzer/cli https://www.example.com --pretty

Options:
  -b, --batch-size=...       Process links in batches
  -d, --debug                Output debug messages
  --dump                     Dump all detections, without analyzing/finding technologies
  -f, --fast                 Prioritise speed over accuracy
  -t, --delay=ms             Wait for ms milliseconds between requests
  -h, --help                 This text
  -H, --header               Extra header to send with requests
  --html-max-cols=...        Limit the number of HTML characters per line processed
  --html-max-rows=...        Limit the number of HTML lines processed
  -D, --max-depth=...        Don't analyse pages more than num levels deep
  -m, --max-urls=...         Exit when num URLs have been analysed
  -w, --max-wait=...         Wait no more than ms milliseconds for page resources to load
  -P, --pretty               Pretty-print JSON output
  --proxy=...                Proxy URL, e.g. 'http://user:pass@proxy:8080'
  -r, --recursive            Follow links on pages (crawler)
  -a, --user-agent=...       Set the user agent string
  -n, --no-scripts           Disabled JavaScript on web pages
  -N, --no-redirect          Disable cross-domain redirects
  --local-storage=...        JSON object to use as local storage
  --session-storage=...      JSON object to use as session storage
  --defer=ms                 Defer scan for ms milliseconds after page load
  --list                     Output a simple list: Technology (Category, ...)
`)
  process.exit(options.help ? 0 : 1)
}

try {
  urls.forEach((u) => {
    const { hostname } = new URL(u)
    if (!hostname) {
      throw new Error(`Invalid URL: ${u}`)
    }
  })
} catch (error) {
  // eslint-disable-next-line no-console
  console.log(error.message || error.toString())

  process.exit(1)
}

const headers = {}

if (options.header) {
  ;(Array.isArray(options.header) ? options.header : [options.header]).forEach(
    (header) => {
      const [key, value] = header.split(':')

      headers[key.trim()] = (value || '').trim()
    }
  )
}

const storage = {
  local: {},
  session: {},
}

for (const type of Object.keys(storage)) {
  if (options[`${type}Storage`]) {
    try {
      storage[type] = JSON.parse(options[`${type}Storage`])

      if (
        !options[`${type}Storage`] ||
        !Object.keys(options[`${type}Storage`]).length
      ) {
        throw new Error('Object has no properties')
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(`${type}Storage error: ${error.message || error}`)

      process.exit(1)
    }
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function openAndAnalyze(driver, url, headers, storageOptions, deferMs) {
  const site = await driver.open(url, headers, storageOptions)

  try {
    if (deferMs > 0) {
      await wait(deferMs)
    }

    const results = await site.analyze()

    return {
      url,
      results,
      detections: site.detections || [],
      analyzedUrls: site.analyzedUrls || {},
    }
  } catch (error) {
    error.siteData = {
      detections: site.detections || [],
      analyzedUrls: site.analyzedUrls || {},
    }

    throw error
  } finally {
    try {
      await site.destroy()
    } catch (_) {
      // ignore cleanup errors
    }
  }
}

;(async function () {
  const driver = new Driver(options)

  try {
    await driver.init()

    const deferMs = Number.parseInt(options.defer || 0, 10) || 0

    if (urls.length === 1) {
      const url = urls[0]
      const { results, detections } = await openAndAnalyze(
        driver,
        url,
        headers,
        storage,
        deferMs
      )

      if (options.dump) {
        // Structured dump of detections grouped by type (compatibility with historical --dump)
        const structured = structureDetections(detections)
        process.stdout.write(`${JSON.stringify(structured, null, options.pretty ? 2 : null)}\n`)
      } else if (options.list) {
        const lines = formatTechnologyList(results)
        process.stdout.write(`${lines.join('\n')}\n`)
      } else {
        process.stdout.write(`${JSON.stringify(results, null, options.pretty ? 2 : null)}\n`)
      }
    } else {
      const concurrency = driver.options.batchSize
      const out = []
      for (let i = 0; i < urls.length; i += concurrency) {
        const batch = urls.slice(i, i + concurrency)
        const batchResults = await Promise.all(
          batch.map(async (url) => {
            try {
              const { results, detections, analyzedUrls } = await openAndAnalyze(
                driver,
                url,
                headers,
                storage,
                deferMs
              )
              return { url, results, detections, analyzedUrls }
            } catch (e) {
              const fallback = e.siteData || {}
              return {
                url,
                error: e.message || String(e),
                results: {
                  urls: fallback.analyzedUrls || {},
                  technologies: [],
                },
                detections: fallback.detections || [],
              }
            }
          })
        )
        out.push(...batchResults)
      }

      if (options.dump) {
        // Dump structured detections per URL
        const dumpOut = out.map((entry) => ({
          url: entry.url,
          detections: structureDetections(entry.detections || []),
        }))
        process.stdout.write(`${JSON.stringify(dumpOut, null, options.pretty ? 2 : null)}\n`)
      } else {
        if (options.list) {
          const blocks = out.map(({ url, results }) => {
            const lines = formatTechnologyList(results)
            return [url, ...lines].join('\n')
          })
          process.stdout.write(`${blocks.join('\n\n')}\n`)
        } else {
          process.stdout.write(`${JSON.stringify(out, null, options.pretty ? 2 : null)}\n`)
        }
      }
    }

    await driver.destroy()

    process.exit(0)
  } catch (error) {
    await driver.destroy().catch(() => {})
    // eslint-disable-next-line no-console
    console.error(error.message || String(error))
    process.exit(1)
  }
})()
