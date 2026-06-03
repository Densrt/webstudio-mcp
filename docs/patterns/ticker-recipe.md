---
name: Ticker pattern (infinite CSS marquee) in Webstudio
description: Full recipe for building an infinite horizontal ticker / scrolling banner (partner logos, testimonials, etc.) in pure CSS in Webstudio via a single HtmlEmbed. Validated on a single-brand project 2026-05-09.
category: workflow
complexity: medium
lastUpdated: 2026-05-20
recommendedTool: build.push_fragment
recommendedToolNote: use a single HtmlEmbed with CSS marquee keyframes
---

# Ticker / CSS Marquee — full recipe

**Context**: to scroll a banner of partner logos (or testimonials, news, etc.) in an infinite horizontal loop, use a pure CSS marquee (no JS) injected as **a single HtmlEmbed**. Lighter than a Swiper, simpler than a manual scroll-snap, ideal for non-interactive cases.

**Difference from a scroll-snap carousel**:
- **Ticker** = automatic scroll, infinite, **non-interactive** (the user has no control)
- **Carousel** = arrow/swipe navigation, paginated, interactive

## Architecture (1 single inline HtmlEmbed)

```
HtmlEmbed (label "Partners ticker")
  └─ <style> ... </style>
  └─ <div class="skl-tk" role="region" aria-label="..."> [position: relative, fixed height, overflow: hidden]
        └─ <div class="skl-tk-track"> [position: absolute, width: max-content, animation]
              ├─ <a class="skl-tk-logo" aria-label="..." href="..." target="_blank"> SVG/img </a> × N
              └─ <span class="skl-tk-logo" aria-hidden="true"> SVG/img </span> × N (DUPLICATE for loop)
```

## CSS template (to adapt per project)

```css
/* ⚠️ Prefix the classes with the project's short slug (`skl-` here = the project's short name) to avoid collisions */
.skl-tk {
  position: relative;          /* ← container of the absolute track */
  display: block;
  width: 100%;
  max-width: 100%;             /* ← overflow guard 1 */
  min-width: 0;                /* ← overflow guard 2 (key flexbox fix) */
  height: 60px;                /* ← mandatory because the track is absolute */
  overflow: hidden;            /* ← clip the overflowing track */
  /* fade gradient on the edges (nice-to-have, optional) */
  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 64px, #000 calc(100% - 64px), transparent 100%);
  mask-image: linear-gradient(to right, transparent 0, #000 64px, #000 calc(100% - 64px), transparent 100%);
}
.skl-tk-track {
  position: absolute;          /* ← CRUCIAL: out of the flow → does not push the parent's width */
  top: 0; left: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 80px;                   /* spacing between logos */
  width: max-content;          /* the track spans the width of all the logos */
  animation: skl-tk-scroll 30s linear infinite;
}
.skl-tk-track:hover { animation-play-state: paused; }   /* pause on hover */
.skl-tk-logo {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 40px;                /* uniform height for all logos */
  text-decoration: none;
}
.skl-tk-logo svg { height: 40px; width: auto; display: block; }
.skl-tk-logo img { height: 40px; width: auto; object-fit: contain; display: block; }

@keyframes skl-tk-scroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }   /* -50% because content duplicated 2× */
}
@media (prefers-reduced-motion: reduce) {
  .skl-tk-track { animation: none; }     /* accessibility consideration */
}
```

## Pitfall #1: `width: max-content` + `display: flex` = scroll-x on the whole page

**Symptom**: a horizontal scroll appears on the page after adding the ticker.

**Why**: the cascade of intrinsic widths of the `flex` track with `width: max-content` propagates the width all the way to the viewport. Since the track is often 1500-3000px (sum of logos × 2), it pushes everything.

**Anti-pattern**:
```css
/* ❌ DOES NOT WORK with a flexbox parent */
.skl-tk { width: 100%; overflow: hidden; }
.skl-tk-track { display: flex; width: max-content; }
```

**Solution that works**:
- **`position: absolute`** on the track → out of the flow → does not participate in the parent's width calculation
- **Fixed height** on the wrapper (mandatory, since absolute children give it no height)
- **`min-width: 0`** on the wrapper (key flexbox fix: defaults to `min-width: auto`, which takes the intrinsic width)

