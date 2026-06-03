---
name: State selector format — bare "hover" is a dead state
description: Webstudio stores style states as CSS selectors WITH the leading colon (":hover", "::before", "[data-state=open]"). A bare "hover" (no colon) is accepted by the wire format but never matches at runtime. Real case 2026-06 — tokens.update_token_styles wrote state:"hover" verbatim → silent dead hover. Write paths now coerce recoverable forms + reject unknown states.
category: workflow
complexity: simple
lastUpdated: 2026-06-03
recommendedTool: styles.update OR tokens.update_token_styles
recommendedToolNote: pass `state` as a selector WITH its colon (":hover", "::before"). Recoverable forms ("hover", ":Hover", ":before") are auto-coerced to canonical + hinted since v2.10.10; truly unknown states are rejected with VALIDATION_FAILED.
---

# State selector format — `state` is a selector, not a name

## TL;DR

The `state` field on a style decl is the **CSS selector**, stored **with its leading colon**:

| Intent | Correct `state` | Dead / wrong |
|---|---|---|
| Hover | `":hover"` | `"hover"` ❌ |
| Focus visible | `":focus-visible"` | `"focus-visible"` ❌ |
| Before pseudo-element | `"::before"` | `":before"` (legacy) / `"before"` ❌ |
| Open (Radix data attr) | `"[data-state=open]"` | `"open"` ❌ |
| Base (no pseudo) | `""` or omit | — |

A bare `"hover"` is **accepted by the wire format** (the field is a free string) but produces a decl on an
unknown selector that **never triggers at runtime** — and `get_decls` shows `backgroundColor hover @ Base`,
which *looks* plausible. This is the silent failure mode this pattern exists to prevent.

## Cas réel (2026-06)

```jsonc
// ❌ what produced a dead hover
tokens.update_token_styles({
  tokenName: "Button Secondary",
  updates: [{ property: "backgroundColor", value: {type:"var", value:"brand-color-primary"}, state: "hover" }]
})
// → success, "1 decl applied: add backgroundColor[hover]" — but nothing happens on hover.
```

`get_decls` reported `backgroundColor hover @ Base` (no colon). Re-running with `state: ":hover"` produced
`backgroundColor :hover @ Base` and the hover finally worked. The normalisation brick (`normalizeState`)
already existed but was only wired into read-side audits, never into the write paths.

## What the server does now (v2.10.10)

Every style **write path** — `styles.update`, `tokens.update_token_styles`, `build.from_args` /
`push_fragment` / `push_complete`, and `tokens.extract_variant` — normalises `state` through
`resolveStateForWrite` before building patches:

1. **Valid** (`:hover`, `::before`, `[data-state=open]`, base) → passthrough.
2. **Recoverable** (`hover`, `:Hover`, `::hover`, `:before`) → **coerced to the canonical form**, a `hint`
   surfaced in the response (`[hints]` block), and a `coerce:stateSelector` telemetry event logged.
3. **Unrecoverable** (`:fake-state`, `zzz`) → **`VALIDATION_FAILED`** with an explicit reason — no more
   silent dead states.

On `tokens.update_token_styles`, the coerce also combines with the existing corrupted-variant cleanup:
writing `state:"hover"` now both writes the canonical `:hover` decl **and** removes any pre-existing dead
`hover` sibling. Self-repair.

## Decision tree

- Pseudo-**class** (`hover`, `focus`, `active`, `checked`, `disabled`, `nth-child(2n)`…) → single colon: `:hover`.
- Pseudo-**element** (`before`, `after`, `placeholder`, `selection`, `marker`…) → double colon: `::before`.
  - `:before` / `:after` / `:first-letter` / `:first-line` are legacy CSS2 single-colon elements → canonical is `::before`.
- **Attribute** selector (Radix data-state, ARIA) → brackets verbatim: `[data-state=open]`, `[aria-expanded=true]`.
- **Base** state → `""` or omit the field.

## Source of truth

The accepted names are vendored from Webstudio upstream
(`packages/css-data/src/__generated__/{pseudo-classes,pseudo-elements}.ts`) in
`src/lib/state-whitelist.ts`. Resync trimestriel recommandé — see the header comment of that file for the
last verified upstream commit.
