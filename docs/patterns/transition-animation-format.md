---
name: Transition / animation — layers shape and longhand completion
description: Webstudio stores transition*/animation* longhands as {type:"layers"} even for a single layer. Single typed values are auto-wrapped; missing longhands are auto-completed with CSS defaults so the Transition / Animation panels render correctly. Covers styles.update, tokens.update_token_styles, tokens.create_tokens, build.push_complete (cloudTokens + inline styles), build.push_fragment.
category: component
complexity: medium
lastUpdated: 2026-06-03
recommendedTool: styles.update OR tokens.update_token_styles OR build.push_complete
recommendedToolNote: pass each transition/animation longhand as {type:"layers", value:[...]} so the UI panel decodes it. The server wraps single typed values and completes missing siblings automatically since v2.7.10.
---

# Transition / Animation — layers mandatory + all longhands

## TL;DR

- The longhands `transitionProperty / Duration / TimingFunction / Delay / Behavior` (5 total) and `animationName / Duration / TimingFunction / Delay / IterationCount / Direction / FillMode / PlayState` (8 total) **must be in `{type:"layers", value:[...]}`** — even with a single layer.
- The Webstudio panel reads each longhand at the same index: if `transitionProperty.layers[0]` exists but `transitionTimingFunction.layers[0]` is missing, **the entire layer 0 falls back to defaults** (`all 0s ease 0s`) and the transition does not apply visually.
- The shorthand `transition: "color 200ms ease"` is **rejected** by `expandShorthand` (explicit error). Go through the individual longhands.

## Canonical caller-side shape

```json
{
  "transitionProperty":       { "type": "layers", "value": [{ "type": "unparsed", "value": "color" }] },
  "transitionDuration":       { "type": "layers", "value": [{ "type": "var", "value": "speed-fast" }] },
  "transitionTimingFunction": { "type": "layers", "value": [{ "type": "var", "value": "easing-default" }] },
  "transitionDelay":          { "type": "layers", "value": [{ "type": "unit", "value": 0, "unit": "ms" }] },
  "transitionBehavior":       { "type": "layers", "value": [{ "type": "keyword", "value": "normal" }] }
}
```

The referenced `var()`s must exist in scope (token or variable). See [css-vars-scope](./css-vars-scope.md).

## What the MCP does for you (since v2.7.10)

Two silent normalizations to recover from sub-optimal inputs. No error, just hints + telemetry.

### 1. Single typed value → layers[1] (`coerce:composedSingleToLayers`)

If you push a longhand as a direct `{type:"var"|"keyword"|"unit"|"function"}` (without wrapping in layers), the server wraps it automatically:

```jsonc
// Input
{ "property": "transitionDuration",
  "value": { "type": "var", "value": "speed-fast" } }

// Server-coerced (UI-decodable)
{ "property": "transitionDuration",
  "value": { "type": "layers", "value": [{ "type": "var", "value": "speed-fast" }] } }
```

The `var()` ref is **preserved** (not replaced by a hardcoded value).

### 2. Missing longhands → completed (`coerce:completeTransitionLonghands` / `coerce:completeAnimationLonghands`)

If you push only 2 or 3 of a transition's 5 longhands (or 2-3 of an animation's 8), the server adds the missing ones with their CSS defaults, at the **same number of layers**:

```jsonc
// Input (3 longhands only)
{
  "transitionProperty":       { "type": "layers", "value": [{ "type": "unparsed", "value": "color" }] },
  "transitionDuration":       { "type": "layers", "value": [{ "type": "var", "value": "speed-fast" }] },
  "transitionTimingFunction": { "type": "layers", "value": [{ "type": "var", "value": "easing-default" }] }
}

// Server-completed (5 longhands, all length-1)
{
  "transitionProperty":       { "type": "layers", "value": [{ "type": "unparsed", "value": "color" }] },
  "transitionDuration":       { "type": "layers", "value": [{ "type": "var", "value": "speed-fast" }] },
  "transitionTimingFunction": { "type": "layers", "value": [{ "type": "var", "value": "easing-default" }] },
  "transitionDelay":          { "type": "layers", "value": [{ "type": "unit", "value": 0, "unit": "ms" }] },
  "transitionBehavior":       { "type": "layers", "value": [{ "type": "keyword", "value": "normal" }] }
}
```

