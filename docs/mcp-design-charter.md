# Webstudio MCP — Design Charter

> The single source of truth for adding, modifying, or removing tools in this MCP.
> Read this before any contribution.

## 0. Why we have this charter

This MCP grew from a hack-day prototype to 87 tools by May 2026 without
written design rules. The result: duplicated single/batch pairs, ambiguous
twins (`update_styles` vs `update_token_styles`), invisible patterns docs,
inconsistent safety enforcement. The v0.3.0 revamp pruned the catalog to 73
tools, standardized every description, and consolidated 14 audit/inspect
endpoints into 2 dispatchers. **This charter exists so the next contributor
does not undo that work.**

The headline constraint: Anthropic's own guidance is that *"Claude's ability
to correctly pick the right tool degrades significantly once you exceed 30–50
available tools"* ([Writing tools for agents][writing-tools]). We sit just
above that line. Every new tool must justify its existence.

## 1. Principles

1. **We consolidate before duplicating.** One tool with an `action` or `kind`
   enum beats N near-identical tools. See `webstudio_audit` (11 audit_* tools
   merged) and `webstudio_inspect` (3 inspect_* tools merged). Source: Anthropic
   — *"Consolidate related operations into fewer tools. Fewer, more capable
   tools reduce selection ambiguity."*
2. **We disambiguate every pair of similar tools explicitly.** If a tool has
   a semantic twin, the description names the twin in `Do NOT use when`. No
   exceptions.
3. **We surface load-bearing patterns inline.** A pattern that prevents an
   incident (e.g. Swiper requires `html,body{overflow-x:hidden}` global) lives
   in the description of the tool that triggers the incident, not only in
   `docs/patterns/*.md`.
4. **We enforce safety via the schema.** Mutating tools default to
   `dryRun: true`. Push-to-cloud tools require `forceConfirmed: true` for
   non-dry-run runs. The runtime refuses unsafe calls — we don't trust the
   LLM to remember.
5. **We measure everything.** Description length, template coverage, eval
   score on a fixed prompt suite. `scripts/measure-baseline.mjs` is the
   canonical measurement. Run it before and after any PR that touches
   descriptions.
6. **We write descriptions in plain direct verbs.** *"Use when X. Do NOT use
   when Y. Returns Z."* — not *"You might want to consider using this when
   you feel like..."*. The LLM scans descriptions like a senior engineer
   scans an API reference.
7. **We treat the manifest as a budget.** Tools exposed: ≤ 80. Tools in
   `CORE_TOOL_NAMES`: ≤ 10. New entries push old ones out.

## 2. Tool definition standards

### 2.1 Naming

> **v1.0 update (chantier 10, 2026-05-19)** — Server renamed from `webstudio-mcp` to
> `webstudio` (Webflow MCP convention). The `webstudio_` tool name prefix is being
> phased out cluster-by-cluster during the mega-tool refactor — once a cluster is
> migrated, its tools are named by the domain only (e.g. `pages`, `build`, `styles`)
> and the client sees them as `mcp__webstudio__<tool>`. Until a cluster is migrated,
> the prefix and rules below remain in force for its tools.

- **Format**: `webstudio_<verb>_<noun>[_<qualifier>]` in `snake_case`.
- **Prefix `webstudio_`** is mandatory (namespace collision avoidance in
  multi-MCP setups).
- **Verb-first**, present tense: `create`, `update`, `delete`, `list`,
  `inspect`, `audit`, `push`, `bind`, `wrap`, `flatten`, `extract`,
  `replace`, `dedupe`, `cleanup`, `apply`, `detach`, `define`, `import`,
  `export`, `nuke`, `allow`, `setup`, `init`, `read`, `fetch`, `describe`,
  `rewrite`, `bulk_rename`.
- **Examples (good)**: `webstudio_update_styles`, `webstudio_extract_token_from_instances`,
  `webstudio_bulk_rename_tokens`, `webstudio_audit_page`.
- **Counter-examples (banned)**:
  - `webstudio_styles_update` (verb must come first)
  - `webstudio-update-styles` (kebab-case — banned, see Notion v1 mistake)
  - `webstudio_styleUpdate` (camelCase)
  - `webstudio_doStuff` (no vague verbs)
  - `update_styles` (missing prefix)

### 2.2 Description template

The canonical template — every tool follows it:

```
Use when: <1 phrase trigger — "when the user asks X" or "before Y">.
Do NOT use when: <discriminator vs 1-2 sibling tools, named explicitly>.
Returns: <structural shape of what the LLM receives>.
Side effects: <none (read-only) | local mutation only | push to Webstudio Cloud | network read>.

Example: <copy-pastable input JSON, 1-2 lines>.

[Optional] Pattern reference: pattern:"slug" — only if a docs/patterns/<slug>.md exists.
```

