'use strict'

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

// Flags that accept a value when provided as separate next token
const valueFlags = new Set([
  'userAgent',
  'batchSize',
  'delay',
  'header',
  'maxDepth',
  'maxUrls',
  'probe',
  'maxWait',
  'proxy',
  'htmlMaxCols',
  'htmlMaxRows',
  'defer',
  'log',
  'rateLimitMs',
  'allowDomains',
  'blockDomains',
  'uaSuffix',
  'techProd',
  'techWip',
  'category',
])

function parseArgs(argv, aliasMap = aliases) {
  const args = argv.slice()
  const options = {}
  const urls = []

  while (true) {
    const arg = args.shift()
    if (!arg) break

    const matches = /^-?-([^=]+)(?:=(.+)?)?/.exec(arg)

    if (matches) {
      const rawKey = matches[1]
      const key = aliasMap[rawKey] || rawKey.replace(/-\w/g, (m) => m[1].toUpperCase())
      let value

      if (typeof matches[2] !== 'undefined') {
        // Explicit --key=value form
        value = matches[2]
      } else if (arg.startsWith('--')) {
        // Long flag may consume next token as value if it doesn't start with '-'
        value = args[0] && !args[0].startsWith('-') ? args.shift() : true
      } else {
        // Short flag (-k): if it expects a value and next token is non-flag, consume it; otherwise boolean
        const expectsValue = valueFlags.has(key)
        value = expectsValue && args[0] && !args[0].startsWith('-') ? args.shift() : true
      }

      if (options[key] !== undefined) {
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

  return { options, urls }
}

module.exports = { parseArgs, aliases }