```css
/* ✅ ROBUSTE */
.skl-tk { position: relative; width: 100%; min-width: 0; height: 60px; overflow: hidden; }
.skl-tk-track { position: absolute; top: 0; left: 0; height: 100%; display: flex; width: max-content; }
```

## Pitfall #2: HTML duplication mandatory for a jump-free loop

The translate animation from `0` to `-50%` only works **if the content is duplicated exactly 2×**. Otherwise the end of the list appears halfway through → visual jump.

### Correct pattern for the duplicates (clickable + accessible)

```html
<div class="skl-tk-track">
  <!-- N unique logos: clickable, aria-label visible to screen readers -->
  <a href="..." aria-label="Embarq" target="_blank" rel="noopener">SVG</a>
  <a href="..." aria-label="Provigis" target="_blank" rel="noopener">SVG</a>
  <!-- ... -->
  <!-- N duplicated logos: ALSO clickable, but hidden from screen readers and not focusable -->
  <a href="..." aria-hidden="true" tabindex="-1" target="_blank" rel="noopener">SVG</a>
  <a href="..." aria-hidden="true" tabindex="-1" target="_blank" rel="noopener">SVG</a>
  <!-- ... -->
</div>
```

**Why clickable on the duplicates**: if the user clicks a logo during the second half of the loop (the duplicate), they expect it to open the site. Leaving the duplicates as non-clickable `<span>` breaks the UX.

**Why `aria-hidden="true"` + `tabindex="-1"`**:
- `aria-hidden="true"` → the screen reader reads only the first half (no auditory redundancy)
- `tabindex="-1"` → the Tab key skips over the duplicates (no keyboard redundancy)
- ✓ Clickable with the mouse (not affected by the two attributes above)

### Anti-pattern to avoid

❌ `<span aria-hidden="true">` on the duplicates: non-clickable → broken mouse UX during the second half of the loop.

## Pitfall #3: update_styles does not work on an HtmlEmbed without a styleSource

**Symptom**: `webstudio_update_styles` returns "no styleSource (instance probably has no styles)" on the HtmlEmbed.

**Why**: the HtmlEmbed pushed via `webstudio_push_fragment` has no local styleSource by default.

**Solution**: edit the CSS directly in the HtmlEmbed's HTML (recommended), or create a styleSource during the initial push.

## Pitfall #4: Breakpoint label is case-sensitive

The labels in Webstudio builds are internally **capitalized**: `Base`, `Tablet`, `Mobile landscape`, `Mobile portrait`. The `update_styles` tool's default `"base"` (lowercase) does not match → "breakpoint not found". Always pass the exact label via the `breakpoint` param.

## To push via MCP (workflow)

1. Prepare the full HTML (CSS + structure + inline SVG/img) in a file
2. **Unbind the source framework classes** (e.g. remove `style_logo__Ekr0u` coming from Next.js modules)
3. Wrap each logo in an `<a aria-label target=_blank rel=noopener>` (clickable + accessible)
4. Duplicate the logo array with `aria-hidden="true"` on the second half
5. Push via:
   - `webstudio_push_fragment` with a single `HtmlEmbed` + prop `code` = the HTML
   - parent = a container that already has `overflow-x: hidden` (safety)

**If the HTML is > 30 KB**, go through a Node script that reuses `fetchBuild` + `applyTransaction` to avoid issues transmitting large payloads over MCP.

## Variants / extensions

- **Reverse ticker**: `to { transform: translateX(50%); }` + add `animation-direction: reverse` or `transform: translateX(-50%) → 0`
- **Vertical ticker**: `flex-direction: column`, `width: 100%`, `height: max-content`, `transform: translateY()` instead of X
- **Multiple speeds**: expose `--skl-tk-duration: 30s` as a custom property and use it in `animation`
- **Uniform colors**: set all SVGs to `fill="currentColor"` and set `color` via the wrapper

## Recommended global safety net

On the **page's rootInstanceId** (or body):
```css
{ overflow-x: hidden; max-width: 100vw; }
```

Prevents any future overflow caused by any component (ticker, carousel, oversized image, etc.). See `pattern_carousel_scroll_snap.md` for the same principle.

## Implementation reference

- **Implementation reference**: ad-hoc scripts in `/tmp/` at build time (`fetchBuild` + `applyTransaction` variant), not kept in the repo.
- **Validated project**: a single-brand project, partner ticker section, version 4154 (internal reference).
