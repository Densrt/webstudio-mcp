---
name: ws:collection — iteration + per-item bindings
description: Push a ws:collection that iterates over an array (static literal or Resource-fetched) with each iteration template bound to a parameter dataSource. Atomically pushed alongside the fragment via the `dataSources` field of `push_fragment`. Replaces the previous "build N hardcoded cards" workaround.
category: workflow
complexity: advanced
lastUpdated: 2026-05-20
recommendedTool: cms.bind_collection_to_instance
recommendedToolNote: creates Resource + ws:collection in one call (Directus / WordPress / n8n)
---

# ws:collection — iteration + per-item bindings

**Status:** validated end-to-end via the push_fragment `dataSources` field (added 2026-05-18).
**Source:** webstudio-is/webstudio fixtures (`fixtures/webstudio-features/.webstudio/data.json`) + `packages/sdk/src/core-metas.ts`.

## When to use

- **A list of cards** (used-vehicle listings, blog articles, testimonials, partners…) where one item's visual structure repeats **≥ 3 times** on the page
- The content comes from a **data source** (HTTP Resource, local JSON variable, or inline literal array) and **must be replaceable** without touching the design
- The **CMS / endpoint will evolve later**: start with a placeholder array, then switch to a Resource by replacing 1 prop

## When NOT to use

- **Only 2 cards**: manual duplication is simpler, no gain
- **Layout that varies a lot from one item to the next**: ws:collection forces a SINGLE template
- **Cards with complex actions that differ per item** (nested forms, contextual modals): binding via prop expression gets heavy — prefer N distinct components

## Runtime component

```ts
// packages/sdk/src/core-metas.ts
export const collectionComponent = "ws:collection";

// Official props:
//   data    (required, json)  → array to iterate over
//   item    (optional, string) → parameter name (editor label)
//   itemKey (optional, string) → field used as the React key
//
// contentModel: { category: "instance", children: ["instance"] }
// → exactly ONE child instance (the template) — repeated N times at runtime
```

**ws:collection is DOM-TRANSPARENT**: it renders no HTML wrapper. If you want to style the grid (gap, grid-template-columns…), wrap it in a parent `ws:element` **before** applying the styles. See anti-patterns below.

## Exact JSON format (to push via push_fragment)

### 1. The Collection instance (parent of the template)

```json
{
  "type": "instance",
  "id": "<collectionId>",
  "component": "ws:collection",
  "label": "Occasions",
  "children": [{ "type": "id", "value": "<templateId>" }]
}
```

### 2. The parameter dataSource (NEW — via the `dataSources` field)

```json
{
  "type": "parameter",
  "id": "<itemDataSourceId>",
  "scopeInstanceId": "<collectionId>",
  "name": "occasion"
}
```

→ pushed via the new `dataSources` field of `push_fragment` (atomic with the rest of the fragment, no orphan on crash).

### 3. The two props on ws:collection

```json
[
  {
    "instanceId": "<collectionId>",
    "name": "data",
    "type": "expression",
    "value": "[{\"brand\":\"Acme\",\"model\":\"Trail 520\",\"price\":\"8 990 €\"},{...},{...}]"
  },
  {
    "instanceId": "<collectionId>",
    "name": "item",
    "type": "parameter",
    "value": "<itemDataSourceId>"
  }
]
```

⚠️ **`data` is of type `expression`** — the value is a JS string evaluated at render:
- For a static array: JSON-stringify the array, then pass the string as `value` (the `value` above is the complete `"[{...},...]"` string, NOT the parsed array)
- For a Resource: `value: "$ws$dataSource$<resourceDataSourceId>.data"` (no stringify, it is a JS expression)

### 4. The template children reference the item

**Dynamic text** (children of type `expression` instead of `text`):

```json
{
  "type": "instance",
  "id": "<priceTextId>",
  "component": "ws:element",
  "tag": "p",
  "children": [
    {
      "type": "expression",
      "value": "$ws$dataSource$<itemDataSourceId>.price"
    }
  ]
}
```

**Dynamic prop** (href, src, alt…):

```json
{
  "instanceId": "<linkId>",
  "name": "href",
  "type": "expression",
  "value": "$ws$dataSource$<itemDataSourceId>.url"
}
```

## Critical rule — `__DASH__` encoding

MCP `nanoid`s use **no** hyphen (alphabet `[A-Za-z0-9_-]` filtered). But if an external dataSourceId contains a `-`, the expression must escape it as `__DASH__`:

```ts
// On the caller side, if you build the string by hand:
const escaped = dataSourceId.replace(/-/g, "__DASH__");
const expr = `$ws$dataSource$${escaped}.field`;

// MCP-side helper (already done by bind_page_field): variableExpr(id, path?)
```

⚠️ **Check that incoming IDs are clean** — an unescaped `-` silently breaks the evaluation (the binding renders `undefined`).

## Full recipe — Placeholder used-vehicle listing

