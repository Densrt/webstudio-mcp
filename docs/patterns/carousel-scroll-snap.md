---
name: Custom scroll-snap carousel pattern in Webstudio (MVP-7)
description: Complete recipe for building a custom carousel (horizontal scroll-snap, arrows, responsive) in Webstudio without a native component. Validated on darktest 2026-05-08.
category: workflow
complexity: medium
lastUpdated: 2026-05-20
recommendedTool: build.push_fragment
recommendedToolNote: pure CSS scroll-snap horizontal — no JS
---

# Custom scroll-snap carousel — complete recipe

**Context**: Webstudio has no native Carousel component. To build one, combine `ws:collection` + CSS grid scroll-snap + HtmlEmbed for the JS + arrows in `position: absolute`. Validated on darktest with 5 cards bound to an n8n resource.

## DOM architecture

```
section (Carousel section) — display: flex column, width: 100%, overflow-x: hidden
├── h2 (section title)
└── div (Carousel wrapper) — position: relative, width: 100%, min-width: 0
      ├── div (Track) [data-carousel-track]
      │     └── ws:collection (data="resource.data", item, itemKey)
      │           └── div (Card)
      │                 └── ... bound content
      ├── button (Prev) [data-carousel-prev] — position: absolute, left
      ├── button (Next) [data-carousel-next] — position: absolute, right
      └── HtmlEmbed (script + style)
```

## Track: grid > flex (CRUCIAL)

**Classic mistake**: using `display: flex` on the track with cards `width: Npx; flex-shrink: 0` → the cascade of intrinsic widths overflows the viewport.

**Pattern that works**:
```js
// token Layout / Carousel Track
{
  display: "grid",
  gridAutoFlow: "column",
  gridAutoColumns: "calc((100% - 2rem) / 3)",  // 3 cards desktop
  columnGap: "var(--gap-2)",
  overflowX: "auto",
  overflowY: "hidden",
  scrollSnapType: "x mandatory",   // unparsed
  scrollBehavior: "smooth",
  width: "100%", minWidth: 0, maxWidth: "100%",
  scrollbarWidth: "none",          // FF
}
// Responsive overrides on other breakpoints:
//   tablet (≤991) : gridAutoColumns: "calc((100% - 1rem) / 2)"
//   mobile (≤767) : gridAutoColumns: "100%"
```

**Cards**:
```js
{
  width: "100%", minWidth: 0, boxSizing: "border-box",
  scrollSnapAlign: "start",
  scrollSnapStop: "always",
}
```

`grid-auto-columns: calc(% of container)` makes the width derived from the parent → overflow is mathematically impossible.

## Navigation arrows

```js
// token Layout / Carousel Arrow
{
  position: "absolute",
  top: "50%", transform: "translateY(-50%)",  // unparsed
  width: 40px, height: 40px,
  display: "flex", alignItems: "center", justifyContent: "center",
  borderTopLeftRadius/etc.: "50%",  // round disc
  zIndex: 2,
  // visual styling via reused color tokens (bg-card, text-primary, border-card)
}
// + local per button:
//   prev : left: 8px
//   next : right: 8px
//   ≤479 : display: none (native swipe is enough on mobile-portrait)
```

## Instance props

- On the wrapper: `data-carousel-root="true"` (string)
- On the track: `data-carousel-track="true"` (string)
- On the buttons: `data-carousel-prev/next="true"` (string), `aria-label`, `type="button"` (string)

## HtmlEmbed (JS script)

```js
{
  type: "instance",
  component: "HtmlEmbed",
  // children: []
}
// Prop "code" (type: "string"):
```

```html
<script>
(function() {
  document.querySelectorAll('[data-carousel-root]').forEach(function(root) {
    var track = root.querySelector('[data-carousel-track]');
    var prev = root.querySelector('[data-carousel-prev]');
    var next = root.querySelector('[data-carousel-next]');
    if (!track || !prev || !next) return;
    var step = function() {
      var card = track.firstElementChild;
      if (!card) return track.clientWidth;
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return card.offsetWidth + gap;
    };
    prev.addEventListener('click', function() { track.scrollBy({ left: -step(), behavior: 'smooth' }); });
    next.addEventListener('click', function() { track.scrollBy({ left: step(), behavior: 'smooth' }); });
  });
})();
</script>
<style>[data-carousel-track]::-webkit-scrollbar { display: none; }</style>
```

**Tips**:
- Scope by `[data-carousel-root]` → reusable across multiple carousels on a page
- IIFE to avoid polluting the global scope
- `getComputedStyle(track).columnGap` to read the actual gap (resolved CSS var)
- The `<style>` is rendered inline in the DOM (Webstudio does not strip it)

**Limitation**: the script may not run in the **builder preview** (edit mode). Test in publish/preview or reload.

## Body safety net

Defensive pattern recommended in production (prevents global overflow caused by any descendant):
```js
// on PAGE_ROOT (the page's rootInstanceId) or directly on :root for cross-page
{
  overflowX: "hidden",
  maxWidth: "100vw",
}
```

Internal containers with their own `overflow-x: auto` (the track) keep scrolling normally inside.

## For programmatic creation via MCP

No high-level MCP tool for this (yet). Pattern: a custom multi-namespace transaction:
- `dataSources`: 1 or 2 parameters scoped to the collection (item + optional itemKey)
- `instances`: section + h2 + wrapper + track + collection + card template + buttons + embed
- `props`: data-* + aria + embed code + data binding on the collection (data type expression, item type parameter)
- `styleSources`: new tokens + locals for positions
- `styleSourceSelections`: token combinations
- `styles`: base tokens + responsive overrides + locals

See `create-carousel.mjs` (then `refactor-carousel-grid.mjs`) for the complete code.

## TODO V2 (potential `webstudio_create_carousel` MCP tool)

Inputs:
- `projectSlug`, `pageId`, `parentInstanceId`
- `dataSourceId` or `resourceDsId` (the item source)
- `cardTemplate`: structure of the elements in each card (similar to push_fragment)
- `cardsPerView`: { desktop, tablet, mobile }
- `gap`: var or unit
- `arrows`: { enabled, hideBelow }
- `styleTokens`: names of the tokens to use

Generates the whole transaction at once. A good candidate for a finished MVP-7 once we need several carousels.
