---
name: Custom Swiper.js carousel pattern in Webstudio (MVP-8)
description: Full recipe for building a Swiper.js carousel (autoplay, loop, progressbar, arrow navigation) in Webstudio without a native component. Validated on darktest 2026-05-08. Self-contained (CDN in embed), scoped by data-attribute, lazy init.
category: workflow
complexity: advanced
lastUpdated: 2026-05-20
recommendedTool: build.push_fragment
recommendedToolNote: HtmlEmbed for Swiper.js init + .swiper structure as instances
---

# Custom Swiper.js carousel — full recipe

**Difference from native scroll-snap (MVP-7)**:
- Scroll-snap = pure CSS, native swipe on mobile, no JS lib
- Swiper.js = classic JS lib, more features (autoplay, loop, transitions, effects, lazy, virtualization)

Choose Swiper.js when you need: autoplay, custom transitions, lightbox, effects (fade, cube, coverflow, parallax), syncing with other swipers.
Otherwise scroll-snap is enough (lighter, better perf).

## DOM architecture

```
swiperRoot [data-swiper-root]            ← unique scope, position: relative
├── div.swiper                            ← official Swiper container
│   └── div.swiper-wrapper                ← official Swiper class
│       └── ws:collection (data, item)
│           └── Image .swiper-slide (src bound to item)
├── div.swiper-pagination                 ← progressbar or bullets
├── button.swiper-button-prev             ← custom arrows
├── button.swiper-button-next
└── HtmlEmbed                             ← script + CSS + lib CDN
```

## The self-contained HtmlEmbed

Loads Swiper.js + CSS from a CDN, scopes everything by `[data-swiper-root]`, polls with a timeout, lazy inits via IntersectionObserver. **Code goes in the HtmlEmbed's `prop type="string"`**:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css">
<script src="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js" defer></script>
<style>
  /* Progressbar pagination */
  [data-swiper-root] .swiper-pagination {
    position: absolute !important; bottom: 0 !important;
    left: 0; right: 0; height: 4px;
    background: var(--color-border-card) !important;
    z-index: 10;
  }
  [data-swiper-root] .swiper-pagination-progressbar-fill {
    background: var(--color-text-primary) !important;
    transform-origin: left top;
  }
  /* Slides: flex container for centering */
  [data-swiper-root] .swiper { width: 100%; height: 100%; }
  [data-swiper-root] .swiper-slide {
    display: flex !important;
    align-items: center; justify-content: center;
    background: var(--color-bg-page);
  }
  /* Init fade */
  [data-swiper-root] .swiper:not(.swiper-initialized) { opacity: 0; }
  [data-swiper-root] .swiper.swiper-initialized { opacity: 1; transition: opacity 0.3s ease; }
  /* Disables Swiper's default SVG chevrons (we use our own text) */
  [data-swiper-root] .swiper-button-prev::after,
  [data-swiper-root] .swiper-button-next::after { display: none !important; }
  [data-swiper-root] .swiper-button-disabled { opacity: 0.4; pointer-events: none; }
