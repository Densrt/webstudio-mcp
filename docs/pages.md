# Page management

Pages, page-scoped variables, and HTTP resources. All three were validated
end-to-end against a real Webstudio Cloud project.

## Identifiers: nanoid 21, URL-safe alphabet

The builder generates 12-char ids for fragments because they get reassigned at
paste time. For ids that **persist** server-side (pages, instances created by
`create_page`, dataSources, resources), Webstudio's convention is the
URL-safe nanoid:

```ts
const wsId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);
```

64-character alphabet, 21 characters long. Examples observed in the wild:
`6oa2kyr-NaQseOhr4Nlx_`, `mvyMnfLqyyzTr7Oc24KJs`.

## Creating a page

A `create_page` transaction touches three namespaces:

- `instances` — insert the new body instance (`ws:element` + `tag:"body"`)
- `pages` — insert the page record under `pages.pages`
- `pages` — replace the parent folder's `children` array with the page id appended

```json
{
  "namespace": "pages",
  "patches": [
    { "op": "add", "path": ["pages", "<pageId>"], "value": { "id": "<pageId>", "name": "About", "path": "/about",
        "title": "\"About us\"",
        "rootInstanceId": "<rootInstanceId>",
        "meta": { "description": "\"\"", "excludePageFromSearch": "false",
          "language": "\"\"", "redirect": "\"\"", "socialImageUrl": "\"\"",
          "custom": [], "documentType": "html" },
        "marketplace": { "include": false } } },
    { "op": "replace", "path": ["folders", "root", "children"], "value": [...existing, "<pageId>"] }
  ]
}
```

Plus, in the `instances` namespace:

```json
{ "op": "add", "path": ["<rootInstanceId>"],
  "value": { "type": "instance", "id": "<rootInstanceId>",
    "component": "ws:element", "tag": "body", "children": [] } }
```

### `meta.*` is stored as JS expressions

This is the critical gotcha. Most page metadata fields hold a **JS expression
serialized as a string**, not the literal value:

| Field | Encoding |
|---|---|
| `title` (top-level) | `JSON.stringify("Untitled")` → `"\"Untitled\""` |
| `meta.description` | `JSON.stringify(text)` |
| `meta.excludePageFromSearch` | `JSON.stringify(false)` → `"false"` |
| `meta.language` | `JSON.stringify("fr-FR")` (BCP 47) |
| `meta.redirect` | `JSON.stringify(url)` |
| `meta.socialImageUrl` | `JSON.stringify(url)` |
| `meta.documentType` | literal `"html"` or `"xml"` (not stringified — this is an enum) |
| `meta.custom` | array, not stringified |
| `name` | literal string |
| `path` | literal string |
| `marketplace.include` | native boolean |

If you forget the `JSON.stringify`, the server accepts the raw value but the
builder evaluates it as JS at runtime and renders `undefined` in the UI. Zod
errors of the form `Expected string, received boolean` on
`pages.N.value.meta.excludePageFromSearch` indicate the same bug.

## Folders

`build.pages.folders` is shaped like an array on the wire but is a Map in
memory. Patch into it with `path: ["folders", "<folderId>", "children"]`.
The root folder has the literal id `"root"` and is also exposed as
`build.pages.rootFolderId`.

`children` is a flat array of page ids. To add a page, `op: "replace"` the
whole array with the new one — there is no per-element add operation on
folder children.

## Deleting a page

Webstudio's own delete only removes the page record and its root instance.
Descendants of that instance become orphaned in the `instances` container.
The MCP runs a tree-walker before the patch:

```ts
function collectDescendantIds(rootId: string, instances: Instance[]): string[] {
  const collected: string[] = [];
  const visit = (id: string) => {
    collected.push(id);
    const inst = instances.find((i) => i.id === id);
    for (const child of inst?.children ?? []) {
      if (child.type === "id") visit(child.value);
    }
  };
  visit(rootId);
  return collected;
}
```

Then the transaction emits `op: "remove"` for each id in `instances`, plus the
page removal in `pages`. Refuse early if `pageId === build.pages.homePageId`.

