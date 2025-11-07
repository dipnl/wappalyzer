Changelog

6.13.0
- Added unit tests for args parsing, config loading, and utils (limitHtml/sleep), plus a CLI regression test using Node's built-in test runner.
- Introduced GitHub Actions CI to run tests and smoke on Node 21/22 with Puppeteer in headless mode.
- Refactored driver: extracted JS/DOM extraction helpers to src/driver/extract.js and wired getJs from the module; laid groundwork to further split driver internals.
- Centralized configuration and utilities (previous refactor) retained and covered with tests.
- Stabilized smoke script to use example.com and reserved domains; added verify script for assorted flags.
- Aligned Node engine to ">=21" and updated README prerequisites.
- Added CONTRIBUTING.md; updated ARCHITECTURE.md to mention new modules, tests, and CI.
