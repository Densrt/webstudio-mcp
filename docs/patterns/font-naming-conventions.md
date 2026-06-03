---
name: Font Naming Conventions for Webstudio Cloud
description: Webstudio's parseSubfamily bug — an italic file with no weight keyword in the subfamily (ID 2/17) is assigned font-weight 900 instead of 400. Safe convention to avoid it.
category: component
complexity: simple
lastUpdated: 2026-05-20
recommendedTool: assets.upload
recommendedToolNote: parseSubfamily bug: italic without weight keyword in subfamily → font-weight 900 instead of 400
---

# Font Naming Conventions for Webstudio Cloud

When you upload a font file (TTF/WOFF/WOFF2) to Webstudio Cloud, **always include an explicit weight keyword in the subfamily** (OpenType name table IDs 2 and 17). Otherwise, a bug in Webstudio's `parseSubfamily()` assigns weight `900` instead of `400` to the generated @font-face.

## The bug

Webstudio derives the @font-face `font-weight` by reading the file's subfamily string. The code:

```js
// packages/asset-uploader/src/utils/font-data.ts (webstudio-is/webstudio)
let weight: FontWeight = "400";
for (weight in fontWeights) {        // iterates over "100", "200", …, "900"
  const { names } = fontWeights[weight];
  if (names.some((name) => subfamilyLow.includes(name))) {
    break;                            // exits on the 1st match
  }
}
return { style, weight: Number(weight) };
```

If the subfamily is just `"Italic"` (without `light`, `regular`, `medium`, `bold`, etc.), no keyword matches. The `for…in` loop ends, and **`weight` keeps the value of the last iteration = `"900"`** — not the `"400"` default. The initial default is never used in practice.

## Symptoms

- `font-weight: 400 + italic` renders **bolder than expected** — the browser finds no @font-face matching 400 italic and falls back to a synthetic Medium 500 or Bold 700.
- `font-weight: 900` renders **paradoxically the thin italic weight** — it's the @font-face mislabeled as 900 that actually contains the Italic 400 file.
- The `audit_fonts` audit shows `(+1 unparseable)` in the list of uploaded weights.

## Safe subfamily values

| Variant | OS/2 weight class | Subfamily (table ID 2/17) | Avoid |
|---|---|---|---|
| Thin Italic | 100 | `"Thin Italic"` | `"Italic"` alone |
| Extra Light Italic | 200 | `"Extra Light Italic"` | `"Italic"` alone |
| Light Italic | 300 | `"Light Italic"` | — |
| **Regular Italic** | **400** | **`"Regular Italic"`** | **`"Italic"` (triggers the bug)** |
| Medium Italic | 500 | `"Medium Italic"` | — |
| Semi Bold Italic | 600 | `"Semi Bold Italic"` | — |
| Bold Italic | 700 | `"Bold Italic"` | — |
| Extra Bold Italic | 800 | `"Extra Bold Italic"` | — |
| Black Italic | 900 | `"Black Italic"` | — |

Same for `Oblique` instead of `Italic`.

## Filename convention (Webstudio UI family slug)

In addition to the subfamily, Webstudio also derives a **family slug** from the **filename** for UI grouping. Compound filenames with no separator between words end up isolated in their own family:

| Filename | Family slug | UI result |
|---|---|---|
| `Font-Bold.woff2` | `font` | Grouped with the main family ✓ |
| `Font-BoldItalic.woff2` | `font-bolditalic` | **Separate family** ❌ |
| `Font-Bold-Italic.woff2` | `font` | Grouped ✓ |

**Rule**: use a separator (`-` or `_`) between each style word (`Bold-Italic`, `Regular-Italic`), never joined (`BoldItalic`).

## Fix recipe — patch a file already delivered by the foundry

If the foundry delivered a file with an incorrect subfamily, you can patch the name table without re-editing the file in a type design suite. With Python + fontTools:

```python
from fontTools.ttLib import TTFont

font = TTFont("MyFont-Italic.woff2")
name = font["name"]
PLATFORMS = [(3, 1, 0x409), (1, 0, 0)]

for plat, enc, lang in PLATFORMS:
    # name ID 2  = legacy Subfamily       (Windows compat)
    # name ID 17 = typographic Subfamily  (modern OpenType, preferred)
    name.setName("Regular Italic", 2,  plat, enc, lang)
    name.setName("Regular Italic", 17, plat, enc, lang)
    # name ID 4 = Full Font Name (cosmetic, but stay consistent)
    name.setName("My Font Regular Italic", 4, plat, enc, lang)

font.save("MyFont-Regular-Italic.woff2")
```

Then re-upload the corrected file. Webstudio re-extracts the subfamily on upload and generates a @font-face with `font-weight: 400`.

## Automatic detection

The MCP audit `webstudio_audit_fonts` detects this pattern and flags the affected files in the `🐛 parseSubfamily Webstudio bug` section. If the audit stays green, you're safe.

## Reference incident

- **Date**: 2026-05-20
- **Project**: `<template-project>`
- **Family**: `Supreme LL TT` (custom non-Google foundry)
- **Initial symptom**: 6 font files uploaded, but the Italic 400 button rendered visibly bolder than on the source WordPress (which uses the same typeface).
- **Ruled out**: WOFF2 conversion, latin subset, CFF vs TT format, hinting, OS/2 weight class — all fine on the file side.
- **Actual bug**: Webstudio's `parseSubfamily()` assigned `weight: 900` to the Italic @font-face (subfamily = `"Italic"` alone → no weight keyword → loop ends at 900).
- **Fix**: renamed the name table to `"Regular Italic"` + filename `SupremeLLTT-Regular-Italic.woff2`. The word `"regular"` matches → weight 400 → correct rendering.

## Webstudio source reference

- Parser: [`packages/asset-uploader/src/utils/font-data.ts`](https://github.com/webstudio-is/webstudio/blob/main/packages/asset-uploader/src/utils/font-data.ts) (`parseSubfamily`)
- List of recognized weights: [`packages/fonts/src/font-weights.ts`](https://github.com/webstudio-is/webstudio/blob/main/packages/fonts/src/font-weights.ts) (`fontWeights`)
- @font-face generation: [`packages/fonts/src/get-font-faces.ts`](https://github.com/webstudio-is/webstudio/blob/main/packages/fonts/src/get-font-faces.ts) (`getFontFaces`)
