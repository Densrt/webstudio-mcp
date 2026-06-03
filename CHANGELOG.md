# Changelog

All notable changes to this project are documented here. This package was developed
privately before its first public release, so the history below starts at the first
public version. Format inspired by [Keep a Changelog](https://keepachangelog.com/),
versioning per [SemVer](https://semver.org/).

## [2.10.9] — 2026-06-03

- docs(patterns): fix Image.src asset-only myth + add image-component recipe
- fix(tokens): run full coerce/normalize/complete pipeline on create_tokens

## [2.10.8] — 2026-06-03

- build(release): one-command release-public.sh (dry-run by default)
- chore(cleanup): drop superseded webstudio_delete_page + fix page-management doc
- chore(hygiene): remove dead internal residue from the private repo

## [2.10.7] — 2026-06-03

Polish: removed author-environment paths and internal residue from shipped comments/docs, fixed two stale doc references and the CI branch trigger. No functional or API change.

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
