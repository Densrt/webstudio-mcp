# Data model

Observed shape of a Webstudio build, as returned by `GET /rest/data/{projectId}`
and as expected by `POST /trpc/build.patch`. Everything below was confirmed by
reading payloads off the wire and cross-checking against the public Zod schemas
in `webstudio-is/webstudio` (`packages/sdk/src/schema/*`).

## High-level hierarchy

```
Project
└── Build              (id, version, projectId)
    ├── pages          (homePageId, rootFolderId, pages[], folders[])
    │   └── Page       (id, name, path, rootInstanceId, title, meta)
    └── containers     (10 Immer Maps, listed below)
```

A Page is just metadata + a pointer to the root `Instance` of its DOM tree.
The DOM lives entirely inside the `instances` container; pages do not carry
their tree inline.

## The ten containers

The build is a collection of named containers. On the wire each is serialized
as an array of objects, but server-side they are Immer Maps (`enableMapSet`).
That detail matters for patches (see [patches.md](patches.md)).

| Container | Key | Purpose |
|---|---|---|
| `instances` | `instance.id` | DOM tree nodes |
| `props` | `prop.id` | Per-instance props (`href`, `data-*`, embed `code`, …) |
| `breakpoints` | `breakpoint.id` | Responsive breakpoints (label + maxWidth) |
| `styleSources` | `styleSource.id` | `local` or `token` declarations |
| `styleSourceSelections` | `selection.instanceId` | Which sources apply to which instance |
| `styles` | composite (see below) | One `StyleDecl` per (source, breakpoint, property, state) |
| `dataSources` | `dataSource.id` | Variables, parameters, and resource bindings |
| `resources` | `resource.id` | HTTP requests fetched at SSR time |
| `assets` | `asset.id` | Uploaded media metadata |
| `marketplaceProduct` | n/a | Marketplace metadata (rarely touched) |

The `pages` container also exists at the top level, with its own internal
sub-containers (`pages`, `folders`) that take the same Map-key patch shape.

## Instance

```ts
type Instance = {
  type: "instance";
  id: string;
  component: string;       // "ws:element" | "HtmlEmbed" | "@webstudio-is/sdk-components-react-radix:Dialog" | …
  tag?: string;            // Only when component === "ws:element" ("section", "h1", "a", "button", "img", …)
  label?: string;          // Builder-side label, free string
  children: InstanceChild[];
};

type InstanceChild =
  | { type: "id"; value: string }       // child instance reference
  | { type: "text"; value: string }     // inline text
  | { type: "expression"; value: string }; // bound expression (see pages.md)
```

Components fall in three categories:

- `ws:element` — generic HTML element, real tag in `tag` (whitelist at `packages/sdk/src/__generated__/tags.ts`)
- Built-in components — short names with no namespace (`HtmlEmbed`, `Image`, `Form`, …)
- Radix components — fully qualified `@webstudio-is/sdk-components-react-radix:<Name>` (see [patterns.md](patterns.md))

## Prop

```ts
type Prop = {
  id: string;
  instanceId: string;
  name: string;
  type: "number" | "string" | "boolean" | "json" | "asset" | "page"
      | "string[]" | "parameter" | "resource" | "expression"
      | "action" | "animationAction";
  value: unknown;          // shape depends on type
};
```

Notable shapes:

- `href` page link: `{ type: "page", value: "<pageId>" }`
- `src` for `Image`: `{ type: "asset", value: "<assetId>" }` — must reference an entry in `assets[]`
- HtmlEmbed code: `{ type: "string", value: "<html>…" }`
- Data binding: `{ type: "expression", value: "$ws$dataSource$…" }`
- Visibility: `{ name: "data-ws-show", type: "boolean", value: true }`

## StyleSource

```ts
type StyleSource =
  | { type: "local"; id: string }
  | { type: "token"; id: string; name: string; locked?: boolean };
```

Tokens are referenced by **name** in `var()` values, not by id:

```json
{ "type": "var", "value": "color-primary" }
```

The id is what the patch keys; the name is what the runtime resolves.

## StyleValue

Critical: the `color` shape is the extended one. The naive `{type:"color", value:"#hex"}`
is rejected by the validator.

```ts
type StyleValue =
  | { type: "unit"; value: number; unit: string }       // unit "number" for unitless (lineHeight, opacity)
  | { type: "keyword"; value: string }
  | { type: "color"; colorSpace: "hex" | "rgb" | "hsl" | "lab" | "lch" | "oklab" | "oklch";
      components: number[]; alpha: number }              // components are 0..1
  | { type: "var"; value: string; fallback?: StyleValue }
  | { type: "unparsed"; value: string }
  | { type: "fontFamily"; value: string[] }
  | { type: "image"; value: { type: "asset"; value: string } | { type: "url"; url: string } }
  | { type: "layers"; value: StyleValue[] }              // for backgroundImage, transitionProperty, …
  | { type: "shadow"; position: "outset" | "inset"; offsetX; offsetY; blur; spread; color };
```