Fully-written example, from `webstudio_list_instances`:

```
Use when: you need to find an instance ID by label, browse a page tree, or
pick a target before update/delete/clone.
Do NOT use when: you already have an ID and need full props/styles — use
webstudio_inspect(target:"instance") for that depth.
Returns: tree of {id, label, component, tag, depth} filtered by
labelContains/component/topLevelOnly/maxDepth.
Side effects: none (read-only).

Example: { projectSlug: "<project>", pagePath: "/", labelContains: "hero",
topLevelOnly: true }
```

### 2.3 Side effects taxonomy

Every description ends `Side effects:` with **exactly one** of these four labels:

| Label | Meaning | Examples |
|---|---|---|
| `none (read-only)` | No state change anywhere | `list_instances`, `inspect`, `audit_page`, `describe_pattern` |
| `local mutation only (no push)` | Mutates local auth/staging files; nothing reaches Webstudio Cloud | `setup_auth`, `define_token`, `allow_push` |
| `push to Webstudio Cloud (requires allowPush)` | Sends a patch to Webstudio's API — visible in production | `push_fragment`, `update_styles`, `delete_pages`, `update_token_styles` |
| `network read (HTTP fetch)` | Fetches external resources but no mutation | `import_figma_variables`, `upload_asset` source side |

If a tool has multiple modes (e.g. `dryRun` makes it read-only), describe the
default mode and mention the alternative in the `Use when` body.

### 2.4 Length budget

- **200–450 chars**: target zone. Most tools land here.
- **450–700 chars**: OK for tools with non-trivial schema (expressions, regex,
  fragment shape) — every char above 450 must earn its place via an example
  or disambiguation.
- **> 700 chars**: reserved for the **critical tier**: `push_fragment`,
  `wrap_instance`, `bind_instance_prop`, `init_brand_tokens`,
  `bulk_rename_tokens`. These tools encode load-bearing patterns and
  multi-stage protocols inline.
- **< 200 chars**: lint error. Forces a rewrite. The pre-revamp catalog had
  ~30% of tools below this floor and they were the most-confused.

Measured via `scripts/measure-baseline.mjs`.

### 2.5 Disambiguation policy

A tool has a **sibling** when ≥ 70% of its functional surface overlaps with
another tool. Every tool with at least one sibling MUST name it in
`Do NOT use when`.

The currently-tracked sibling pairs (extend this table when adding tools):

| Tool A | Tool B | Discriminator |
|---|---|---|
| `update_styles` | `update_token_styles` | A = local override on instance; B = token definition itself |
| `update_styles` | `extract_variant_token` | A = 1 instance; B = pattern reused ≥ 2 instances |
| `update_instance_prop` | `bind_instance_prop` | A = literal value; B = expression (resource/var) |
| `delete_instance_prop` | `delete_local_style_decl` | A = prop (alt, src, href); B = style decl (color, padding) |
| `define_token` | `create_tokens` | A = local staging for fragment-building; B = direct cloud push |
| `bulk_rename_tokens` | `replace_token` | A = renames NAMES; B = swaps REFERENCES |
| `update_instance_text` | `update_instance_prop` | A = text node child; B = attribute prop |
| `list_instances` | `inspect(target:"instance")` | A = lightweight tree view; B = deep details |
| `clone_subtree` | `clone_page_subtree` | A = subset of instances; B = entire page |
| `audit_page` | `audit(kind:"...")` | A = comprehensive single-page entry; B = focused single-aspect |

## 3. Architecture decisions

### 3.1 When to consolidate vs split

**Consolidate into a dispatcher (1 tool + enum param) when:**
- ≥ 70% of the implementation code overlaps across the candidates
- Inputs/outputs share the same shape modulo one enum field
- The user task always picks exactly one variant (mutually exclusive)

Realized in v0.3.0:
- `webstudio_audit(kind: "overflow" | "fonts" | "images" | "scripts" | ...)`
  consolidates 11 ex-tools (`audit_overflow`, `audit_fonts`, `audit_images`,
  `audit_scripts`, `audit_assets`, `audit_local_styles`, `audit_orphans`,
  `audit_token_usage`, `audit_token_overlap`, `audit_resources_perf`,
  `audit_page` is **kept separate** because its output shape is sequentially
  different — see counter-example below).
- `webstudio_inspect(target: "instance" | "form" | "resource")` consolidates
  3 ex-tools.

**Split into N tools when:**
- Outputs have semantically incompatible shapes
- One variant is an entry-point and others are deep-dives
- One variant has 10× the usage frequency

