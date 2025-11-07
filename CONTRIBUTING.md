Contributing

Thank you for your interest in contributing!

Getting started
- Requirements: Node.js 21+, Git.
- Install: npm ci
- Quick smoke test: npm run smoke
- Run unit tests: npm test
- Verify assorted flags: npm run verify

Project layout
- cli.js: CLI entrypoint
- driver.js: Puppeteer-based navigation and analysis (high-level facade)
- src/utils.js: small shared helpers (sleep, limitHtml)
- src/config.js: load categories and technologies
- src/cli/args.js: argument parsing used by CLI
- src/driver/extract.js: DOM and JS extraction helpers used by the driver
- wappalyzer.js: core detection engine

Testing
- Unit tests live under test/*.js and use Node's built-in test runner.
- CLI regression test: test/test.cli.smoke.js spawns cli.js against example.com with fast/no-scripts to keep it stable in CI.

CI
- GitHub Actions runs tests on Node 21/22. Puppeteer is run headless with --no-sandbox flags for CI stability.

Coding style
- Keep behavior backward compatible unless a major is planned.
- Prefer small, focused modules under src/ to reduce duplication.

Releases
- Update CHANGELOG.md.
- Bump the version in package.json (minor for non-breaking changes).