The current implementation does **not** clean up associated `props`, `styles`,
or `styleSourceSelections`. Webstudio tolerates the orphans; future versions
should sweep them.

## Variables (data sources)

A `dataSource` of type `variable` holds a value reactive to bindings.

```json
{
  "id": "<nanoid 21>",
  "type": "variable",
  "scopeInstanceId": "<rootInstanceId>",
  "name": "pageTitle",
  "value": { "type": "string", "value": "default" }
}
```

Value shapes: `string`, `number`, `boolean`, `json`. The
`scopeInstanceId` controls visibility — pass the page's `rootInstanceId` for a
page-global variable, an inner instance id for a component-scoped one.

### Expression encoding

Bindings reference a data source by its id with a hyphen-escaped form:

```
$ws$dataSource$<id-encoded>
```

The encoding only escapes hyphens (`-` → `__DASH__`); underscores are
JS-identifier-safe and pass through. Example:

```ts
encodeDataSourceVariable("vlOwVQ7sis73RclRW-w2q")
// → "vlOwVQ7sis73RclRW__DASH__w2q"
```

Helpers in `src/expressions.ts`:

- `variableExpr(id, path?)` — produces `$ws$dataSource$<id>` plus optional
  property access (`.name`, `[0]`, `["weird-key"]`)
- `templateExpr(parts)` — JS string concatenation of literals and variables
- `bindingToExpression(binding)` — top-level resolver

### Bindable page fields

The expression encoding lets you bind any meta field that is stored as a JS
expression:

```
title
meta.description
meta.language
meta.redirect
meta.socialImageUrl
meta.excludePageFromSearch
```

`meta.documentType` is **not** bindable — it's an enum.

Template example for `meta.description`:

```ts
bindPageField({
  field: "meta.description",
  binding: {
    kind: "template",
    parts: [
      { type: "text", value: "Page: " },
      { type: "variable", dataSourceId: ds.id },
    ],
  },
});
// expression: "\"Page: \" + $ws$dataSource$<id>"
```

To unbind, write a literal string back through `update_page` — the server
will JSON-stringify it and the absence of any `$ws$dataSource$` reference
makes it a static value again.

## Resources (HTTP, server-side fetch)

A `resource` is an HTTP request executed by Webstudio at SSR time. Its result
is exposed to the page through a `dataSource` of type `resource`.

```ts
// resources container
{
  id: string,
  name: string,
  method: "get" | "post" | "put" | "delete",
  url: string,                  // expression — JSON.stringify if literal
  headers: [{ name: string, value: string /* expression */ }],   // required, may be []
  searchParams?: [{ name: string, value: string /* expression */ }],
  body?: string,                // expression
  control?: "system" | "graphql"
}

// dataSources container
{
  type: "resource",
  id: string,                   // dataSourceId — bind targets this
  scopeInstanceId: string,      // rootInstanceId for a page-level resource
  name: string,                 // usually same as resource.name
  resourceId: string            // pointer to the entry above
}
```

Bind expressions reference the **dataSourceId**, not the resourceId.

### Response envelope

The runtime wraps the HTTP response so handlers can react to errors:

```ts
{
  ok: boolean,         // true on 2xx
  status: number,
  statusText: string,
  data: any            // parsed JSON or text body
}
```

All paths into the body must therefore start with `data`. Binding to
`userData.name` instead of `userData.data.name` produces `undefined` at
runtime — common mistake.

```ts
$ws$dataSource$<id>.data.name           // "Leanne Graham"
$ws$dataSource$<id>.data.address.city   // "Gwenborough"
$ws$dataSource$<id>.ok                  // true / false
$ws$dataSource$<id>.status              // 200, 404, …
```

### Dynamic URL example

```ts
createResource({
  scopeInstanceId: page.rootInstanceId,
  name: "moto",
  urlExpression: `"https://api.example.com/products?slug=" + $ws$system.params.slug`,
  method: "get",
});
```

Schemas: `packages/sdk/src/schema/resources.ts` + `data-sources.ts` +
`expression.ts`. Runtime loader: `packages/sdk/src/resource-loader.ts`.
