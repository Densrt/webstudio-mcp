# Debugging

## Symptom: paste produces raw text

You paste a fragment into the canvas and Webstudio inserts the JSON as plain
text inside a `<p>` instead of building the instances.

### Cause

The clipboard validator (`apps/builder/app/shared/copy-paste/plugin-instance.ts`)
parses through Zod inside a silent `try/catch`. Any schema mismatch — a
mistyped key, a wrong value type, a corrupted character in a large payload —
throws, the catch swallows it, and the fallback hands the clipboard text to
the rich-text input.

There is no error message. Diagnostic has to be done from the outside.

### Step 0: copy integrity

A single mistyped character in a top-level key (`property` instead of `props`)
reproduces the symptom exactly. When the JSON is large (>10 KB) and travels
through a chat or any channel that may normalize / truncate, the bug is
likely transport-level, not format-level.

Before doing anything else: regenerate the fragment and paste again.
Sometimes that's enough.

### Step 1: bisection by progressive removal

If the problem persists:

1. Generate a **minimal** fragment — just the bare component, no styles,
   no tokens, no complex props. Paste it.
2. If that works, reintroduce one group at a time:
   - Local styles with primitive values (`px`, hex color, keyword)
   - States (`:hover`, `[data-state="active"]`)
   - Tokens (with custom ids)
   - Exotic value types (`fontFamily`, `layers`, `image` asset)
   - Keywords on color properties (`transparent`)

The diff between the version that pastes and the version that doesn't
isolates the culprit.

## Things confirmed working

These were each suspected of breaking the validator at one point. All work
in production:

- Radix components with the namespace `@webstudio-is/sdk-components-react-radix:*`
- Tokens with custom non-nanoid ids (e.g. `tok_<projectSlug>_<tokenSlug>`).
  Webstudio matches tokens by id then name; collisions across projects work.
- `fontFamily`: `{ type: "fontFamily", value: ["Inter", "system-ui", "sans-serif"] }`
- `transparent` keyword on `backgroundColor` / `borderColor` (no need to fake
  it via a `color` with `alpha: 0`)
- Negative `unit` values: `{ type: "unit", value: -1, unit: "px" }`
  (margins, `letter-spacing`, etc.)
- States `:hover` and `[data-state="active"]` (with quotes escaped in the
  JSON: `\"active\"`)
- Mixing tokens and locals on the same instance via
  `styleSourceSelections.values: [localId, tokenId]`

## Known bug: HtmlEmbed multi-element SVG

Webstudio silently drops the `code` prop at paste time when the HTML
contains certain combinations of SVG elements. Confirmed:

| SVG content | Result |
|---|---|
| Single `<path>` (any complexity, multiple M/L/Z) | OK |
| `<path>` + `<circle>` | `code` arrives empty in Webstudio |

The drop happens at paste time, not at render time. The string is being
fed through an HTML sanitizer that whitelists a subset of SVG elements.

### Mitigations

Safer SVG conventions for `HtmlEmbed`:

- One graphic element per icon — either a single `<path>` or a `<g>`
  containing only `<path>` children
- Express simple shapes as path commands:
  - Circle: `M12,12 m-4,0 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0`
  - Rectangle: `M2,2 L22,2 L22,22 L2,22 Z`

If the SVG must contain multiple elements, push the embed without `code`
and set the prop manually in the builder Settings panel — that path uses
a direct setter that bypasses the paste sanitizer.

## Sanity check against Zod

When a paste keeps failing and bisection is slow, run the fragment through
the public `WebstudioFragment` schema (`packages/sdk/src/schema/webstudio.ts`)
locally:

```ts
import { WebstudioFragment } from "@webstudio-is/sdk";
WebstudioFragment.parse(myFragment["@webstudio/instance/v0.1"]);
```

The first key Zod fails on is the bug. This works because the validator the
server runs is the same one published to npm.

## Detecting silent server-side failures

`build.patch` returns a Zod error (often as a JSON string in `errors`) when
a payload is malformed. Always log the full response body — the path of the
offending field is usually included.

`status: "ok"` only means **the patch was applied**, not that the result is
visually correct. After every push, re-fetch the build and inspect the
created instances/styles before considering the work done.
