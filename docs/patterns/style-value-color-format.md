---
name: StyleValue color — internal 0..1 vs wire 0..255
description: Color-component format convention in the MCP. Internal=0..1 normalized (consistent across hex+rgb+hsl), Webstudio wire=0..255. Real case build cssvar 2026-05-22 — string "rgb(249,249,249)" overwritten to rgb(1,1,1) because of a parser/normalize mismatch.
category: architecture
complexity: medium
lastUpdated: 2026-05-22
recommendedTool: cssvar.define
recommendedToolNote: push colors as strings ("rgb(r,g,b)" / "#rrggbb" / "rgba(r,g,b,a)") — the server normalizes to wire 0..255 automatically
---

# StyleValue color — internal 0..1 vs wire 0..255 convention

## TL;DR

| Place | Form | Example `rgb(249,249,249)` |
|---|---|---|
| **Caller string input** (recommended) | `"rgb(249, 249, 249)"` / `"#f9f9f9"` / `"rgba(249,249,249,0.5)"` | `"rgb(249, 249, 249)"` |
| **Caller object input** (canonical) | `{type:"color", colorSpace:"rgb", components:[r,g,b], alpha}` with **components in 0..1** | `{components:[0.976, 0.976, 0.976], alpha:1}` |
| **Caller object input** (legacy, accepted with a hint) | `{components:[r,g,b]}` with components in 0..255 | `{components:[249, 249, 249], alpha:1}` |
| **Webstudio wire format** (produced by the server) | `{type:"rgb", r:0..255, g:0..255, b:0..255, alpha:0..1}` | `{type:"rgb", r:249, g:249, b:249, alpha:1}` |

## Real case — cssvar build incident 2026-05-22

The caller pushes a very light background color:

```ts
cssvar.define({
  projectSlug: "...",
  vars: { "color-bg-subtle": "rgb(249, 249, 249)" }
})
```

Before v2.7.11, `cssvar.list` returned `--color-bg-subtle = rgb(1,1,1)` (near-black instead of near-white). Cause: a mismatch in the `parser → normalize` pipeline (see the "Root cause" section below).

Workaround used at the time (before the fix): pass the explicit object form in 0..255:

```ts
vars: { "color-bg-subtle": { type:"color", colorSpace:"rgb", components:[249,249,249], alpha:1 } }
```

It was correct by accident: the `colorSpace === "rgb"` branch of normalize treated the components as 0..255 (no-op + clamp), so the wire format came out right. But it relied on an undocumented convention that was inconsistent with hex.

## Root cause (before the v2.7.11 fix)

The `parseStringToStyleValue` parser (src/tools/define-css-var/parse-style-value.ts) divides by 255 (components in **0..1**) — behavior tested in `test/parse-style-value.test.mjs`. Same for `parseHexColor` in `src/lib/expand-shorthand.ts` (used by the `border: "1px solid #ff0000"` shorthand).

But `colorToServerRgb` in `src/lib/style-normalize.ts` wrongly treated the `colorSpace === "rgb"` branch as **0..255**. Consequence: a caller pushing `"rgb(249,249,249)"` →
1. Parser → `{components:[0.976, 0.976, 0.976]}` ✓
2. Normalize does `Math.round(clampInt(0.976, 0, 255))` = **1**
3. Wire: `{type:"rgb", r:1, g:1, b:1}` ❌

The bug also potentially affected `styles.update` and `tokens.update_token_styles` when a caller pushed `border:"1px solid #xxx"` (shorthand path → hex parser → 0..1 components → normalize broke it).

## v2.7.11+ convention (canonical)

**All RGB spaces are stored in 0..1 in the MCP internal API**, regardless of the `colorSpace` value. This is the same convention as CSS color-level-4 (`color(srgb 0.X 0.X 0.X)`).

The server applies:
1. If a color comes through the MCP with `max(components) > 1` → assume legacy 0..255 (backward-compatible), emit a hint + `coerce:colorRgb-legacy-0-255`.
2. Otherwise → assume 0..1 (canonical form), scale by 255 to the wire.

Alpha always stays in 0..1.

## How to apply

### ✅ Recommended form — CSS strings