Counter-example: `audit_page` stayed separate even after the audit
consolidation because its payload is a multi-section overview (a meta-report
that calls the others), not a single audit. Merging it would have forced
callers to always pass `kind: "all"` — a misleading API.

### 3.2 Sub-handlers vs tool

Files like `src/tools/audit-overflow.ts`, `src/tools/inspect-instance.ts` are
**sub-handlers**: they expose a function consumed by a dispatcher tool but
are **not registered in the manifest**. They must be marked with this
comment at the top:

```ts
// INTERNAL HANDLER — not exposed in manifest.
// Consumed by: webstudio_audit (kind: "overflow")
```

This prevents `src/index.ts` re-exports from accidentally re-registering them
and bloating the manifest.

### 3.3 Toolset categories

The 13 categories declared in `src/tools/index-tool-categories.ts`:

`meta`, `setup`, `read`, `build`, `push`, `pages`, `instances`, `styles`,
`cssvars`, `variables`, `resources`, `assets`, `audits`.

**Adding a new category requires:**
- ≥ 4 tools that share a clear domain not covered by existing categories
- Update to `CATEGORIES`, `TOOL_CATEGORY`, and `docs/tool-search-config.md`
- A line in `webstudio_index` output verifying the count
- Reviewer must explicitly call out the category creation in the PR

Hard cap: **≤ 15 categories**. Beyond that, `webstudio_index` becomes an
overwhelming dump rather than a navigation aid.

### 3.4 CORE_TOOL_NAMES

The 10 always-loaded tools (see `src/tools/index-tool-categories.ts`):

```
webstudio_index, webstudio_setup_auth, webstudio_list_projects,
webstudio_fetch_pages, webstudio_list_instances, webstudio_inspect,
webstudio_push_fragment, webstudio_update_styles, webstudio_read_texts,
webstudio_audit_page
```

**Criteria to enter the core set:**
- ≥ 5 invocations expected per typical session (validated via telemetry when
  active, or eval-suite frequency when not)
- Either a discovery entry-point (`index`, `setup_auth`, `list_projects`) or
  a workhorse mutation (`push_fragment`, `update_styles`)
- No deferrable alternative — if a tool can be loaded on demand via Tool
  Search Tool ([bm25_20251119][tool-search]) without breaking flows, it
  stays out of core

**Hard cap: ≤ 10.** New entrants displace existing ones. Source: Anthropic
— *"Keep your 3-5 most frequently used tools as non-deferred for optimal
performance"* — we round up to 10 because our flows are denser than a typical
agent.

## 4. Safety standards

The push protocol lives in `docs/safety.md`. This section restates the
schema-level enforcement rules.

### 4.1 Mutation tools

Any tool whose `Side effects` line is `local mutation only` or `push to
Webstudio Cloud` MUST:

1. Default `dryRun: true` in the input schema.
2. Surface the dry-run shape in the description (what the user sees before
   confirming).
3. Refuse a non-dry-run call without an explicit override field
   (`forceConfirmed: true` for cloud pushes).

Example, from `webstudio_push_fragment`:

> *Side effects: push to Webstudio Cloud. Protocol: dryRun=true first → user
> confirms project name → re-call with dryRun=false + forceConfirmed=true.*

### 4.2 Destructive tools

These tools delete or replace data without an in-product undo:

`webstudio_nuke_project`, `webstudio_delete_pages`, `webstudio_replace_asset`,
`webstudio_delete_assets`, `webstudio_delete_variables`,
`webstudio_delete_resource`, `webstudio_delete_folder`,
`webstudio_delete_token`.

For each, the runtime requires **one of**:
- A verbatim confirmation string matching a tool-specific phrase
  (`nuke_project` requires the project slug typed back), OR
- `forceConfirmed: true` set after a dry-run, OR
- `allowPush: true` + a prior dry-run round-trip in the same session

### 4.3 Auth scoping

The cookie auth is **account-scoped** — one valid `setup_auth` gives write
access to every project the user owns. The schema-level mitigation:

- Every mutating tool requires `projectSlug` explicitly (no implicit
  defaults).
- Every push tool runs a slug verification via dry-run that returns the
  **server-reported project title** (`build.project.title`). The caller must
  echo that title back in confirmation.

Source: `docs/safety.md` § "Mandatory dry-run".

## 5. Quotas (hard limits, enforced via CI)

| Quota | Cap | Current |
|---|---|---|
| Tools exposed in manifest | ≤ 80 | 66 |
| `CORE_TOOL_NAMES` count | ≤ 10 | 10 |
| Description length (warn) | ≥ 200 chars | enforced |
| Description length (error) | ≥ 100 chars | enforced |
| `Use when:` template coverage | 100% | 100% required |
| `Do NOT use when:` template coverage | ≥ 80% | (sibling tools mandatory) |
| Toolset categories | ≤ 15 | 13 |

