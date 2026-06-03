# Reusable patterns

Component recipes that took non-trivial effort to get right. Each section
states the architecture, the styles that matter, and the traps to avoid.

The Radix components below are exposed by Webstudio under the namespace:

```
@webstudio-is/sdk-components-react-radix:<ComponentName>
```

Native components (`HtmlEmbed`, `Image`, `Form`, `Input`) keep their short
name. Generic HTML uses `ws:element` plus `tag`.

---

## Carousel — scroll-snap (no JS library)

CSS-only horizontal carousel using `scroll-snap`. Cheaper than Swiper when
you only need swipe + arrows + responsive cards-per-view.

### DOM

```
section (display: flex column)
└── div [data-carousel-root] (position: relative)
    ├── div [data-carousel-track]
    │   └── ws:collection (data, item, itemKey)
    │       └── div (card)
    ├── button [data-carousel-prev] (position: absolute, left)
    ├── button [data-carousel-next] (position: absolute, right)
    └── HtmlEmbed (script + style scoped by [data-carousel-root])
```

### Track styles (key insight: grid, not flex)

A `display: flex` track with `width: <px>; flex-shrink: 0` cards lets each
card's intrinsic width drive the parent and overflow the viewport. Use
`grid-auto-columns` instead — the column width is derived from the parent,
overflow becomes mathematically impossible.

```js
{
  display: "grid",
  gridAutoFlow: "column",
  gridAutoColumns: "calc((100% - 2rem) / 3)",   // 3 cards desktop
  columnGap: "var(--gap-2)",
  overflowX: "auto",
  scrollSnapType: "x mandatory",                // unparsed
  scrollBehavior: "smooth",
  scrollbarWidth: "none",
  width: "100%", minWidth: 0, maxWidth: "100%",
}
// breakpoint overrides:
// tablet (≤991): gridAutoColumns: "calc((100% - 1rem) / 2)"
// mobile (≤767): gridAutoColumns: "100%"

// each card:
{ scrollSnapAlign: "start", scrollSnapStop: "always",
  width: "100%", boxSizing: "border-box" }
```

### JS in the HtmlEmbed

```html
<script>
(function () {
  document.querySelectorAll('[data-carousel-root]').forEach(function (root) {
    var track = root.querySelector('[data-carousel-track]');
    var prev = root.querySelector('[data-carousel-prev]');
    var next = root.querySelector('[data-carousel-next]');
    if (!track || !prev || !next) return;
    var step = function () {
      var card = track.firstElementChild;
      if (!card) return track.clientWidth;
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return card.offsetWidth + gap;
    };
    prev.addEventListener('click', function () { track.scrollBy({ left: -step(), behavior: 'smooth' }); });
    next.addEventListener('click', function () { track.scrollBy({ left: step(), behavior: 'smooth' }); });
  });
})();
</script>
<style>[data-carousel-track]::-webkit-scrollbar { display: none; }</style>
```

The IIFE keeps the global scope clean. The `[data-carousel-root]` scope lets
multiple carousels coexist on a page. `getComputedStyle` resolves CSS vars
correctly even when `columnGap` is `var(--gap-2)`.

The script does not always fire in the builder canvas preview — verify in
publish/preview.

---

## Carousel — Swiper.js (autoplay, transitions, effects)

Use this when scroll-snap is not enough: autoplay, loop, fade/coverflow
effects, parallax, two synced swipers, etc.

### Self-contained pattern

The `HtmlEmbed` carries everything: Swiper CDN tags, scoped CSS, init
script. No global Page-Settings dependency.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css">
<script src="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js" defer></script>
<style>
  [data-swiper-root] .swiper { width: 100%; height: 100%; }
  [data-swiper-root] .swiper:not(.swiper-initialized) { opacity: 0; }
  [data-swiper-root] .swiper.swiper-initialized {
    opacity: 1; transition: opacity 0.3s ease;
  }
  [data-swiper-root] .swiper-button-prev::after,
  [data-swiper-root] .swiper-button-next::after { display: none !important; }
  [data-swiper-root] .swiper-button-disabled { opacity: 0.4; pointer-events: none; }
  [data-swiper-root] .swiper-pagination {
    position: absolute !important; bottom: 0 !important;
    left: 0; right: 0; height: 4px;
    background: var(--color-border-card) !important;
  }
  [data-swiper-root] .swiper-pagination-progressbar-fill {
    background: var(--color-text-primary) !important;
  }
