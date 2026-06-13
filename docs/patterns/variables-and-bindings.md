---
name: Variables and page field binding (MVP-5)
description: Tools webstudio_create_variable + webstudio_list_variables + webstudio_bind_page_field validated end-to-end 2026-05-08. Webstudio expression format = $ws$dataSource$<id-with-dashes-escaped>.
category: workflow
complexity: medium
lastUpdated: 2026-05-20
recommendedTool: variables.create + variables.bind_page_field
recommendedToolNote: format: $ws$dataSource$<id> in expressions
---

# Webstudio MCP — Variables and bindings (MVP-5 validated)

**Validated end-to-end 2026-05-08** on a test project:
- `webstudio_create_variable`: variable `pageTitle` created, version 22
- `webstudio_bind_page_field` (direct variable): title bound, version 23
- `webstudio_bind_page_field` (concat template): meta.description bound to `"text " + variable`, version 24

## Webstudio expression format

```
$ws$dataSource$<id-encoded>
```

The `<id-encoded>` is the dataSourceId with the non-JS-safe characters escaped.
**Only `-` must be escaped, as `__DASH__`** (`_` is JS-safe; otherwise the nanoid alphabet is `[A-Za-z0-9]`).

```ts
encodeDataSourceVariable("vlOwVQ7sis73RclRW-w2q")
// → "vlOwVQ7sis73RclRW__DASH__w2q"
```

## Concatenation (template)

The expression supports plain JS concatenation with `+`:

```js
"Prefix " + $ws$dataSource$xxx + " suffix " + $ws$dataSource$yyy
```

The `templateExpr(parts)` helper assembles from:
- `{ type: "text", value: "..." }` → JSON.stringify
- `{ type: "variable", dataSourceId: "..." }` → variableExpr

## dataSource format (creation)

Namespace `dataSources`, op `add`, path `[dataSourceId]`:

```json
{
  "id": "<nanoid 21>",
  "scopeInstanceId": "<instanceId>",
  "name": "pageTitle",
  "type": "variable",
  "value": { "type": "string", "value": "default" }
}
```

**`scopeInstanceId`** determines the scope:
- the page's `rootInstanceId` → page-global variable (visible in Page Settings)
- a component's ID → variable scoped to the component (prop drill via child expressions)

**`value` types**: `string`, `number`, `boolean`, `json`.

## Bindable fields of a page

```
title (top-level)
meta.description
meta.language
meta.redirect
meta.socialImageUrl
meta.excludePageFromSearch
```

`meta.documentType` is NOT bindable (literal enum).

## Typical workflow

```ts
// 1. Get the page's rootInstanceId
const pages = mcp.webstudio_fetch_pages({ projectSlug });
// rootInstanceId = pages[i].rootInstanceId

// 2. Create a variable scoped to the page
const ds = mcp.webstudio_create_variable({
  projectSlug, scopeInstanceId: rootInstanceId,
  name: "pageTitle",
  value: { type: "string", value: "default" },
});
// → dataSourceId

// 3. Bind the title to this variable
mcp.webstudio_bind_page_field({
  projectSlug, pageId, field: "title",
  binding: { kind: "variable", dataSourceId: ds.id },
});

// OR bind with a template (concat):
mcp.webstudio_bind_page_field({
  projectSlug, pageId, field: "meta.description",
  binding: {
    kind: "template",
    parts: [
      { type: "text", value: "Page: " },
      { type: "variable", dataSourceId: ds.id },
    ],
  },
});
```

## Unbind = revert to a literal string

To "undo" a binding, use `webstudio_update_page` with the field as a normal string (which will be JSON-stringified). An expression with no reference to a variable is just a string literal.

## Exposed helpers

`src/expressions.ts`:
- `encodeDataSourceVariable(id)` / `decodeDataSourceVariable(name)` — escape/unescape `-`
- `variableExpr(dataSourceId)` — produces `$ws$dataSource$<id>`
- `templateExpr(parts)` — produces the concat of string + variables
- `bindingToExpression(binding)` — resolves the 3 forms (variable / template / raw)

## Known V1 limits (to extend if needed)

- **System params** not yet exposed: to use `system.params.slug` etc., go through `kind: "raw"` (advanced).
- **Resources (CMS/API fetched data)**: not covered — these are dataSources of type `parameter` + a separate `resources` object. More complex workflow (will be MVP-6 if we touch dynamic pages such as product detail pages).
- **No delete_variable** or `update_variable_value`: the user can do it in the builder.
- ~~No binding on instance props~~ **OUTDATED (corrected 2026-06-10)** — `instances.prop_bind` binds any instance prop to a variable / resource expression / page field (see `src/tools/bind-instance-prop.ts`). This limit no longer exists.

## data-ws-show: the binding MUST be boolean (v2.19.0)

A `data-ws-show` expression that resolves to a NUMBER leaks a literal "0" as text on the
live page instead of hiding the element (real case: a multi-tenant template, 2026-06-10).
Push paths lint these bindings: a `….length` tail is auto-fixed to `….length > 0`
(`coerce:show-binding-length`); any other non-boolean-shaped expression gets a warning
(`detect:show-binding-not-boolean`). Always write an explicit boolean: `expr != null`,
`expr !== ""`, `expr.length > 0`.
