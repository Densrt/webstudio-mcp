---
name: Zod 4 migration path — status, experiment results, step plan
description: Why the Zod 4 migration was timeboxed out on 2026-06-10 (item 8 of the audit backlog) and the exact path for the day it gets its dedicated session. Experiment proved z.toJSONSchema(draft-7) handles the recursive StyleValue cleanly via definitions/$ref — the blocker is breadth (111 files, 153 schemas, central generator rewrite), not feasibility.
category: architecture
complexity: advanced
lastUpdated: 2026-06-10
recommendedTool: (reference)
recommendedToolNote: Read BEFORE attempting the Zod 4 migration — experiment results + 5-step plan + the 4 known pitfalls.
---

# Zod 4 migration path

> **Status 2026-06-10 : NOT migrated, deliberately.** Timeboxed during the audit backlog
> session — the experiment proved feasibility but revealed a breadth that demands a
> dedicated session, not an end-of-lot slot. Node engines were bumped to >=20 in the
> same session (Node 18 is EOL; CI already runs 20).

## What is already true (no action needed)

- The installed dependency is **zod 3.25.76** (`^3.22.0` resolves there) — which ships
  the **v4 engine under the `zod/v4` subpath**. Migrating does NOT require a dependency
  change, only import changes.
- All 111 `src/` files import from `"zod"` (= v3 API). Both APIs can coexist during an
  incremental migration (`zod/v3` and `zod/v4` subpaths).

## Experiment results (2026-06-10)

`z.toJSONSchema` (v4 native) on a replica of the recursive `StyleValueSchema`
(`z.lazy` union referencing itself):

- `target: "draft-7"` → **works, no throw**. Recursion comes out as
  `"$ref": "#/definitions/__schema0"` + a top-level `definitions` block.
- This is *better* than the current `zod-to-json-schema` output, which degrades the
  recursive branch to `any` (we suppress its warnings in `quietZodToJsonSchema`).
- BUT `z.toJSONSchema` only accepts **v4 schemas** — feeding it the current v3 atomics
  throws. The schema generator can only switch after the atomics are migrated.

## Why it cascades (the no-go rationale)

`actionFromZod` (src/lib/zod-action-def.ts) is the central generator: it consumes the
Zod schema of EVERY atomic. Switching it to v4 requires:

1. all 153 schemas across 111 files moved to `zod/v4` first (big-bang on the generator
   boundary), and
2. a generator rewrite: today it extracts `properties`/`required` and DROPS the rest.
   v4 output carries `definitions` + `$refs` — dropping them produces dangling refs.
   `buildJsonSchemaForActions` must collect each action's `definitions`, rename them
   per action (`__schema0` collides across actions!), and merge them into the flat
   mega-tool schema (then `dedupeSchemaDefs` re-optimises at the wire boundary).

## The 4 known pitfalls (inventoried)

| Pitfall | Where | Fix |
|---|---|---|
| `z.record(z.unknown())` single-arg — **removed in v4** | `src/tools/replace-local-value.ts:22` | `z.record(z.string(), z.unknown())` |
| `.passthrough()` deprecated (alias of `.loose()`) | ~80 uses across mega-tools | Works in v4; rename opportunistically |
| `error.message` format changed in v4 | every `Validation error: ${parsed.error.message}` + tests matching message fragments | Re-run suite, fix assertions; consider `z.prettifyError` |
| `definitions` name collisions on merge | `buildJsonSchemaForActions` | Prefix per action (`<action>__schema0`) + rewrite refs |

## Step plan (for the dedicated session)

1. **Mechanical sweep**: `from "zod"` → `from "zod/v4"` in src/ (sed), fix
   `z.record` single-arg, build.
2. **Generator rewrite**: `actionFromZod` uses `z.toJSONSchema(zod, {target:"draft-7"})`;
   collect + prefix `definitions` per action; merge into the mega schema;
   `wire-budget.test.mjs` + `schema-dedupe` tests guard the output size and ref integrity.
3. **Test pass**: full suite; expect error-message assertion fixes.
4. **Wire validation**: measure (`tools/list` budget) + REAL Claude session smoke test
   (repo rule: never trust internal tests for Anthropic-API compat).
5. **Cleanup**: drop the `zod-to-json-schema` dependency + `quietZodToJsonSchema`;
   release as a minor with a CHANGELOG entry referencing this doc.

Expected payoff: faster parse (marginal here), one dependency removed, recursive schemas
represented precisely instead of `any`. Cost estimate: 4-6h focused.
