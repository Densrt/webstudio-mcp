---
name: Grid child placement — Auto / Area / Manual
description: Convention for placing a child in a CSS Grid (gridColumn*/gridRow*) compatible with the Webstudio Grid Child panel. 3 modes — Auto / Area / Manual. Default = Area span 1 for most cards; Manual reserved for precise placements. NEVER a shortcut. Production bento incident 2026-05-21.
category: component
complexity: simple
lastUpdated: 2026-05-22
recommendedTool: styles.update
recommendedToolNote: Default = Area span 1 (tuple). Manual (4 unit/number) only if precise placement is required. Server auto-coerce since v2.7.2 + Manual→span soft warning since v2.7.3.
---

# Grid child placement — Auto / Area / Manual

## TL;DR

To place a child in a CSS Grid via Webstudio:

- The Webstudio UI Grid Child panel **does not read** the `gridColumn`/`gridRow` shortcuts nor longhands in `unparsed`.
- **Always** send the 4 longhands `gridColumnStart`/`gridColumnEnd`/`gridRowStart`/`gridRowEnd` in canonical format.
- Since v2.7.2, the MCP server auto-coerces both anti-patterns with a teaching hint in the output — but it's better to write the correct format from the start.

## The 3 Webstudio UI modes

| Mode | When to use it | StyleValue format |
|---|---|---|
| **Auto** | Let grid auto-flow place the child (DOM order) | No `gridColumn*/gridRow*` decl |
| **Area** (span N) | Span the child across N cells in the flow direction | `gridColumnStart`/`gridColumnEnd` (or Row) = `{type:"tuple", value:[{type:"keyword",value:"span"},{type:"unit",value:N,unit:"number"}]}` |
| **Manual** | Place the child at precise grid lines | `gridColumnStart`/`gridColumnEnd`/`gridRowStart`/`gridRowEnd` each as `{type:"unit",value:N,unit:"number"}` |

## Decision tree — when to choose which mode

**Default = Area `span 1`** for most cards in a bento, catalog, or listing grid that auto-place:

- DRY — all cards share the same decl format
- Resilient to grid changes (going from 3 to 4 cols without touching the cards)
- Reflects the real intent: *"these cards fill the free cells in order"*
- CSS auto-flow handles placement

**Manual**: reserved for indispensable precise placements

- Hero card that must occupy a specific area
- Header spanning N cols full-width
- Center card of a bento that must sit at an exact spot
- Any asymmetric collage where placement carries meaning

**Auto**: when DOM order = visual order AND no card spans > 1

- N cards in 1 row, order identical to the DOM
- No `gridColumn*/gridRow*` decl to set

### Quick heuristic

| Situation | Mode |
|---|---|
| 3 cols × 2 rows grid, 6 identical cards | **Area span 1** on all |
| 1 hero card + N side cards | Hero in **Manual**, side cards in **Area span 1** |
| Card that must be 2 rows tall | **Area span 2** (rows) on that card |
| 1 row, DOM order = visual order | **Auto** (nothing) |
| Asymmetric bento with precise spots (collage) | **Manual** on the cards concerned |
| 4 side cards + 1 identical-everywhere center card | 4 side **Area span 1**, center **Manual** |

## CORRECT format — Manual mode (lines 4-5 col, 3-4 row)

```json
[
  { "property": "gridColumnStart", "value": { "type": "unit", "value": 4, "unit": "number" } },
  { "property": "gridColumnEnd",   "value": { "type": "unit", "value": 5, "unit": "number" } },
  { "property": "gridRowStart",    "value": { "type": "unit", "value": 3, "unit": "number" } },
  { "property": "gridRowEnd",      "value": { "type": "unit", "value": 4, "unit": "number" } }
]
```

## CORRECT format — Area mode (col line 2, span 2 rows)

```json
[
  { "property": "gridColumnStart", "value": { "type": "unit", "value": 2, "unit": "number" } },
  { "property": "gridColumnEnd",   "value": { "type": "unit", "value": 3, "unit": "number" } },
  { "property": "gridRowStart",    "value": { "type": "keyword", "value": "auto" } },
  { "property": "gridRowEnd",      "value": { "type": "tuple", "value": [{ "type": "keyword", "value": "span" }, { "type": "unit", "value": 2, "unit": "number" }] } }
]
```

## ❌ Anti-pattern A — `gridColumn` / `gridRow` shortcut

```json
{ "property": "gridColumn", "value": { "type": "unparsed", "value": "4" } }
{ "property": "gridRow",    "value": { "type": "unparsed", "value": "3" } }
```

- The rendered CSS WORKS (`grid-column: 4; grid-row: 3;`)
- **BUT** the Webstudio UI Grid Child panel **does not read** the shortcuts
- The user cannot edit these values from the panel
- Potential pollution on the children (recurring shorthand bug observed on a production project with an HtmlEmbed SVG logo inside an `<a>` card)

**Since v2.7.2**: the server auto-expands the shortcut into 2 longhands with a teaching hint:

