Project architecture overview

This repository focuses on a lightweight CLI wrapper around the Wappalyzer detection engine.

Key modules
- src/config.js: Centralized loading of categories and technologies, including optional custom overrides from wappalyzer-custom-*.json files.
- src/utils.js: Shared helpers such as sleep and limitHtml.
- driver.js: Thin entry point that re-exports the runtime Driver used by the CLI.
- src/driver/runtime.js: Core driver + site orchestration (browser lifecycle, navigation, detection aggregation, recursive crawl).
- src/driver/browser.js: Chromium launch/connect lifecycle and environment overrides.
- src/driver/pageData.js: Parallel page data collection (links, text, css, scripts, meta, DOM, JS).
- src/driver/extract.js: DOM and JS extraction helpers used during page analysis.
- src/driver/analyze.js: Thin facade that re-exports analyze helpers from wappalyzer.js.
- src/driver/links.js: Utility helpers for link reduction during recursion.
- src/driver/output.js: Output shaping utilities to keep CLI formatting separate.
- wappalyzer.js: Core detection logic (unchanged). Provides methods to set data, analyze content, and resolve detections.
- cli.js: CLI interface, flag parsing, and orchestration.

Behavioral compatibility
- The detection engine and output shape remain centered on Wappalyzer's JSON datasets.
- Configuration files (categories.json, technologies/*.json) and custom overrides continue to work.

Notes for contributors
- Prefer adding new small helpers to src/utils.js rather than inlining duplicates.
- Prefer loading data via src/config.js rather than file I/O in multiple locations.
- Keep public APIs of driver.js and wappalyzer.js stable unless a major version bump is planned.
