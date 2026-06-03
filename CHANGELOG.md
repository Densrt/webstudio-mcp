# Changelog

All notable changes to this project are documented here. This package was developed
privately before its first public release, so the history below starts at the first
public version. Format inspired by [Keep a Changelog](https://keepachangelog.com/),
versioning per [SemVer](https://semver.org/).

## [2.10.6] — 2026-06-03

Initial public release.

### Highlights

- **15 mega-tools** to generate, push, audit, and refactor [Webstudio Cloud](https://webstudio.is)
  projects programmatically (`meta`, `auth`, `project`, `read`, `pages`, `instances`,
  `build`, `styles`, `tokens`, `cssvar`, `variables`, `resources`, `assets`, `audit`, `cms`).
- **Pattern library** exposed as MCP resources (`webstudio://patterns/<slug>`) and via
  free-text triage (`meta.guide`).
- **Safety-first**: every mutating action defaults to `dryRun`, with a two-stage push
  protocol enforced server-side; destructive actions additionally require explicit
  confirmation.
- **External CMS adapters** (Directus / WordPress / n8n) for dynamic content binding.

See the [README](README.md) for the full tool catalog and quick start.