N-layers case: if the existing cohort (token / instance / breakpoint / state) already has `transitionProperty.layers[3]` and you push a single var layer on `transitionDuration`, the completer **pads your layer** to 3 (var + 2 `0ms` defaults), it does NOT collapse it to 1.

## Coverage (paths wired since v2.7.10)

| Tool / route | Single→layers | Longhands completed |
|---|---|---|
| `styles.update` | ✅ via `coerceStyleValue` | ✅ via `completeTransitionAnimationLonghands` (per styleSource+breakpoint+state cohort) |
| `tokens.update_token_styles` | ✅ | ✅ |
| `tokens.create_tokens` | ✅ via `coerceStyleValue` | ✅ via `completeTransitionAnimationLonghands` (token cohort; existing decls fed in on overwrite) — since v2.10.9 |
| `build.push_complete` cloudTokens | ✅ | ✅ |
| `build.push_complete` inline styles / `build.push_fragment` / `build.build_fragment` | ✅ via `coerceStyleValue` | ✅ via `buildFromArgs` (per instance+breakpoint+state cohort, existing=[]) |
| `build.push_html` (CSS parser) | ✅ (parser already emits layers) | ✅ (inherited via `buildFromArgs`) |

## Alternative accepted shape — `{type:"unparsed", value:"<css string>"}`

If you prefer to pass raw CSS, the parser does the work:

```jsonc
{ "property": "transitionDuration",
  "value": { "type": "unparsed", "value": "var(--speed-fast)" } }
// → wrapped to { type:"layers", value:[{ type:"var", value:"speed-fast" }] }
```

This was the historical route (commit `7618258`, v2.4.0). Still supported.

## Pre-v2.7.10 symptoms (for retroactive debugging)

If you see these signs in a build, it is the bug that v2.7.10 fixes:

- Hover does not trigger the transition on screen (CSS changes instantly, no fade)
- The Transition panel UI shows `all 0s ease 0s` even though you pushed longhands
- The user re-enters the transition in the UI → Webstudio rewrites it by hardcoding the `var()` values (loss of the design system)

Immediate fix without upgrading: pass all longhands as `{type:"layers", value:[...]}` explicitly. The `{type:"unparsed", value:"..."}` shape already worked.

## Anti-patterns

❌ Pushing a single longhand expecting the panel to auto-complete on the caller side. Without the server completer, the cohort stays partial.

❌ Pushing `transitionDuration: { type: "var", value: "speed-fast" }` directly pre-v2.7.10. The decl was silently ignored by the UI.

❌ Mixing layers of different cardinalities across longhands of the same cohort (`transitionProperty.layers[3]` + `transitionDuration.layers[1]`) expecting smart pairing. The completer pads to `max(layers)`.

❌ Shorthand `transition: "color 200ms ease"` → rejected. Use longhands.

## Cross-refs

- [architecture-tokens](./architecture-tokens.md) — where to place these longhands in a reusable token
- [css-vars-scope](./css-vars-scope.md) — how to guarantee `var(--speed-fast)` is in scope at the point of use
- [tokens-cloud-vs-local](./tokens-cloud-vs-local.md) — correct workflow to create a token with a transition

## Telemetry keys

- `coerce:composedSingleToLayers` — input single typed wrapped to layers[1]
- `coerce:completeTransitionLonghands` — missing transition longhands synthesized
- `coerce:completeAnimationLonghands` — missing animation longhands synthesized

Tracked weekly via the weekly telemetry report (`scripts/telemetry-report.mjs`). A high and rising frequency = pattern doc to reinforce or tool description to clarify.
