# Changelog

All notable changes to this project are documented here. This package was developed
privately before its first public release, so the history below starts at the first
public version. Format inspired by [Keep a Changelog](https://keepachangelog.com/),
versioning per [SemVer](https://semver.org/).

## [2.21.1] — 2026-06-13

- chore(hygiene): anonymize shipped examples + tidy stale counts before release
- docs(snapshot): comment reflects playwright-core as optionalDependency
- feat(push): anti-wrong-project guard on push_staged + staged-push pattern doc
- feat(push): staged push handles — confirm a dry-run without re-sending the payload
- build(deps): playwright-core in optionalDependencies (snapshot works out-of-the-box)
- chore: v2.21.0 — single-file bundle, zero runtime deps, presets, resources gating, CMS projection
- feat(cms): field projection + bounded values on list_items; truncated mutation echoes
- feat(surface): named filter presets + WEBSTUDIO_MCP_RESOURCES gating
- feat!: zero runtime dependencies — playwright-core becomes optional
- build: ship a single-file esbuild bundle as the npm artifact
- refactor(patterns): unify docs/patterns resolution into lib/patterns-dir
- chore: v2.20.3 — wire-schema diet: tools/list 98,885 -> 75,783 B (-23.4%)
- perf(output): rate-limit repeated pedagogical hints (hint-once)
- perf(wire): permissive StyleValue wire schema + trim oversized property prose
- perf(wire): action summary cap 220 -> 110; bare enum lines; rewrite 73 leads
- build(scripts): win32-safe path resolution in lint-descriptions + measure-baseline
- perf(wire): hoist context/label/trailer boilerplate into SERVER_INSTRUCTIONS
- fix(schema): default/examples-only diffs no longer fork anyOf; conflicting defaults dropped
- chore(scripts): promote wire-payload measurement to scripts/measure-wire.mjs
- chore: v2.20.2 — cache correctness (upload invalidation) + TTL 120s + frozen readonly reads + CRLF-safe patterns
- perf(cache): readonly fetchBuild path — frozen shared reference, no per-hit clone
- perf(cache): raise default build-cache TTL 30s -> 120s
- test(auth): skip POSIX mode-bit assertion on win32
- fix(patterns): normalize CRLF when reading pattern docs
- fix(assets): invalidate build cache after upload POSTs
- chore: v2.20.1 — fix(schema): conflicting per-action property shapes fork a nested anyOf

## [2.20.0] — 2026-06-10

- feat(resources): method-aware create — form actions are standalone (no dataSource, no cache header)
- feat(guards): global anti-pattern audit — Video coerce, show-binding lint, shared-subtree delete guard
- feat(images): raw <img> eradication — auto-convert to the native Image component everywhere
- chore(deps): engines >=20 + zod4 migration path documented (timeboxed no-go)
- perf(wire,snapshot): $defs dedupe (-13k chars wire) + warm browser + canvas polling
- feat(instances): append batch form — N simple children in ONE transaction
- feat(surface): reduced tool-surface mode via WEBSTUDIO_MCP_TOOLS allowlist
- feat(hardening): wire-budget CI guard, build-cache telemetry, retry backoff, registry comments
- feat(reads): bounded responses (tokens limit, audit.page maxChars) + structuredContent on get_decls
- refactor(lib): dedupe findReplaceTargets, Binding Zod schemas, replace-merge engine
- perf(core): build cache + lazy playwright + BM25 corpus cache
- feat(schema): wire-schema economy — one-line action summaries + xActions stripped from tools/list
- feat(expressions): lint raw binding expressions against Webstudio's allowlist
- chore: sync package-lock.json to v2.10.10
- fix(release): bump.mjs detects SERVER_VERSION via regex test (idempotent on same version)
- docs(changelog): public changelog entry for v2.10.10
- docs(changelog): backfill 2.10.8 and 2.10.9 entries
- fix(state): coerce state selector on all style write paths

## [2.10.10] — 2026-06-03

- fix(state): coerce the `state` selector on every style write path — a bare `"hover"` (no colon) was stored as a dead state that never triggered; recoverable forms (`"hover"`, `":Hover"`, `":before"`) are now coerced to canonical + hinted, unknown states rejected. New pattern `state-selector-format`.

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
