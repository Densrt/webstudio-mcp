<!--
  Webstudio MCP — PR template.
  Read docs/mcp-design-charter.md before contributing a new tool.
-->

## What this PR does

<!-- 1-3 sentences. -->

## Type of change

- [ ] New tool (added to `src/index.ts` TOOLS and `index-tool-categories.ts`)
- [ ] Modified existing tool (description / schema / handler)
- [ ] Bug fix (no surface change)
- [ ] Refactor / internal
- [ ] Docs / patterns
- [ ] Test / scripts / CI

## Definition of Done (per `docs/mcp-design-charter.md`)

If this PR adds or modifies a tool:

- [ ] Description follows the canonical template (Use when / Do NOT use when /
      Returns / Side effects / Example)
- [ ] Description length is 200-450 chars (or up to 700 for complex/critical tools)
- [ ] At least one disambiguation if there's a sibling tool
- [ ] Inline `pattern:"<slug>"` references point to existing `docs/patterns/<slug>.md`
- [ ] Smoke test present in `test/` (or dispatcher test if consolidated)
- [ ] Registered in `src/index.ts` TOOLS array
- [ ] Added to `src/tools/index-tool-categories.ts` TOOL_CATEGORY map
- [ ] `CHANGELOG.md` updated under the relevant section
- [ ] Naming: `webstudio_*`, snake_case, verb-noun

If this PR adds a breaking change:

- [ ] `MIGRATION.md` updated with the rename/replace mapping
- [ ] Minor version bumped (`package.json` + `src/index.ts` server version)

## CI gates (all must be green)

- [ ] `npm run build` clean
- [ ] `npm test` clean
- [ ] `node scripts/lint-descriptions.mjs` clean (or warnings only, no errors)
- [ ] `node scripts/measure-baseline.mjs` shows no regression on key metrics
- [ ] `.github/workflows/mcp-health.yml` green

## Tool quota check (charter §5)

- Current tools in manifest (after this PR): _____ / 80 (hard cap)
- Current CORE_TOOL_NAMES size: _____ / 10 (hard cap)

## Notes / context

<!-- Anything reviewers should know. Links to issues, mentions of related PRs. -->