See `src/types.ts:84-93` for the canonical list.

### Shorthand expansion

Webstudio rejects most CSS shorthands. The paste validator accepts them but the
style panel renders them red. Always expand before sending:

| Shorthand | Required form |
|---|---|
| `border` | 4× width + 4× style + 4× color |
| `borderWidth: 2px` | `borderTopWidth`, …, `borderLeftWidth` |
| `borderRadius` | 4× corner radius |
| `padding`, `margin` | 4× per side |
| `gap` | `rowGap` + `columnGap` |
| `transition` | `transitionProperty/Duration/TimingFunction/Delay/Behavior` (each `layers`) |
| `background` | per-property: `backgroundColor`, `backgroundImage`, `backgroundSize`, … |
| `background-position` | `backgroundPositionX` + `backgroundPositionY` |

Native exceptions: `overflow`, `gap` shorthand on flex/grid, `aspect-ratio`, `rotate`
all work as-is. `src/builder.ts` runs `expandShorthand()` automatically when
styles are added through the high-level helper.

## StyleDecl and the composite key

```ts
type StyleDecl = {
  styleSourceId: string;
  breakpointId: string;
  state?: string;                   // ":hover", "[data-state=\"active\"]", …
  property: string;                 // camelCase: "backgroundColor", "fontFamily"
  value: StyleValue;
  listed?: boolean;
};
```

The Map key for `styles` is composite — order matters:

```
${styleSourceId}:${breakpointId}:${property}:${state ?? ""}
```

Source: `packages/sdk/src/schema/styles.ts:getStyleDeclKey`. The MCP implementation
mirrors it in `src/fragment-to-patches.ts:168`. Putting `state` before `property`
silently breaks `op:remove` (the patch is keyed under one shape, the existing
record under another) while `op:add` still appears to work because the server
re-keys from the value.

## Breakpoint

```ts
type Breakpoint = {
  id: string;
  label: string;
  minWidth?: number;
  maxWidth?: number;
  condition?: string;
};
```

Default Webstudio set (mirrored in `src/types.ts:18-23`):

| Label | maxWidth |
|---|---|
| `Base` | — |
| `Tablet` | 991 |
| `Mobile landscape` | 767 |
| `Mobile portrait` | 479 |

### Label-based remap

Two builds rarely share breakpoint ids. When pushing a fragment that was
constructed with locally-generated breakpoint ids, the implementation matches
**by label** against the target build and rewrites every `style.breakpointId`
that maps. Unmatched breakpoints are pushed as new. See
`src/fragment-to-patches.ts:147-159`.

## Fragment envelope

Webstudio's clipboard format is:

```json
{
  "@webstudio/instance/v0.1": {
    "instanceSelector": ["root-id", …],
    "children": [{ "type": "id", "value": "root-id" }, …],
    "instances": [...],
    "props": [...],
    "styleSources": [...],
    "styleSourceSelections": [...],
    "breakpoints": [...],
    "styles": [...],
    "dataSources": [],
    "resources": [],
    "assets": [...]
  }
}
```

A fragment is what `Cmd+C` puts in the clipboard. The builder accepts the same
shape via paste, and so does this MCP client (it converts a fragment into a
patch transaction in `src/fragment-to-patches.ts`).

`children` may contain **multiple** root ids — e.g. a `Dialog` plus a sibling
`HtmlEmbed` that ships its `<style>`. The conversion inserts each as a
consecutive child of the target parent.

### Instance selector

`instanceSelector` is the path from the page root down to the selected element
at the moment the copy happened. For external pushes `[rootInstanceId]` is
sufficient — Webstudio reassigns it on paste anyway.

### Authoritative Zod sources

| Schema | File in `webstudio-is/webstudio` |
|---|---|
| `WebstudioFragment` | `packages/sdk/src/schema/webstudio.ts` |
| `Instance` | `packages/sdk/src/schema/instances.ts` |
| `Prop` | `packages/sdk/src/schema/props.ts` |
| `StyleDecl` / `StyleValue` | `packages/sdk/src/schema/styles.ts` + `packages/css-engine/src/schema.ts` |
| `Breakpoint` | `packages/sdk/src/schema/breakpoints.ts` |
| `ws:element` core meta + tag whitelist | `packages/sdk/src/core-metas.ts` + `packages/sdk/src/__generated__/tags.ts` |
| Paste handler (clipboard validator) | `apps/builder/app/shared/copy-paste/plugin-instance.ts` |

The paste handler wraps the parse in a silent `try/catch`, so any schema
mismatch causes the fragment to be dropped and the raw JSON pasted as plain
text instead. See [debugging.md](debugging.md) for how to localize the offender.
