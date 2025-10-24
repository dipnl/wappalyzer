#!/usr/bin/env node

const Driver = require('./driver')

const args = process.argv.slice(2)

const options = {}

let urls = []
let arg

const aliases = {
  a: 'userAgent',
  b: 'batchSize',
  d: 'debug',
  f: 'fast',
  t: 'delay',
  h: 'help',
  H: 'header',
  D: 'maxDepth',
  m: 'maxUrls',
  p: 'probe',
  P: 'pretty',
  r: 'recursive',
  w: 'maxWait',
  n: 'noScripts',
  N: 'noRedirect',
  e: 'extended',
}

while (true) {
  // eslint-disable-line no-constant-condition
  arg = args.shift()

  if (!arg) {
    break
  }

  const matches = /^-?-([^=]+)(?:=(.+)?)?/.exec(arg)

  if (matches) {
    const key =
      aliases[matches[1]] ||
      matches[1].replace(/-\w/g, (_matches) => _matches[1].toUpperCase())
    // eslint-disable-next-line no-nested-ternary
    const value = matches[2]
      ? matches[2]
      : args[0] && !args[0].startsWith('-')
      ? args.shift()
      : true

    if (options[key]) {
      if (!Array.isArray(options[key])) {
        options[key] = [options[key]]
      }

    options[key].push(value)
    } else {
      options[key] = value
    }
  } else {
    urls.push(arg)
  }
}

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
  -f, --fast                 Prioritise speed over accuracy (also sets sensible defaults for speed)
  -t, --delay=ms             Wait for ms milliseconds between requests
  -h, --help                 This text
  -H, --header               Extra header to send with requests
  --html-max-cols=...        Limit the number of HTML characters per line processed
  --html-max-rows=...        Limit the number of HTML lines processed
  -D, --max-depth=...        Don't analyse pages more than num levels deep
  -m, --max-urls=...         Exit when num URLs have been analysed
  -w, --max-wait=...         Wait no more than ms milliseconds for page resources to load
  -p, --probe=[basic|full]   Perform a deeper scan by performing additional requests and inspecting DNS records
  -P, --pretty               Pretty-print JSON output
  --proxy=...                Proxy URL, e.g. 'http://user:pass@proxy:8080'
  -r, --recursive            Follow links on pages (crawler)
  -a, --user-agent=...       Set the user agent string
  -n, --no-scripts           Disabled JavaScript on web pages
  -N, --no-redirect          Disable cross-domain redirects
  -e, --extended             Output additional information
  --local-storage=...        JSON object to use as local storage
  --session-storage=...      JSON object to use as session storage
  --defer=ms                 Defer scan for ms milliseconds after page load
  --block-assets             Block non-essential assets (images, media, fonts, stylesheets)
  --log=level                Set log level: error|warn|info|debug (default: off)
  --trace-timings            Print one-line timing summary per URL (nav, idle, html, headers, js, dom, resolve, total)
  --trace-save=FILE          When used with --trace-timings, also append each timing JSON line to FILE (NDJSON)
  --list                     Output a simple list: Technology (Category, ...)
  --dnt                      Send the DNT: 1 header on all requests
  --ua-suffix=...            Append a custom suffix to the User-Agent (e.g. "; Wappalyzer/cli")
  --backoff                  Respect 429/503 by applying Retry-After backoff (opt-in)
  --rate-limit-ms=...        Minimum milliseconds between requests per host (opt-in)
  --respect-robots           Respect robots.txt (User-agent: *) for crawling/navigation
  --allow-domains=...        Comma-separated domain allowlist (exact or suffix). If set, only these domains plus the main host are requested
  --block-domains=...        Comma-separated domain blocklist (exact or suffix). These domains will be blocked
  --wip                      Add wip.json overlay on top of bundled+prod technologies (see --tech-*)
  --tech-prod=PATH           Path to external prod.json (or set env WAPPALYZER_TECH_PROD)
  --tech-wip=PATH            Path to external wip.json (or set env WAPPALYZER_TECH_WIP)
  --category=ID[,ID...]      Restrict detection to one or more category IDs (e.g. --category=1 or --category=1,6)
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

;(async function () {
  const driver = new Driver(options)

  const formatList = (results) => {
    return (results.technologies || [])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(t => {
        const cats = (t.categories || []).map(c => c.name).filter(Boolean)
        const catStr = cats.join(', ')
        const conf = (typeof t.confidence === 'number' && !Number.isNaN(t.confidence)) ? String(t.confidence) : (t.confidence != null ? String(t.confidence) : '')
        if (catStr && conf !== '') {
          return `${t.name} (${catStr} / ${conf})`
        } else if (catStr) {
          return `${t.name} (${catStr})`
        } else if (conf !== '') {
          return `${t.name} (${conf})`
        }
        return `${t.name}`
      })
  }

  try {
    await driver.init()

    const deferMs = parseInt(options.defer || 0, 10)

    if (urls.length === 1) {
      const url = urls[0]
      const site = await driver.open(url, headers, storage)
      if (deferMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, deferMs))
      }
      const results = await site.analyze()

      if (!options.dump) {
        if (options.list) {
          const lines = formatList(results)
          process.stdout.write(`${lines.join('\n')}\n`)
        } else {
          process.stdout.write(`${JSON.stringify(results, null, options.pretty ? 2 : null)}\n`)
        }
      }
    } else {
      const concurrency = parseInt(options.batchSize || 5, 10)
      const out = []
      for (let i = 0; i < urls.length; i += concurrency) {
        const batch = urls.slice(i, i + concurrency)
        const batchResults = await Promise.all(
          batch.map(async (url) => {
            const site = await driver.open(url, headers, storage)
            try {
              if (deferMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, deferMs))
              }
              const results = await site.analyze()
              return { url, results }
            } catch (e) {
              return { url, error: e.message || String(e), results: { urls: site.analyzedUrls || {}, technologies: [] } }
            } finally {
              try { await site.destroy() } catch (_) {}
            }
          })
        )
        out.push(...batchResults)
      }

      if (!options.dump) {
        if (options.list) {
          const blocks = out.map(({ url, results }) => {
            const lines = formatList(results)
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
    try {
      await Promise.race([
        driver.destroy(),
        new Promise((resolve, reject) =>
          setTimeout(
            () => reject(new Error('Attempt to close the browser timed out')),
            3000
          )
        ),
      ])
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error.message || String(error))
    }

    // eslint-disable-next-line no-console
    console.error(error.message || String(error))

    process.exit(1)
  }
})()