```
[hints]
- gridColumn shortcut "4" interpreted as Manual mode line 4 (1-cell span) → gridColumnStart:4, gridColumnEnd:5. See pattern grid-child-placement.
```

## ❌ Anti-pattern B — longhands in `unparsed`

```json
{ "property": "gridColumnStart", "value": { "type": "unparsed", "value": "4" } }
{ "property": "gridColumnEnd",   "value": { "type": "unparsed", "value": "5" } }
```

- The rendered CSS also WORKS (`grid-column: 4 / 5`)
- **BUT** the Manual Grid Child panel shows the **defaults (1/2/1/2)** instead of the real values
- The user cannot edit these props from the UI

**Since v2.7.2**: the server auto-coerces to `{type:"unit",value:N,unit:"number"}` with a hint.

## ❌ Anti-pattern C — Manual everywhere by mimicry

An agent that sees an existing card in Manual tends to reproduce the pattern on **all** cards, even when `Area span 1` would do and would be cleaner. Demo on a "Categories" bento (3 cols × 2 rows, 1 center card + 4 side cards).

### Before (bad) — 4 side cards in hand-computed Manual

```json
// Card A (col 1, row 1)
gridColumnStart: { "type": "unit", "value": 1, "unit": "number" }
gridColumnEnd:   { "type": "unit", "value": 2, "unit": "number" }
gridRowStart:    { "type": "unit", "value": 1, "unit": "number" }
gridRowEnd:      { "type": "unit", "value": 2, "unit": "number" }

// Card B (col 3, row 1)        — gridColumnStart: 3, End: 4, Row: 1/2
// Card C (col 1, row 2)        — gridColumnStart: 1, End: 2, Row: 2/3
// Card D (col 3, row 2)        — gridColumnStart: 3, End: 4, Row: 2/3
```

Problems:

- **16 decls** for 4 cards (4 longhands × 4 cards) instead of 16 fully identical decls in Area
- **Fragile** — switching the grid to 4 cols requires recomputing the indices of every card
- **Unclear intent** — reading the code says "these cards are at these coords", not "these cards fill the space"
- **UI/author coupling** — if you want to rearrange via the Webstudio UI, you have to recompute the indices by hand

### After (good) — 4 side cards in Area span 1 + Acme in Manual

```json
// Card Acme (center) — Manual REQUIRED because of precise placement (col 2, rows 1-2)
gridColumnStart: { "type": "unit", "value": 2, "unit": "number" }
gridColumnEnd:   { "type": "unit", "value": 3, "unit": "number" }
gridRowStart:    { "type": "unit", "value": 1, "unit": "number" }
gridRowEnd:      { "type": "unit", "value": 3, "unit": "number" }

// Cards A / B / C / D — Area span 1, all IDENTICAL
gridColumnStart: { "type": "tuple", "value": [{ "type": "keyword", "value": "span" }, { "type": "unit", "value": 1, "unit": "number" }] }
gridColumnEnd:   { "type": "tuple", "value": [{ "type": "keyword", "value": "span" }, { "type": "unit", "value": 1, "unit": "number" }] }
gridRowStart:    { "type": "tuple", "value": [{ "type": "keyword", "value": "span" }, { "type": "unit", "value": 1, "unit": "number" }] }
gridRowEnd:      { "type": "tuple", "value": [{ "type": "keyword", "value": "span" }, { "type": "unit", "value": 1, "unit": "number" }] }
```

Benefits:

- **4 cards × 4 identical longhands** = a single pattern to push (can even come from a "Card Bento Span 1" token)
- **Resilient** — grid change (3→4 cols) without touching the cards
- **Clear intent** — *"span 1 cell, auto-placed"*
- **CSS auto-flow** naturally places the 4 cards in the free cells: col 1 row 1 → col 3 row 1 → col 1 row 2 → col 3 row 2

### Server auto-detect v2.7.3

The server emits a soft warning if **≥3 instances** in a `styles.update` batch are pushed with a Manual single-cell placement on the same breakpoint:

```
[hints]
- 4 instances pushed with Manual single-cell grid placement that could be Area span 1 (auto-flow). See pattern grid-child-placement (Anti-pattern C).
```

It does not block the push — it's just a suggestion. You can ignore it if the Manual placement is intentional (e.g. an asymmetric layout).

## Real cases — a production project "Our brands" section (bento 3 cols × 2 rows)

Final design (corrected manually via the Webstudio UI):

### Card Acme (center) — Manual required

Fixed position at the center of the bento, 1 col × 2 rows.

```json
gridColumnStart: { "type": "unit", "value": 2, "unit": "number" }
gridColumnEnd:   { "type": "unit", "value": 3, "unit": "number" }
gridRowStart:    { "type": "unit", "value": 1, "unit": "number" }
gridRowEnd:      { "type": "unit", "value": 3, "unit": "number" }
```

### Cards A / B / C / D — Area span 1 (all identical)