```ts
cssvar.define({
  projectSlug: "...",
  vars: {
    "color-bg-page":      "#FFFFFF",
    "color-bg-subtle":    "rgb(249, 249, 249)",
    "color-text-primary": "#001A21",
    "color-overlay":      "rgba(0, 0, 0, 0.6)",
  }
})
```

This is the shortest form on the caller side, delegated to the parser. Zero ambiguity, zero server hint.

### ✅ Canonical object form — components 0..1

```ts
cssvar.define({
  projectSlug: "...",
  vars: {
    "color-primary": {
      type: "color",
      colorSpace: "rgb",
      components: [0, 0.608, 0.706], // Acme #009BB4 normalized
      alpha: 1,
    },
  },
})
```

Useful for computed colors (interpolations, script-generated palettes). No server hint.

### ⚠️ Legacy object form — components 0..255 (accepted with a hint)

```ts
// Works but emits `coerce:colorRgb-legacy-0-255` + hint in the response.
vars: { "color-bg-subtle": { type:"color", colorSpace:"rgb", components:[249,249,249], alpha:1 } }
```

The server detects it automatically (`max(components) > 1` → assume 0..255) and converts correctly to the wire format. The hint nudges the agent toward the canonical form.

## Anti-patterns

### ❌ Mixing 0..1 and 0..255 in the same call

```ts
// Confusing + the max>1 heuristic cannot decide when the values are ambiguous
vars: {
  "color-light": { components:[200, 200, 200], alpha:1 },  // 0..255 implicit
  "color-dark":  { components:[0.1, 0.1, 0.1], alpha:1 },  // 0..1 implicit
}
```

Works thanks to the per-color heuristic, but inconsistent to read. Pick one convention per project (preferred: strings).

### ❌ Passing alpha in 0..255

```ts
vars: { "color-overlay": { components:[0,0,0], alpha:153 } }  // 60% intent → 0..255 ❌
```

Alpha is **always** in 0..1, never in 0..255. The heuristic applies only to the RGB components. `alpha:153` will be clamped to `1` (full opacity).

### ❌ Using hex for colors with transparency

```ts
vars: { "color-overlay": "#000000" }  // pas d'alpha possible via hex 6 chiffres
```

For transparency, use `rgba(...)` or `#RRGGBBAA` (the parser supports both hex lengths in `parseHexColor`).

## Verification

```ts
cssvar.list({ projectSlug, filter: "color" })
// → displays the hex values decoded from the wire format (Math.round(r/255 ... ))
```

If a color shows `#010101` instead of `#F9F9F9` → the caller pushed in 0..1 but the buggy normalize branch read it as 0..255 (regression vs v2.7.11). Re-pushing via cssvar.define on v2.7.11+ fixes it.

## Telemetry keys

- `coerce:colorRgb-legacy-0-255` — the caller passed `components > 1` (legacy form). Reported weekly via the weekly telemetry report (`scripts/telemetry-report.mjs`). Target trend: decreasing over the weeks as the call sites migrate to strings or the 0..1 form.

## Coverage by tool

| Tool | Normalize path | Covered |
|---|---|---|
| `cssvar.define` | `defineCssVarTool.handler` → `normalizeVars` | ✅ with hints + telemetry |
| `styles.update` | `update-styles/build-patches.ts:125` | ✅ silent (fix applied, hints not surfaced to the caller — future release) |
| `tokens.update_token_styles` | `update-token-styles.ts:84` | ✅ silent |
| `build.push_fragment` / `build.build_fragment` / `build.push_complete` | `fragment-to-patches.ts:115` | ✅ silent |

For the silent paths, the heuristic works and fixes the wire format; only the education channel (hint in the response) is not wired up — to be connected in a future release if telemetry shows significant volume.

## Reference

- String → StyleValue parser: `src/tools/define-css-var/parse-style-value.ts`
- StyleValue → wire normalize: `src/lib/style-normalize.ts`
- Related pattern: [css-vars-scope](./css-vars-scope.md) (where to place the vars, not their format)
- Related pattern: [transition-animation-format](./transition-animation-format.md) (another case of wire format vs internal)