</style>
<script>
(function() {
  var MAX_WAIT_MS = 3000;
  var start = Date.now();
  function bootEach() {
    document.querySelectorAll('[data-swiper-root]:not([data-swiper-init])').forEach(function(root) {
      var el = root.querySelector('.swiper');
      if (!el) return;
      root.setAttribute('data-swiper-init', 'pending');
      var io = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) { io.disconnect(); initOne(root, el); }
        });
      }, { rootMargin: '100px' });
      io.observe(root);
    });
  }
  function initOne(root, el) {
    if (typeof Swiper === 'undefined') {
      if (Date.now() - start > MAX_WAIT_MS) {
        console.warn('Swiper.js not loaded after', MAX_WAIT_MS, 'ms.');
        root.setAttribute('data-swiper-init', 'failed');
        return;
      }
      return setTimeout(function() { initOne(root, el); }, 100);
    }
    new Swiper(el, {
      loop: true, slidesPerView: 1, spaceBetween: 0, speed: 800,
      autoplay: { delay: 3500, disableOnInteraction: false },
      pagination: { el: root.querySelector('.swiper-pagination'), type: 'progressbar' },
      navigation: {
        prevEl: root.querySelector('.swiper-button-prev'),
        nextEl: root.querySelector('.swiper-button-next'),
      },
    });
    root.setAttribute('data-swiper-init', 'done');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootEach);
  } else {
    bootEach();
  }
})();
</script>
```

## Critical props

| Instance | Prop | Value |
|---|---|---|
| swiperRoot | `data-swiper-root` | "true" |
| .swiper | `class` | "swiper" |
| .swiper-wrapper | `class` | "swiper-wrapper" |
| Image slide | `class` | "swiper-slide" + binding `src` expression |
| .swiper-pagination | `class` | "swiper-pagination" |
| button prev | `class` + `aria-label` + `type` | "swiper-button-prev" + "Previous" + "button" |
| button next | `class` + `aria-label` + `type` | "swiper-button-next" + "Next" + "button" |
| HtmlEmbed | `code` + `executeScriptOnCanvas` | <html above> + true |

⚠️ **`executeScriptOnCanvas: true`** on the HtmlEmbed runs the script inside the **builder preview**, not just on publish. Very useful for debugging.

## Image slide: direct style mandatory

**Bug observed in Webstudio**: the embed CSS `[data-swiper-root] .swiper-slide img { object-fit: contain }` is not always applied — Webstudio's `Image` component can wrap the `<img>` in an intermediate structure that changes the spec.

**Fix**: apply `object-fit: contain` directly on the Image instance via a local styleSource:

```js
// local styleSource on the Image .swiper-slide
{
  objectFit: kw("contain"),
  width: pct(100),
  height: pct(100),
  maxWidth: pct(100),
  maxHeight: pct(100),
  display: kw("block"),
}
```

## Container: fixed aspect-ratio

To avoid a height jump on load (before init), give the container a fixed aspect-ratio:

```js
// Token "Layout / Swiper" sur swiperRoot
{
  width: pct(100), maxWidth: px(720),
  marginLeft: kw("auto"), marginRight: kw("auto"),
  position: kw("relative"),
  aspectRatio: raw("16 / 9"),  // ← key
  overflowX: kw("hidden"), overflowY: kw("hidden"),
  // border + radius via existing tokens
  backgroundColor: v("color-bg-card"),
  // ...
}
```

## Arrow navigation

Reuse the `layout-carousel-arrow` token (created for scroll-snap MVP-7) → free visual consistency.

Local sources for positioning:
- `prev`: `left: 8px`
- `next`: `right: 8px`
- mobile-portrait: `display: none` on both (autoplay + native swipe are enough)

## Key optimizations vs naive version (Globex)

| Aspect | Naive version | Optimized version |
|---|---|---|
| Swiper lib | Loaded elsewhere (project Page Settings) | CDN in the HtmlEmbed → self-contained |
| CSS/JS selectors | global `.swiper`, `.swiper-pagination` | scoped `[data-swiper-root] .xxx` |
| Swiper polling | Infinite loop if the lib never loads | 3s timeout with warning |
| Init | Immediate on `window.load` | Lazy via IntersectionObserver |
| Image fit | Embed CSS | Direct style on the instance (more reliable) |
| Navigation | Pagination dots | Progressbar + custom arrows |

## Recurring pitfalls observed (production session, 2026-05-13)

### Scroll-x — Swiper's problem #1 in Webstudio

Identified causes:
- Webstudio's default **Container** token + a `swiper-root` without an explicit `max-width: 100%` → a few pixels of horizontal overflow.
- Slides with `effect: 'fade'` can generate scroll-x if `box-sizing` is not `border-box` (padding/border add up to `width: 100%`).
- Child media (Image, video) without `max-width: 100%` push the wrapper.

**MANDATORY rule of the pattern (not a safety net)**:

```css
/* INSIDE the Swiper's HtmlEmbed CSS — MANDATORY */
html, body { overflow-x: hidden; }