```ts
// 1. Stable IDs (caller side)
const sectionId = newId();
const collectionId = newId();
const cardTplId = newId();
const brandTextId = newId();
const itemParamId = newId();   // ← the item's dataSourceId

const occasions = [
  { id: "1", brand: "Acme", model: "Trail 520",          year: 2023, km: "1 800 km", price: "8 990 €",  image: "https://...", url: "#" },
  { id: "2", brand: "Acme", model: "Trail 1000 Expert",  year: 2024, km: "850 km",   price: "13 500 €", image: "https://...", url: "#" },
  { id: "3", brand: "Acme", model: "Trail 850 Expert",   year: 2022, km: "4 200 km", price: "10 900 €", image: "https://...", url: "#" },
];

// 2. push_fragment payload
await webstudio_push_fragment({
  pushTo: { projectSlug: "<project>", parentInstanceId: mainId, dryRun: true },

  instances: [
    { id: sectionId, component: "ws:element", tag: "section", label: "Occasions" },
    // ws:collection — DOM-transparent, parentId = sectionId
    { id: collectionId, component: "ws:collection", label: "Occasions list", parentId: sectionId, children: [{ type: "id", value: cardTplId }] },
    // card template (a SINGLE child — Webstudio repeats it N times)
    { id: cardTplId, component: "ws:element", tag: "article", label: "Card template", parentId: collectionId },
    { id: brandTextId, component: "ws:element", tag: "p", label: "Brand", parentId: cardTplId,
      children: [{ type: "expression", value: `$ws$dataSource$${itemParamId}.brand` }] },
    // …(other children: model text, image, year/km specs, price, CTA)
  ],

  // 3. dataSources — atomic with instances
  dataSources: [
    { type: "parameter", id: itemParamId, scopeInstanceId: collectionId, name: "occasion" },
  ],

  // 4. props — data + item
  props: [
    { instanceId: collectionId, name: "data", type: "expression",
      value: JSON.stringify(occasions) },
    { instanceId: collectionId, name: "item", type: "parameter",
      value: itemParamId },
  ],
});
```

## Migrating to an HTTP Resource (later)

Once you have a real endpoint (n8n / Directus / WP REST):

```ts
// 1. Create the Resource
const r = await webstudio_create_resource({
  projectSlug: "<project>",
  scopeInstanceId: rootInstanceId,
  name: "occasions",
  urlExpression: `"https://<n8n-host>/webhook/occasions?dealer=<project>"`,
  method: "get",
});

// 2. Update THE SINGLE data prop via instance_prop
await webstudio_instance_prop({
  action: "update",
  projectSlug: "<project>",
  instanceId: collectionId,
  name: "data",
  type: "expression",
  value: `$ws$dataSource$${r.dataSourceId}.data`,  // resource envelope → .data
});

// → The template + the $ws$dataSource$<itemParamId>.brand bindings do NOT change.
// → Migration = 5 min, zero design rebuild.
```

⚠️ **Resource envelope**: the HTTP response is wrapped in `{ok, status, data}`. Always prefix the path with `.data` (see pattern `resources-http-data`).

## Anti-patterns

### ❌ Applying a style directly on `ws:collection`

```ts
// ws:collection is DOM-transparent → display:flex is ignored, items stack in block flow
await webstudio_styles({
  action: "update-local",
  instanceId: collectionId,
  decls: { display: { type: "keyword", value: "flex" } },
});
```

✅ **Fix**: wrap first, then style the wrapper:

```ts
await webstudio_wrap_instance({
  instanceId: collectionId,
  component: "ws:element",
  tag: "div",
  label: "Occasions grid",
});
// Then styles on the returned wrapperId
```

### ❌ Template with multiple root children

```json
{
  "id": "<collectionId>",
  "component": "ws:collection",
  "children": [
    { "type": "id", "value": "card1" },
    { "type": "id", "value": "card2" }
  ]
}
```

→ Webstudio renders only the first one (`contentModel.children: ["instance"]` = exactly 1).

✅ **Fix**: a single parent `ws:element` that contains both children.

### ❌ Pushing the `data` literal array as `type: "json"` instead of `"expression"`

```ts
// WRONG — Webstudio expects a JS expression, not raw JSON
{ instanceId: collectionId, name: "data", type: "json", value: [...] }
```

✅ **Right**: `type: "expression"`, `value: JSON.stringify([...])` (the string is evaluated as a JS literal).

### ❌ Forgetting to escape the `-` in the dataSourceId

```ts
const id = "abc-123";
const expr = `$ws$dataSource$${id}.brand`;  // → silently broken
```

✅ **Right**:

```ts
const escaped = id.replace(/-/g, "__DASH__");
const expr = `$ws$dataSource$${escaped}.brand`;
```

Or use the `variableExpr(id, path?)` helper exposed by the MCP builder.

## Upstream Webstudio schemas (references)

- `packages/sdk/src/core-metas.ts` — `collectionComponent`, `collectionMeta`
- `packages/sdk/src/schema/data-sources.ts` — DataSource union (variable / parameter / resource)
- `packages/sdk/src/expression.ts` — parser for `$ws$dataSource$<id>.<path>` expressions
- `apps/builder/app/builder/features/inspector/style-source-section/...` — UI binding panel
- `packages/sdk-components-react/src/collection.tsx` — React renderer (internal, non-public)

## Related patterns

- `resources-http-data` — to wire up the HTTP Resource that will replace the placeholder
- `variables-and-bindings` — for shared `:root` variables (site name, dealerId)
- `paste-debug-method` — if the Collection renders nothing after push (capture the copy from the builder)
```