</style>
<script>
(function () {
  var MAX_WAIT_MS = 3000, start = Date.now();
  function bootEach() {
    document.querySelectorAll('[data-swiper-root]:not([data-swiper-init])').forEach(function (root) {
      var el = root.querySelector('.swiper');
      if (!el) return;
      root.setAttribute('data-swiper-init', 'pending');
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { io.disconnect(); initOne(root, el); }
        });
      }, { rootMargin: '100px' });
      io.observe(root);
    });
  }
  function initOne(root, el) {
    if (typeof Swiper === 'undefined') {
      if (Date.now() - start > MAX_WAIT_MS) {
        root.setAttribute('data-swiper-init', 'failed'); return;
      }
      return setTimeout(function () { initOne(root, el); }, 100);
    }
    new Swiper(el, {
      loop: true, slidesPerView: 1, speed: 800,
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

Key choices:

- Polling for `Swiper` undefined with a 3s ceiling, instead of an unbounded
  loop if the CDN is blocked.
- `IntersectionObserver` defers init until the carousel scrolls into view.
- All selectors scoped under `[data-swiper-root]` so multiple instances on a
  page do not collide.

### Image fit

Webstudio's `Image` component sometimes wraps the `<img>` in an intermediate
element that overrides CSS from the embed. Apply `object-fit` directly on
the Image instance via a local style source:

```js
{ objectFit: keyword("contain"), width: pct(100), height: pct(100), display: keyword("block") }
```

### Aspect ratio on the container

To prevent layout shift before init:

```js
{ aspectRatio: unparsed("16 / 9"), overflowX: "hidden", overflowY: "hidden", position: "relative" }
```

### Set `executeScriptOnCanvas: true` on the HtmlEmbed

Without it, the script only runs on publish/preview, never in the builder
canvas. Useful for debug.

---

## NavigationMenu (Radix) + mega menu

Webstudio handles open/close state, keyboard navigation, ARIA, and viewport
sizing through Radix CSS variables. The host structure must follow the
exact shape below.

### DOM

```
NavigationMenu                     [position: relative; max-width: max-content]
├── NavigationMenuList             [flex; padding 0; margin 0; list-style none]
│   ├── NavigationMenuItem (mega)
│   │   ├── NavigationMenuTrigger
│   │   │   └── Button             [receives data-state="open"]
│   │   │       ├── Text "Label"
│   │   │       └── Box (icon container)
│   │   │           └── HtmlEmbed (chevron SVG)
│   │   └── NavigationMenuContent  [position: absolute; top: 0; left: 0; width: max-content]
│   │       └── ...mega contents
│   └── NavigationMenuItem (simple)
│       └── NavigationMenuLink
│           └── Link "Standalone"
└── Box (viewport container)       [position: ABSOLUTE; top: 100%; left: 0]
    └── NavigationMenuViewport     [position: relative; width/height: var(--radix-...);
                                    NO transition on those]
```

### Three traps that broke this every previous attempt

**1. Never put `transition` on the viewport's width/height.**
Radix updates `--radix-navigation-menu-viewport-{height,width}` continuously
during the open animation. A transition on those properties interpolates
each tick and produces a visible shrink/flicker. Animate `opacity` or
`transform: scale()` instead if you need an entry effect.

**2. Viewport container must be `position: absolute`, not `fixed`.**
With `fixed` the viewport leaves the menu's local coordinate system and
either lands at the top of the page or detaches entirely. `absolute`
relative to the menu root gives the right anchor.

**3. The `NavigationMenu` root must be `position: relative; max-width: max-content`.**
Without this, the absolute viewport positions itself relative to the
nearest positioned ancestor (often `body`) and the menu spans the whole
viewport.

### Trigger inner structure (required)

```
NavigationMenuTrigger
└── Button
    ├── Text "Label"
    └── Box (icon container)
        └── HtmlEmbed (chevron)
```

Plain text directly under `NavigationMenuTrigger` does not work — Radix
expects a `Button` to bind state to.

The `[data-state="open"]` attribute lands on the Button. Style it (and its
icon container) for the open state, not the Trigger.

### Chevron rotation

```js
// On Button
{ "--navigation-menu-trigger-icon-transform": deg(0) }                    // base
{ "--navigation-menu-trigger-icon-transform": deg(180) }                  // [data-state="open"]

// On the icon container
{ rotate: var("navigation-menu-trigger-icon-transform"),
  transition: "all 200ms cubic-bezier(0.4, 0, 0.2, 1)" }
```

### Link inner structure

```
NavigationMenuLink
└── Link
    ├── Text "Title"
    └── Paragraph "Description"   (optional)
```

Same rule: `Link` is the asChild target; bare text under
`NavigationMenuLink` does not bind props correctly.

---

## Sheet / Mobile nav (Radix Dialog)

Used for slide-in mobile navigation with an animated burger trigger. There
is no Radix `Sheet` component — `Sheet` is a Dialog with side-panel styling.

### Top-level shape

Two **siblings** at the top level (the CSS embed is not a child of the
Dialog):

```
Dialog (label "Mobile menu")
└── …
HtmlEmbed (label "Animation CSS")
```

Inside the Dialog:

```
Dialog
├── DialogTrigger
│   └── Button [class="burger-btn"]
│       ├── div "top bar"
│       ├── div "middle bar"
│       └── div "bottom bar"
└── DialogOverlay [data-role="menu-overlay"]
    └── DialogContent [data-role="menu-content"]
        └── ws:element nav
            └── …links…
```

### Animations: keyframes, not transitions

Radix unmounts the DOM on close. A `transition` cannot play during exit.
With CSS `animation` plus `forwards`, Radix waits for `animationend`
before unmounting.

```css
@keyframes brand-slide-in  { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes brand-slide-out { from { transform: translateX(0); } to { transform: translateX(100%); } }
@keyframes brand-fade-out  { from { opacity: 1; } to { opacity: 0; } }

[data-role="menu-content"] { will-change: transform; }
[data-role="menu-content"][data-state="open"]
  { animation: brand-slide-in 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }
[data-role="menu-content"][data-state="closed"]
  { animation: brand-slide-out 200ms ease-in forwards; }
[data-role="menu-overlay"][data-state="closed"]
  { animation: brand-fade-out 200ms ease-in forwards; }
```

### `data-state` propagation

`DialogTrigger` uses `asChild={true}` and forwards `data-state` onto its
first child. Putting `class="burger-btn"` on the Button lets you target
`.burger-btn[data-state="open"]` in CSS. `DialogOverlay` and
`DialogContent` receive `data-state` directly.

### Burger animation: CSS vars defined in styles, overridden in the embed

Declare default (closed) values on the Button as Webstudio styles, override
on `[data-state="open"]` from the embed CSS:

```js
// On Button (Webstudio styles)
{ "--angle": "0deg", "--move": "0", "--middle-op": "1",
  "--angle-rev": "0deg", "--move-rev": "0" }
```

```css
.burger-btn[data-state="open"] {
  --angle: 45deg; --move: 6px; --middle-op: 0;
  --angle-rev: -45deg; --move-rev: -6px;
}
```

```js
// On each bar (Webstudio styles)
{ transform: "translateY(var(--move,0)) rotate(var(--angle,0deg))",
  transition: "transform 300ms cubic-bezier(.4,0,.2,1)",
  backgroundColor: keyword("currentColor") }
```

`currentColor` on the bars + a `color` declaration on the Button gives a
single source of truth for the burger color.

### Z-index

The burger must remain visible during the open animation:

```
Button     z-index: 1002
Overlay    z-index: 998
```

### Idempotent push

A pattern that keeps getting pushed needs cleanup at the start of every
push, otherwise the page accumulates duplicate Dialogs. The implementation:

1. Fetch the build
2. Look for top-level instances by label (`Dialog`, `Sheet`, `Mobile nav`,
   `Animation CSS` …)
3. Tree-walk descendants
4. Emit `op:remove` patches for everything found
5. Re-fetch the build for its new version
6. Push the new fragment

---

## Tabs (use Radix natively)

Webstudio exposes `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`. Use these
rather than custom HTML/CSS — they handle keyboard nav, ARIA, and active
state for free.

```
Tabs (defaultValue="0")
├── TabsList
│   ├── TabsTrigger (value="0")
│   ├── TabsTrigger (value="1")
│   └── TabsTrigger (value="2")
├── TabsContent (value="0")
├── TabsContent (value="1")
└── TabsContent (value="2")
```

`TabsTrigger` and `TabsContent` declare `indexWithinAncestor: Tabs`, so when
`value` is omitted the index in the parent is used. A list of three triggers
plus three contents in declaration order works without explicit values.

States exposed: `[data-state="active"]`, `[data-state="inactive"]`.

---

## Disclosure (`<details>` / `<summary>`)

Lighter alternative to Radix `Accordion` when full keyboard semantics and
animation aren't needed. Pure HTML, no JS.

```
ws:element  tag="details"
├── ws:element  tag="summary"
│   └── (title content)
└── (revealed content)
```

The element exposes the `[open]` attribute selector, which is enough to
animate or rotate a chevron.

---

## CSS variable scope: `:root` vs body

Webstudio exposes two scope levels for variables:

| Scope | Component | Id | Reach |
|---|---|---|---|
| Global root | `ws:root` | `:root` (constant) | Every page |
| Page root | `ws:element` (body) | `<rootInstanceId>` | One page |

The `:root` instance does not appear in `build.instances` — Webstudio
synthesizes it. You can still attach `styleSourceSelections` to it with
`path: [":root"]`.

### Single-brand sites

Put everything on `:root`. One layer of cascade, easy to reason about. No
intermediate "Theme" token needed.

```
:root
├── --color-bg-page
├── --color-text-primary
├── --font-family-primary
└── …
```

### Multi-brand sites (e.g. multi-marque dealer)

Corporate identity on `:root`, per-brand overrides on the per-page body:

```
:root                           # corporate / shared
├── --color-brand-primary
├── --color-header-bg
└── …

body of /pages/acme/*         # Acme theme
├── --color-bg-page
└── …

body of /pages/brand-b/*         # Brand B theme
└── …
```

Cascade does the right thing — the brand layer overrides corporate where
they collide.

For purely page-scoped tokens, a token style source attached to the body
of each page works. For ad-hoc per-page overrides, a local style source on
the body is simpler.
