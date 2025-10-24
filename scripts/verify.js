#!/usr/bin/env node

/*
 Minimal verification helper for this fork's additional flags.
 Usage:
   node scripts/verify.js https://example.com
*/

const { spawnSync } = require('child_process')

const url = process.argv[2] || 'https://example.com'

const cmds = [
  ['node', ['cli.js', url, '--fast', '--trace-timings']],
  ['node', ['cli.js', url, '--list']],
  ['node', ['cli.js', url, '--fast', '--block-assets=0']],
  ['node', ['cli.js', url, '--dnt', '--ua-suffix', '; Wappalyzer/cli']],
  ['node', ['cli.js', url, '--respect-robots', '--backoff']],
  ['node', ['cli.js', url, '--rate-limit-ms=200', '--allow-domains=example.com,cdn.example.com']],
  ['node', ['cli.js', url, '--block-domains=analytics.example.com,.doubleclick.net']],
]

for (const [bin, args] of cmds) {
  const label = `${bin} ${args.join(' ')}`
  console.log(`\n$ ${label}`)
  const res = spawnSync(bin, args, { stdio: 'inherit' })
  if (res.error) {
    console.error(`Command failed: ${label}`, res.error)
  }
}