The CI step in `.github/workflows/mcp-health.yml` runs
`node scripts/measure-baseline.mjs` and fails the build on any quota
breach. New PRs that bump a quota require a charter-amendment commit
referencing the new cap in this section.

## 6. Definition of Done (per tool PR)

Use this checklist as the PR template body:

- [ ] Description follows the template (Use when / Do NOT use when / Returns
      / Side effects / Example)
- [ ] Description length within budget (200–450, or justified ≤ 700)
- [ ] At least 1 disambiguation entry if a sibling tool exists (and the
      Disambiguation table in § 2.5 is updated)
- [ ] Pattern references resolve to an actual `docs/patterns/<slug>.md`
- [ ] Smoke test in `test/` (or dispatcher integration test if consolidated)
- [ ] Registered in `src/index.ts` TOOLS array AND
      `src/tools/index-tool-categories.ts` TOOL_CATEGORY map
- [ ] `CHANGELOG.md` entry under `## [Unreleased]`
- [ ] `scripts/measure-baseline.mjs` re-run, output committed in the PR
      description
- [ ] CI `mcp-health` job passes (quotas, lint, smoke)
- [ ] Manual: opened `webstudio_index` output and confirmed the new tool
      appears in the right category

## 7. Anti-patterns (do NOT do)

The patterns below either burned us pre-revamp or appear in Anthropic's
anti-pattern list ([Writing tools for agents][writing-tools]).

- **Adding a single + batch variant of the same operation.** Use a single
  batch tool that accepts `ids: string[]` (length 1 is fine). The
  pre-revamp catalog had `delete_page` and `delete_pages` as separate tools
  and the LLM systematically picked the singular even for N items. Merged
  into `webstudio_delete_pages` in v0.3.0.
- **Description < 200 chars.** Forces ambiguity. If the tool genuinely
  needs less, it probably shouldn't be exposed.
- **Soft language: "you should", "feel free to", "might want to", "consider".**
  Use direct verbs. *"Use when X"* / *"Do NOT use when Y"*. Source: Anthropic
  — *"Describe a tool as you would brief a new colleague."*
- **Jargon without inline example.** Regex sources, expression syntax,
  shorthand CSS, fragment shapes — always show the input. The pre-revamp
  `bulk_rename_tokens` documented `$1/$2 backrefs` without an example and
  was used incorrectly 3 sessions in a row.
- **Pattern referenced inline without `docs/patterns/<slug>.md` backing it.**
  Every `pattern:"<slug>"` must resolve. Broken references are worse than
  no reference.
- **Push tool without `dryRun: true` default.** Schema-level enforcement
  prevents the entire class of "wrong-slug push" incidents that hit pre-v0.3
  six times.
- **Returning a raw stack trace as the only error message.** Errors must
  redirect to the right tool. Bad: `"TypeError: Cannot read properties of
  undefined (reading 'styleSourceSelections')"`. Good: `"This instance is a
  ws:collection (DOM-transparent). Wrap it with webstudio_wrap_instance
  before applying styles."`.
- **Adding a tool whose function is `webstudio_index` filtered by category.**
  That's what `webstudio_index(category: "...")` is for.
- **Exposing a sub-handler in the manifest.** Sub-handlers are routed via
  dispatchers (`webstudio_audit`, `webstudio_inspect`). See § 3.2.

## 8. References

**External (Anthropic):**
- [Writing tools for agents][writing-tools] — the primary source for this
  charter. Sections "Augmenting tool descriptions", "Consolidate related
  operations", and "Don't ship without an evaluation suite" are mandatory
  reading.
- [Define tools (Claude API)][define-tools] — `input_examples`, `cache_control`,
  `defer_loading`.
- [Tool search tool][tool-search] — the `bm25_20251119` deferred-loading
  mechanism that backs the 86% manifest-token reduction target.
- [Code execution with MCP][code-mcp] — the 150k → 2k token compression
  pattern for multi-MCP setups.

**In this repo:**
- `docs/tool-search-config.md` — Tool Search Tool client wiring and the
  `defer_loading` story.
- `docs/safety.md` — the push protocol in operational detail.
- `docs/patterns/*.md` — the 22 load-bearing patterns surfaced inline by
  the critical-tier tools.
- `scripts/measure-baseline.mjs` — the canonical metrics script. Run before
  and after every description-touching PR.

[writing-tools]: https://www.anthropic.com/engineering/writing-tools-for-agents
[define-tools]: https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/implement-tool-use
[tool-search]: https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/tool-search-tool
[code-mcp]: https://www.anthropic.com/engineering/code-execution-with-mcp
