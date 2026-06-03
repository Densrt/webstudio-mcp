---
name: Real WebstudioFragment format (captured via copy from the builder)
description: Exact JSON format Webstudio expects on a Cmd+V into the canvas. Captured by copying a section from the builder on a single-brand project on 2026-05-08.
category: workflow
complexity: medium
lastUpdated: 2026-05-20
recommendedTool: (reference)
recommendedToolNote: JSON format captured via copy from the builder
---

# Real Webstudio paste format — critical findings

**Source**: copy from the Webstudio builder of an existing Hero section on a single-brand project, captured 2026-05-08.

## Mistakes in our v1 (which pasted text into a `<p>`)

| Our v1 (wrong) | Real Webstudio format |
|---|---|
| No wrapper | `{"@webstudio/instance/v0.1": {...}}` at the top level |
| `styleSources_selections` | `styleSourceSelections` (camelCase, no underscore) |
| `component: "Box"`, `"Heading"`, `"Paragraph"`, `"Button"` | `component: "ws:element"` + `tag: "section"`, `"h1"`, `"p"`, `"a"`, `"button"` |
| String breakpoint IDs `"base"`, `"tablet"` | nanoid breakpoint IDs (e.g. `"d8JZk7ikUb4e_c76sG8us"`) |
| No `instanceSelector` | `instanceSelector: [rootId, ...]` (selection path at copy time) |

## Full structure of the real format

```json
{
  "@webstudio/instance/v0.1": {
    "instanceSelector": ["root-id", "ancestor-id", "deeper-id"],
    "children": [{"type": "id", "value": "root-id"}],
    "instances": [
      {"type": "instance", "id": "...", "component": "ws:element", "tag": "section", "label": "...", "children": [...]},
      {"type": "instance", "id": "...", "component": "HtmlEmbed", "children": []},
      ...
    ],
    "styleSourceSelections": [
      {"instanceId": "...", "values": ["styleSourceId1", "styleSourceId2"]}
    ],
    "styleSources": [
      {"type": "local", "id": "..."},
      {"type": "token", "id": "...", "name": "Primary Button"}
    ],
    "breakpoints": [
      {"id": "<nanoid>", "label": "Base"},
      {"id": "<nanoid>", "label": "Mobile portrait", "maxWidth": 479}
    ],
    "styles": [
      {"styleSourceId": "...", "breakpointId": "<nanoid>", "property": "...", "value": {...}, "state"?: ":hover"}
    ],
    "dataSources": [],
    "resources": [],
    "props": [
      {"id": "...", "instanceId": "...", "name": "code", "type": "string", "value": "..."},
      {"id": "...", "instanceId": "...", "name": "data-ws-show", "type": "boolean", "value": true}
    ],
    "assets": [
      {"id": "<asset-hash>", "name": "...", "projectId": "...", "size": 21112, "type": "image", "format": "webp", "createdAt": "...", "meta": {"width": 410, "height": 273}}
    ]
  }
}
```

## Component mapping: our names → ws:element + tag

| Our name | Webstudio component | HTML tag |
|---|---|---|
| Box | `ws:element` | `div` (default) or override (section, header, nav, etc.) |
| Heading | `ws:element` | `h1` to `h6` (passed via options.tag) |
| Paragraph | `ws:element` | `p` |
| Button | `ws:element` | `button` or `a` (if it is a link) |
| Link | `ws:element` | `a` |
| HtmlEmbed | `HtmlEmbed` | (no tag — special component) |
| **Image** | **`Image`** | (no tag — native Webstudio React component) |

Webstudio "special" components that are NOT `ws:element` (pass-through in the builder):
- `HtmlEmbed`
- `Image` ⚠️ **NEW since 2026-05-13** — previously we mapped `Image` → `ws:element + tag=img`, but that was a raw `<img>` with no srcset/lazy/asset-bound dims. Bug caught in review (the `audit-images` audit filtered on `component === "Image"` and missed all of our creations). Fix: `Image` removed from `COMPONENT_TO_TAG`, switched to pass-through → real native React component.
- `Form`, `Input`, `Textarea`, `Select` (not in `COMPONENT_TO_TAG`, already pass-through)
- `YouTube`, `Vimeo` (not in `COMPONENT_TO_TAG`, already pass-through)

