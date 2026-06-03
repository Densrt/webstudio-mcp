---
name: Background image + overlay direct on element (no nested divs)
description: For any element (section, card, banner, header) that must display a background image with an overlay (gradient or solid color), put everything in `backgroundImage: layers` directly on the element. Never a nested structure with an absolute div for the image and the overlay.
category: component
complexity: simple
lastUpdated: 2026-05-20
recommendedTool: build.push_fragment + styles.update
recommendedToolNote: set backgroundImage:{type:'layers',value:[gradient,image]} on the element itself — NOT nested absolute divs
---

# Background image + overlay — direct on the element, no nested div

## When to use it

Applies to **any element** that must display a background image with an overlay:

- Full-screen hero section
- Card with image + text on top (categories, products, articles)
- Banner / call-to-action with a background photo
- Header with a bg image
- Modal / overlay with a background photo
- Button with a bg image
- Etc.

This is NOT specific to a single component type. It's a universal CSS convention that applies everywhere you have "image + overlay".

## Anti-pattern (to avoid)

Nested structure + `position: absolute`:

```
<section>
  <div class="bg" position:absolute inset:0>      ← needless
    <img position:absolute w:100% h:100% cover/>   ← needless
    <div class="overlay" position:absolute inset:0 background:rgba(0,0,0,0.5)/>  ← needless
  </div>
  <div class="content" position:relative>          ← position:relative forced by the absolute bg → needless too
    ...
  </div>
</section>
```

Problems:
- 3 extra instances in the tree
- `position: absolute` everywhere → complex z-index cascade + forced `position: relative` on the content wrapper
- The overflow/inset/etc. styles on each nested div = noise
- A separate `<img>` when you can just use `background-image`, which is exactly made for this
- In CSS, the overlay forms a layer separate from the main DOM → less performant and harder to animate

## Best practice (to reproduce)

The image + the overlay go **directly into `backgroundImage` on the element**, using the CSS multilayer format (overlay in front of the image):

```
<section bg-image:[overlay, url(...)] bg-size:cover bg-position:center>
  <div class="content">
    ...
  </div>
</section>
```

Webstudio handles this via the `{type:"layers", value:[...]}` value, which translates to multi-layer CSS. **No nested absolute div.**

## Webstudio JSON format

```json
{
  "instanceId": "hero_root",
  "property": "backgroundImage",
  "value": {
    "type": "layers",
    "value": [
      {
        "type": "unparsed",
        "value": "linear-gradient(transparent 0%, var(--brand-color-black-opacity-5) 100%)"
      },
      {
        "type": "image",
        "value": {
          "type": "url",
          "url": "https://cdn.example.com/hero.webp"
        }
      }
    ]
  }
}
```

Also remember to push:

```json
{ "property": "backgroundSize",     "value": { "type": "keyword", "value": "cover" } }
{ "property": "backgroundPositionX", "value": { "type": "unit", "value": 50, "unit": "%" } }
{ "property": "backgroundPositionY", "value": { "type": "unit", "value": 50, "unit": "%" } }
{ "property": "overflowX",          "value": { "type": "keyword", "value": "hidden" } }
{ "property": "overflowY",          "value": { "type": "keyword", "value": "hidden" } }
```

Note: Webstudio automatically converts `backgroundSize` and `backgroundPositionX/Y` to `type:"layers"` on the server side (1 entry per layer of the `backgroundImage`). This is normal — no need to push these props as `layers` on the client side.

## Layer order (important)

In the `value` array of the `backgroundImage`, **the first layer is IN FRONT, the last is BEHIND**. So:

```
[
  overlay,   ← rendu PAR-DESSUS l'image
  image      ← rendu AU FOND
]
```

If the overlay is placed second, it will be hidden behind the image — a classic visual bug.

## CSS format of the gradient overlay

Always use:

1. **CSS Color L4 syntax**: `rgb(R G B / A)` (and not legacy `rgba(R, G, B, A)`). This is what the Webstudio UI parses correctly to display the layers in the Background panel.

2. **Explicit stops** `0%` and `100%`. Without stops, the Webstudio UI may not parse the gradient as a recognizable layer and it becomes uneditable.

3. **Project CSS vars** in `var(...)` when a design system color does the job — stays DRY if the palette changes.

### Case 1: uniform overlay (flat darkening)

```css
linear-gradient(var(--brand-color-black-opacity-30) 0%, var(--brand-color-black-opacity-30) 100%)
```

