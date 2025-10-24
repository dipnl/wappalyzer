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

function parseArgs(argv, aliasMap = aliases) {
  const args = argv.slice()
  const options = {}
  const urls = []

  while (true) {
    const arg = args.shift()
    if (!arg) break

    const matches = /^-?-([^=]+)(?:=(.+)?)?/.exec(arg)

    if (matches) {
      const key =
        aliasMap[matches[1]] ||
        matches[1].replace(/-\w/g, (m) => m[1].toUpperCase())
      const value = matches[2]
        ? matches[2]
        : args[0] && !args[0].startsWith('-')
        ? args.shift()
        : true

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