CSS auto-flow places them in the 4 free cells (around Acme).

```json
gridColumnStart: { "type": "tuple", "value": [{ "type": "keyword", "value": "span" }, { "type": "unit", "value": 1, "unit": "number" }] }
gridColumnEnd:   { "type": "tuple", "value": [{ "type": "keyword", "value": "span" }, { "type": "unit", "value": 1, "unit": "number" }] }
gridRowStart:    { "type": "tuple", "value": [{ "type": "keyword", "value": "span" }, { "type": "unit", "value": 1, "unit": "number" }] }
gridRowEnd:      { "type": "tuple", "value": [{ "type": "keyword", "value": "span" }, { "type": "unit", "value": 1, "unit": "number" }] }
```

## Why does Webstudio do this?

The UI Grid Child panel is implemented as 4 distinct fields (Start Col, End Col, Start Row, End Row). When the user enters Manual 4/5/3/4, the UI writes 4 independent declarations as `{type:"unit"}`. Any other form (shortcut or unparsed) is not recognized by the panel reader — the UI falls back to its internal defaults.

This is consistent with the general Webstudio pattern: **store as longhands**. See also `flexbox-flex-basis-direction-trap` (same logic on flex), and commit `7367d37` which did the same for padding/margin/border/inset.

## Server auto-coerce v2.7.2

| Caller input | Server output | Hint emitted |
|---|---|---|
| `gridColumn: "4"` (unparsed) | `gridColumnStart: unit 4, gridColumnEnd: unit 5` | Yes — "Manual mode line 4 (1-cell span)" |
| `gridColumn: "4 / 5"` (unparsed) | `gridColumnStart: unit 4, gridColumnEnd: unit 5` | Yes |
| `gridColumn: "span 2"` (unparsed) | `gridColumnStart: auto, gridColumnEnd: tuple[span, 2]` | Yes — "Area mode" |
| `gridColumn: "4 / span 2"` (unparsed) | `gridColumnStart: unit 4, gridColumnEnd: tuple[span, 2]` | Yes |
| `gridColumn: {type:"unit",value:4,unit:"number"}` (typed) | `gridColumnStart: unit 4, gridColumnEnd: unit 5` | Yes |
| `gridColumnStart: {type:"unparsed",value:"4"}` (longhand digit) | `gridColumnStart: unit 4` (number) | Yes — "panel requires {type:'unit'}" |
| `gridColumnEnd: {type:"unparsed",value:"span 2"}` (longhand span) | `gridColumnEnd: tuple[span, 2]` | Yes — "Area mode" |
| `gridColumnStart: {type:"unit",value:4,unit:"number"}` (already OK) | passthrough | — |

## `aspectRatio` format — normalize the spaces

`aspectRatio` is often entered in two equivalent formats:

- Without spaces: `"16/9"` (often from the Webstudio UI when typing quickly)
- With spaces: `"16 / 9"` (canonical CSS format, readable)

Both variants are valid CSS, but having both in the same build is unsightly (one observed case had `"16/9"` on the token side and `"16 / 9"` on the local side pushed by the agent — inconsistent).

The MCP server v2.7.3+ **auto-normalizes to the format with spaces**:

| Caller input | Server output |
|---|---|
| `aspectRatio: {type:"unparsed", value:"16/9"}` | `aspectRatio: {type:"unparsed", value:"16 / 9"}` |
| `aspectRatio: {type:"unparsed", value:"16 / 9"}` | passthrough |
| `aspectRatio: {type:"unparsed", value:"16  /  9"}` | `aspectRatio: {type:"unparsed", value:"16 / 9"}` |
| `aspectRatio: {type:"keyword", value:"auto"}` | passthrough (keyword unchanged) |
| `aspectRatio: {type:"keyword", value:"inherit"}` | passthrough |

Hint emitted when normalization occurs:

```
[hints]
- aspectRatio value normalized from "16/9" to "16 / 9" for canonical CSS format consistency. See pattern grid-child-placement.
```

## Rules recap

1. **Default = Area `span 1`** for auto-placed cards in a grid (DRY + resilient to grid changes).
2. **Manual** reserved for indispensable precise placements (hero card, bento center, full-width header).
3. **Auto** when DOM order = visual order and no span > 1.
4. **Never** the `gridColumn` or `gridRow` shortcut. Always the 4 longhands.
5. **Never** `unparsed "N"` on the grid longhands. Always `{type:"unit",value:N,unit:"number"}` or `{type:"tuple"}` for span.
6. For a span: `{type:"tuple", value:[{type:"keyword",value:"span"}, {type:"unit",value:N,unit:"number"}]}`.
7. `aspectRatio`: enter with spaces (`"16 / 9"`). The server normalizes since v2.7.3.
8. The server v2.7.2+ auto-fixes the format anti-patterns (shortcut, unparsed). v2.7.3+ also detects the Manual-everywhere-by-mimicry pattern (≥3 instances) and suggests `span 1`.
