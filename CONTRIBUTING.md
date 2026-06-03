# Contributing

Thanks for your interest in improving this MCP server. This project deliberately keeps a
**small, disciplined tool surface** — an earlier version grew to ~80 tools and became
unmaintainable. The rules below exist to prevent that. Please read them before opening a PR.

## Ground rules

- **Discuss large changes first.** Open an issue before a new mega-tool or a breaking change.
- **Keep the surface small.** Every change must fit one of the four tiers below.
- **No client/personal data.** Examples must use neutral placeholders (`my-site`, `acme`,
  `cms.example.com`).
- **Tests green, no exceptions.** `npm run build && npm test` must pass before you commit.

## The 4-tier rule (anti-spaghetti grid)

Every improvement fits **exactly one** of these. Inventing a fifth tier (a new mega-tool) is
almost always the wrong call.

| Tier | What | Where it lives |
|---|---|---|
| **1. Pattern doc** | Pedagogy / decision tree for a recurring case | `docs/patterns/<slug>.md` |
| **2. Coerce / detector** | Server-side normalisation or detection of an anti-pattern | `src/lib/expand-shorthand.ts` or `src/lib/style-coerce.ts` |
| **3. Action on an existing mega-tool** | A new verb on an existing surface (`instances`, `tokens`, `audit`, …) | the relevant `src/tools/*-mega.ts` |
| **4. New mega-tool** | A genuinely new functional domain (**very rare**) | new `src/tools/<name>-mega.ts` + register in `src/index.ts` |

Before creating a new mega-tool, all three must be clearly true: (1) no existing mega-tool
action could cover it, (2) a pattern doc + coerce could not cover it, (3) it will have at
least 5 actions. If any answer is weak, use tiers 1–3.

## The 8-step workflow

1. **Reproduce** — capture the exact input + observed symptom.
2. **Find the correct format** — what does Webstudio's UI write for the same action by hand? That is ground truth (`read.inspect` / `project.export`).
3. **Investigate existing code** — often the fix extends a mechanism that already exists.
4. **Decide the tier** — bias toward Tier 1+2 over Tier 3 over Tier 4.
5. **Implement** — keep pure logic (parse/normalise/detect/build) as exported named functions; the tool handler stays a thin shim.
6. **Pattern doc** — add/update a `docs/patterns/<slug>.md` with complete frontmatter (`name`, `description`, `category`, `complexity`, `lastUpdated`, `recommendedTool`, `recommendedToolNote`).
7. **Hint + telemetry** — every silent server coercion must emit a pedagogical `hint` and a stable `telemetryKey` (`expand:*` / `coerce:*` / `detect:*`).
8. **Tests + CHANGELOG + commit.**

## Testing

- **Export pure functions and test them directly.** ESM modules can't be monkey-patched, so don't try — extract `buildX` / `coerceY` / `detectZ` as named exports and unit-test those.
- **Cover the negative cases** for every coerce: triggered, passthrough, malformed input.
- **Add a coverage row** in `test/wrapper-schema-coherence.test.mjs` when you add a mega-tool action (or classify it in `COHERENCE_SKIP` with a reason).
- `npm run build && npm test` must be **zero failures**.

## Commits & releases

- **Conventional Commits**: `feat(scope):` / `fix(scope):` / `refactor(scope):` / `docs(scope):` / `chore(scope):` / `build(scope):` / `test(scope):`.
- **Bump the version** in `package.json` *and* `SERVER_VERSION` in `src/index.ts` to the same value (`npm run bump <patch|minor|major>` does both).
- **Add a CHANGELOG entry** (`Why` / `Added` / `Changed` / `Tests` / `Notes`).

## CI guards

`.github/workflows/mcp-health.yml` enforces: TypeScript build, full test suite, a tool-count
cap, a description-template linter, pattern-doc frontmatter, `package.json` ↔ `src/index.ts`
version consistency. A red check blocks merge.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you
agree to uphold it.
