#!/usr/bin/env node
'use strict'

const { spawnSync } = require('child_process')

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' })
  return { code: res.status, out: res.stdout, err: res.stderr }
}

function print(label, r) {
  console.log(label, 'exit:', r.code)
  if (r.err) console.log('stderr:', r.err.slice(0, 200))
  if (r.out) console.log('stdout:', r.out.slice(0, 200))
}

console.log('Smoke: basic URL')
let r = run('node', ['cli.js', 'https://example.com', '--pretty', '--no-scripts', '--fast', '-w', '3000'])
print('basic', r)

console.log('Smoke: multiple URLs with batch')
r = run('node', ['cli.js', 'https://example.com', 'https://www.iana.org/domains/reserved', '-b', '2', '--pretty', '--no-scripts', '--fast', '-w', '3000'])
print('batch', r)

console.log('Smoke: recursive with limits')
r = run('node', ['cli.js', 'https://example.com', '-r', '-D', '1', '-m', '3', '-w', '3000', '--pretty', '--no-scripts', '--fast'])
print('recursive', r)
