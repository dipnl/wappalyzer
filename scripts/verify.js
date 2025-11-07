#!/usr/bin/env node

/*
 Simple smoke helper for the CLI.
 Usage:
   node scripts/verify.js https://example.com
*/

const { spawnSync } = require('child_process')

const url = process.argv[2] || 'https://example.com'

const cmds = [
  ['node', ['cli.js', url, '--fast', '--no-scripts']],
  ['node', ['cli.js', url, '--fast', '--dump']],
  ['node', ['cli.js', url, '--list']],
]

for (const [bin, args] of cmds) {
  const label = `${bin} ${args.join(' ')}`
  console.log(`\n$ ${label}`)
  const res = spawnSync(bin, args, { stdio: 'inherit' })
  if (res.error) {
    console.error(`Command failed: ${label}`, res.error)
  }
}