**Consequence for callers of `addInstance("Image", ...)`**:
- `src` accepts **`asset` | `string` (URL) | `expression`**. Ground truth: Webstudio `packages/sdk-components-react/src/image.ws.ts` declares `src: { type: "string", control: "file" }` — the `"file"` control is only the builder's asset-picker affordance; the stored value is a string. An **asset** id adds the optimization pipeline (srcset, lazy, asset-bound dims); a plain **URL string** and a collection **expression** binding both render fine. (The old "must be asset, otherwise renders nothing" claim was wrong.)
- `width` / `height` are `type: "number"` (can also bind to an asset's native dimensions).
- `ws:element` + `tag: "img"` is only for a deliberately raw, unoptimized `<img>` — it is NOT required for URL sources. Prefer the `Image` component. See pattern `image-component`.

Patterns in `src/components/` updated accordingly:
- `cards.ts`: detects whether `imageSrc` is a URL or an asset id, picks the right component
- `swiper.ts`: uses `ws:element + img` (slides receive URLs)

## Observed StyleValue types

In addition to what we already had (`unit`, `keyword`, `color`, `var`, `unparsed`), I saw:

- **`fontFamily`**: `{type: "fontFamily", value: ["Cascadia Code", "monospace"]}`
- **extended `color`**: `{type: "color", colorSpace: "hex", components: [r, g, b], alpha: n}` (components 0→1)
- **`layers`**: `{type: "layers", value: [layer1, layer2, layer3]}` — for `backgroundImage`, `transitionProperty`, `transitionDuration`, etc. Used when the property accepts multiple comma-separated values.
- **`image`**: `{type: "image", value: {type: "asset", value: "<asset-hash>"}}` — reference to an uploaded asset.
- **`unit`** with `unit: "number"` for unitless values (lineHeight, fontWeight, opacity)

## Expanded CSS properties (CRITICAL)

Webstudio does NOT use CSS shorthands. If you send a shorthand, it accepts it on paste but displays it in RED (invalid) in the styles panel. They must be expanded:

- ✅ `overflow: hidden` is OK (Webstudio handles it natively). The red display on children at paste time was a Webstudio display bug with no functional impact.
- ✅ `gap: 24px` is OK too (handled natively)

- ❌ `border: "1px solid black"` 
- ✅ `borderTopWidth/RightWidth/BottomWidth/LeftWidth` + 
     `borderTopStyle/RightStyle/BottomStyle/LeftStyle` +
     `borderTopColor/RightColor/BottomColor/LeftColor`

- ❌ `borderWidth: "2px"` (uniform shorthand)
- ✅ 4× `borderXxxWidth: 2px`

- ❌ `borderRadius: "8px"`
- ✅ `borderTopLeftRadius`, `borderTopRightRadius`, `borderBottomRightRadius`, `borderBottomLeftRadius`

- ❌ `transition: "opacity 0.2s ease"`  
- ✅ `transitionProperty` + `transitionDuration` + `transitionTimingFunction` + `transitionDelay` + `transitionBehavior` (all as `{type: "layers", value: [...]}`)

- ❌ `padding: "10px 20px"` (and even uniform `padding: 10px`)
- ✅ `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`

- ❌ `margin` → ✅ `marginTop/Right/Bottom/Left`
- ❌ `gap` → ✅ `rowGap` + `columnGap`
- ❌ `background` (combo) → ✅ separate `backgroundColor`, `backgroundImage`, `backgroundSize`, etc.
- ❌ `background-position` → ✅ `backgroundPositionX` + `backgroundPositionY`

**Solution in the builder**: the `addStyles()` function automatically expands the known shorthands via `expandShorthand()` (see `src/builder.ts`). Always use `addStyles()` rather than `addStyle()` directly to benefit from the expansion.

## StyleSource type "token"

For named design tokens (CSS variables), the type is `"token"` with a `name`:

```json
{"type": "token", "id": "<nanoid>", "name": "Primary Button"}
```

And in the styles, you reference them via:
```json
{"value": {"type": "var", "value": "<brand>-color-primary-red"}}
```

Note: the `var` value is the token NAME, not its ID.

## Observed props

- `data-ws-show` (boolean): instance visibility — appears to be required/default on some instances
- `code` (string): HTML content for HtmlEmbed
- `href` with `type: "page"`: link to an internal page (value = page ID)
- `src`, `alt`: for images

## HtmlEmbed — SVG rules (CONFIRMED 2026-05-08)

**Observed bug**: Webstudio silently drops the `code` prop on paste if the SVG contains certain combinations of elements. Confirmed on:
- ✅ SVG with **a single `<path>`** (even a complex one with multiple M/L/Z segments) → OK
- ❌ SVG with `<path>` + `<circle>` → the `code` prop arrives EMPTY in Webstudio (at paste time, not render)

The rejection is silent (no error message). The string is probably passed to an HTML sanitizer that whitelists only certain SVG elements.

**Safe convention for generating SVG icons in `HtmlEmbed`**:
- Always **a single graphic element** (`<path>` only, or a `<g>` containing `<path>` elements)
- For simple shapes (circle, rectangle), use a `<path>` that draws the shape:
  - Circle: `M12,12 m-4,0 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0`
  - Rectangle: `M2,2 L22,2 L22,22 L2,22 Z`
- If the supplied SVG has multiple elements, simplify it before passing it to `HtmlEmbed`

**Workaround if a complex SVG is really required**: create the HtmlEmbed instance via paste (without the code), then paste the SVG manually into the Code field of the Settings panel. This works because that path uses a direct setter, not the paste validator.

## instanceSelector

Array of IDs representing the path from the root down to the element selected AT copy time. For a fragment we push, we can probably set just `[rootInstanceId]` or even the path from the root to the fragment's first child.

## Action for our builder

1. Add the `@webstudio/instance/v0.1` wrapper
2. Rename the `styleSources_selections` key → `styleSourceSelections`
3. Map Box/Heading/Paragraph/Button/Image/Link → ws:element + tag
4. Generate breakpoint IDs as nanoid (with a "base"/"tablet"/etc → ID map)
5. Add `instanceSelector` (at minimum `[rootId]`)
6. Document the mapping for the MCP tool user

To look at later:
- `layers` type support for transitions and backgroundImage ✅ (done in v4)
- `fontFamily` type support
- `image` type + assets support ✅ (done in v4 via `{type:"url"}`)
- Reusable design tokens (`token` type)
- Automatic expansion of CSS shorthands (border, padding, margin, transition, border-radius)

## Webstudio source files (reference for Zod validation)

Public repo `webstudio-is/webstudio`:

| Role | Path |
|---|---|
| Paste handler + clipboard wrapper | `apps/builder/app/shared/copy-paste/plugin-instance.ts` |
| Zod schema `WebstudioFragment` | `packages/sdk/src/schema/webstudio.ts` |
| `Instance` schema | `packages/sdk/src/schema/instances.ts` |
| `Prop` schema (union by type) | `packages/sdk/src/schema/props.ts` |
| `StyleDecl` / `StyleValue` schema | `packages/sdk/src/schema/styles.ts` + `packages/css-engine/src/schema.ts` |
| `Breakpoint` schema | `packages/sdk/src/schema/breakpoints.ts` |
| `ws:element` definition + core meta | `packages/sdk/src/core-metas.ts` |
| **HTML tag whitelist** for `ws:element` | `packages/sdk/src/__generated__/tags.ts` (140+ tags including `button`, `img`, etc.) |
| `Image` meta (real component) | `packages/sdk-components-react/src/image.ws.ts` |
| `HtmlEmbed` meta | `packages/sdk-components-react/src/html-embed.ws.ts` |
| `showAttribute = "data-ws-show"` constant | `packages/react-sdk/src/props.ts` |

**Exact wrapper** (from `plugin-instance.ts`):
```ts
const version = "@webstudio/instance/v0.1";
const InstanceData = WebstudioFragment.extend({ instanceSelector: z.array(z.string()) });
const ClipboardData = z.object({ [version]: InstanceData });
```
If `ClipboardData.parse()` throws, it is a silent try/catch → rejection with no error message (= what we observed).

## Exact ColorValue (the trap)

```ts
ColorValue = {
  type: "color",
  colorSpace: "hex" | "srgb" | "p3" | "hsl" | ...,
  components: [number, number, number],   // 0..1
  alpha: number | VarValue
}
```
**NO `{type:"color", value:"#hex"}` variant.** That was THE main blocker.

## PropType — valid variants

`number | string | boolean | json | asset | page | string[] | parameter | resource | expression | action | animationAction`

For an image: `src` accepts `{ type:"asset", value:"<assetId>" }` (asset present in `assets[]`), a plain URL **string**, or an **expression** (collection binding). The asset form adds Webstudio's optimization (srcset, lazy); a URL string and an expression render fine without it. A raw `ws:element` + `tag:"img"` is only for a deliberately unoptimized `<img>`, not a requirement for URLs. See pattern `image-component`.

## Builder-side validation (recap)

Final test: take a fragment that works (copy from a single-brand project), run `WebstudioFragment.parse()` against my JSON, diff the Zod output → the first key that breaks is revealed.
