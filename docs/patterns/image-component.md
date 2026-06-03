---
name: Image — native component, src accepts asset | URL string | expression
description: How to insert an image (photo, visuel, vignette) with the native Webstudio Image component. Corrects the myth that src must be an asset — a plain URL string and a collection expression both render. Cas réel — migration <img> → Image sur un build single-brand, 2026-06.
category: component
complexity: simple
lastUpdated: 2026-06-03
recommendedTool: build.push_fragment
recommendedToolNote: native Image component, short id "Image" — src accepts asset | URL string | expression (NOT asset-only)
---

# Image — native component pattern

## Rule

Insert images with the native Webstudio **`Image`** component, using the **short id `"Image"`** — never the namespaced `@webstudio-is/sdk-components-react:Image` (that string is not a registered component id and renders an error box at runtime).

`Image.src` accepts **three** value forms:

- **asset** — `{ type: "asset", value: "<assetId>" }` → full Webstudio optimization (srcset, lazy, asset-bound dimensions).
- **URL string** — a plain `"https://cdn…/photo.webp"` → renders directly (external CDN, etc.). No asset pipeline, but it works.
- **expression** — a collection / variable binding (e.g. a CMS `ws:collection` item field) → renders the resolved URL at runtime.

You do **not** need `ws:element tag="img"` to use a URL.

## Why (ground truth)

Webstudio `packages/sdk-components-react/src/image.ws.ts` declares:

```
src:    { type: "string", control: "file", accept: "image/*" }
width:  { type: "number" }
height: { type: "number" }
alt:    { type: "string" }
```

The `"file"` control is only the builder's asset-picker UI; the **stored prop value is a string**. So a URL string and an expression are valid `src` values. The long-standing note that "src must be an asset, otherwise nothing renders" was wrong and pushed callers toward `ws:element tag="img"` for no reason.

## Supported props

| Prop | Type | Notes |
|---|---|---|
| `src` | string \| asset \| expression | Required to display. Asset id = optimization; URL string / expression also render. |
| `alt` | string | Accessibility + SEO. Always set it. |
| `width` | number | Intrinsic width (px). Helps avoid CLS. |
| `height` | number | Intrinsic height (px). Helps avoid CLS. |
| `loading` | string | `"eager"` for the hero / LCP image, `"lazy"` below the fold. |
| `optimize` | boolean | Webstudio image optimization (effective with asset sources). |

## Example — URL string (external CDN)

`build.push_fragment` shape: instances + a separate props array keyed by `instanceId`.

```json
{
  "instances": [
    { "id": "heroImg", "component": "Image", "label": "Hero photo", "children": [] }
  ],
  "props": [
    { "instanceId": "heroImg", "name": "src", "type": "string", "value": "https://cdn.example.com/visuel-hero.webp" },
    { "instanceId": "heroImg", "name": "alt", "type": "string", "value": "Vue avant du modèle" },
    { "instanceId": "heroImg", "name": "loading", "type": "string", "value": "eager" }
  ]
}
```

## Example — expression (collection binding)

Inside a `ws:collection` item, bind `src` to the item field instead of a literal (exact expression syntax: see pattern `ws-collection-bindings`):

```json
{ "instanceId": "cardImg", "name": "src", "type": "expression", "value": "$ws$dataSource$<itemVarId>.image_url" }
```

## Example — asset (optimized)

```json
{ "instanceId": "heroImg", "name": "src", "type": "asset", "value": "<assetId-sha256>" }
```

Use this when the image is uploaded to the project (gets srcset + lazy + native dims).

## Anti-patterns (DO NOT)

- ❌ `component: "@webstudio-is/sdk-components-react:Image"` — native `sdk-components-react` components use the **short** id (`"Image"`). The namespaced form renders "Component … does not exist". Only **Radix** components are namespaced (`@webstudio-is/sdk-components-react-radix:Dialog`).
- ❌ Reaching for `ws:element` + `tag: "img"` just to use a URL — not needed; `Image` takes a URL string. Use a raw `ws:element img` only when you explicitly want an unoptimized `<img>`.

## Verified on

- Webstudio source `image.ws.ts` (`src: type "string"`).
- Production migration `<img>` → `Image` with CDN URL strings + CMS collection expressions (single-brand project, 2026-06).