[data-swiper-root] * { box-sizing: border-box; }
[data-swiper-root],
[data-swiper-root] .swiper,
[data-swiper-root] .swiper-wrapper,
[data-swiper-root] .swiper-slide {
  max-width: 100% !important;
}
```

> **Confirmed empirically on a production project (May 2026)** — without `html, body { overflow-x: hidden }`, scroll-x persists **despite** `max-width: 100%` + `overflow: hidden` + `box-sizing: border-box` + `min-width: 0` applied everywhere along the chain (swiper-root → swiper → wrapper → slides → flex children). The exact cause is not identified — probably Swiper.js injecting inline styles (transforms, widths) during init that overflow the container in a React Router environment like Webstudio. The only way to cut it off cleanly is on `html, body`. **Do not omit this rule.**

### Responsive: `min-width: 0` on flex children

On a `swiper-slide` layout with sub-columns (e.g. slide-left / slide-right in a flex row), the children **must** have `min-width: 0`. Without it, the content (long title, image) prevents shrinking — a classic flexbox bug very visible in Webstudio. At **tablet and below**, stack vertically: `flex-direction: column` on the parent + `width: 100%` on left/right.

### Pagination dots — place inside swiper-root, never inside a slide

The `.swiper-pagination` must be a **direct child of `[data-swiper-root]`** with `position: absolute`. If you put it inside a slide, it disappears on `slideChange` (notably with `effect: 'fade'`, where the inactive slide's opacity goes to 0).

### External "1 / 5" counter — document-wide selector

`pagination: { type: 'bullets' }` + a custom counter **outside swiper-root**, updated via a callback:

```js
new Swiper(el, {
  // ...
  pagination: { el: root.querySelector('.swiper-pagination'), type: 'bullets' },
  on: {
    slideChange: function () {
      // ⚠ document.querySelector, NOT root.querySelector — the counter is outside the root
      var counter = document.querySelector('#swiper-counter');
      if (counter) counter.textContent = (this.realIndex + 1) + ' / ' + this.slides.length;
    },
  },
});
```

### External navigation — `prevEl` / `nextEl` accepts a global selector

The prev/next buttons can live **anywhere in the DOM** (e.g. in a separate bar below the swiper). No need to nest them inside `swiper-root`:

```js
navigation: {
  prevEl: '#external-prev',  // string selector, resolved document-wide
  nextEl: '#external-next',
},
```

## Known Webstudio + collection limitation

`ws:collection` can introduce an intermediate wrapper between `.swiper-wrapper` and the slides. If there is a structure problem (Swiper does not recognize the slides), add to the CSS:

```css
.swiper-wrapper > * { display: flex !important; }
.swiper-wrapper > * > * { width: 100%; flex-shrink: 0; }
```

Or, more drastically: `display: contents` on the intermediate wrapper.

## For programmatic creation via MCP

See `create-swiper.mjs` (then `pimp-swiper.mjs` + `fix-swiper-image.mjs` for the iterations).

Transaction pattern:
- `dataSources`: 1 parameter scoped to the collection
- `instances`: 9 (section + h2 + swiperRoot + swiper + wrapper + collection + slide template + 2 buttons + embed + pagination = 10)
- `props`: data-* + class + aria + data binding + src binding + embed code
- `styleSources`: 1 token + locals for positions
- `styles`: token base + locals + responsive overrides + direct style on image
- `styleSourceSelections`: 5+

## TODO V2 (potential MCP tool `webstudio_create_swiper`)

Inputs:
- `projectSlug`, `pageId`, `parentInstanceId`
- `dataSourceId` (resource or array variable)
- `slideTemplate`: structure of one slide (bound image + optional overlay text)
- `swiperOptions`: { loop, autoplay, slidesPerView, paginationType, navigation, effect }
- `aspectRatio`: "16/9" or "4/3" or custom
- `cdnVersion`: Swiper version (default 11)

Generates the whole transaction in one shot.