Both stops have the same color → flat darkening effect. Valid alternative: use `backgroundColor` directly (a color with alpha) — but this does NOT work if you already have a background image, because `backgroundColor` is rendered BEHIND `backgroundImage` (not in front). So for an overlay on an image, the `linear-gradient` remains the canonical solution.

### Case 2: artistic gradient (fade to the bottom)

```css
linear-gradient(transparent 0%, var(--brand-color-black-opacity-5) 100%)
```

Vignette effect / anchoring the text content at the bottom. Generally more elegant than a flat overlay.

### Case 3: tinted gradient (brand effect)

```css
linear-gradient(rgb(224 33 122 / 0.05) 0%, rgb(0 0 0 / 0.05) 100%)
```

Very subtle magenta pink at the top → black 5% at the bottom. Adds depth without darkening the visual content too much.

## When to use what

| Need | Solution |
|---|---|
| Strong flat darkening overlay | `linear-gradient(rgb(0 0 0 / 0.5), rgb(0 0 0 / 0.5))` |
| Subtle overlay for text readability | `linear-gradient(transparent, var(--brand-color-black-opacity-20))` |
| Artistic / brand effect | `linear-gradient(rgb(R G B / 0.1) 0%, var(--brand-color-secondary-200) 100%)` |
| No overlay, just the image | A single layer `[{type:"image",...}]` |
| No image, just a colored background | `backgroundColor` directly (without `backgroundImage` layers) |

## Full example — hero section

```js
// 1 single element. No nested div for the bg.
{
  instanceId: "hero_root",
  styles: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    height: "40vh",
    paddingTop: "var(--brand-space-2xl)",
    paddingBottom: "var(--brand-space-2xl)",
    overflowX: "hidden",
    overflowY: "hidden",
    backgroundImage: {
      type: "layers",
      value: [
        {
          type: "unparsed",
          value: "linear-gradient(transparent 0%, var(--brand-color-black-opacity-5) 100%)"
        },
        {
          type: "image",
          value: {
            type: "url",
            url: "https://cdn.example.com/hero.webp"
          }
        }
      ]
    },
    backgroundSize: "cover",
    backgroundPositionX: "50%",
    backgroundPositionY: "50%"
  }
}
```

## Full example — card with image + overlay

```js
{
  instanceId: "card_motos",
  styles: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    aspectRatio: "4/5",
    padding: "var(--brand-space-l)",
    borderRadius: "var(--brand-radius-m)",
    overflow: "hidden",
    color: "var(--brand-color-primary-white)",
    backgroundImage: {
      type: "layers",
      value: [
        {
          type: "unparsed",
          value: "linear-gradient(transparent 0%, var(--brand-color-black-opacity-60) 100%)"
        },
        {
          type: "image",
          value: { type: "url", url: "https://cdn.example.com/motos.webp" }
        }
      ]
    },
    backgroundSize: "cover",
    backgroundPositionX: "50%",
    backgroundPositionY: "50%"
  }
}
// → A single instance. No nested div. The content (h3, p, CTA) is a direct child of the card.
```

## Why this pattern?

- **Fewer instances** = lighter build + faster Webstudio canvas
- **No `position: absolute / relative` cascade** to manage → fewer overflow, z-index, animation bugs
- **Easier UI editing**: the Webstudio UI Background panel shows the 2 layers (gradient + image) with dedicated controls for each (toggle hidden, blend-mode, position, size per layer)
- **Modern standard CSS**: multilayer `background-image` has existed since CSS3 (2011) and is widely supported
- **Consistency**: whether it's a hero, a card, or a banner — the convention is the same everywhere

## Anti-pattern: why the nested absolute div spread

It typically comes from:
1. **Naive Figma → code translation**: Figma represents "image" and "overlay" as 2 visually separate layers. The naive translation creates 2 distinct divs.
2. **Old legacy code**: before CSS3, some browsers handled multilayer `background-image` poorly.
3. **Outdated pattern docs**: some tutorials / agency patterns still suggest this structure.

→ Every time you see a fragment proposing the nested absolute structure, **rewrite it**.

## Reference

Convention adopted 2026-05-20 on the `<template-project>` project. The template's hero was refactored from the nested version to the inline version (4 instances removed: `hero_bg`, `hero_img`, `hero_overlay`, `hero_content`). The Categories section cards still suffer from the problem — to be refactored.

## Single pattern for all cases

This pattern is **GENERIC**, not specific to the hero. If you search for "how to build a hero", you land here. If you search for "card with image", you also land here. **1 single rule to remember** for all elements with a bg image + overlay.
