Project architecture overview

This repository has been lightly refactored to improve clarity without changing behavior or public APIs.

Key modules
- src/config.js: Centralized loading of categories and technologies, including optional custom overrides from wappalyzer-custom-*.json files.
- src/utils.js: Small cross-cutting utilities shared by the driver and CLI (sleep and limitHtml).
- driver.js: Puppeteer-based navigation, page data collection, and delegation to the Wappalyzer core to analyze results.
- wappalyzer.js: Core detection logic (unchanged in behavior). Provides methods to set data, analyze content, and resolve detections.
- cli.js: CLI interface, flag parsing, and orchestration.

Behavioral compatibility
- CLI options and environment variables remain the same.
- The detection engine and output shape are unchanged.
- All configuration files (categories.json, technologies/*.json) and custom overrides continue to work.

Notes for contributors
- Prefer adding new small helpers to src/utils.js rather than inlining duplicates.
- Prefer loading data via src/config.js rather than file I/O in multiple locations.
- Keep public APIs of driver.js and wappalyzer.js stable unless a major version bump is planned.
