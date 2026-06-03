---
name: Resources (HTTP fetched data) — MVP-6 validated
description: Tools webstudio_create_resource + webstudio_list_resources validated end-to-end 2026-05-08. Resources = SSR HTTP calls exposed as dataSources of type "resource". Bindings support nested paths to reach sub-properties.
category: workflow
complexity: medium
lastUpdated: 2026-05-20
recommendedTool: resources.create
recommendedToolNote: HTTP fetched data exposed as dataSource type 'resource'
---

# Webstudio MCP — Resources (MVP-6 validated)

**Validated end-to-end 2026-05-08** on `darktest`:
- `webstudio_create_resource` (jsonplaceholder.typicode.com/users/1) → version 25
- `bind_page_field` title → `userData.name` → version 26
- `bind_page_field` meta.description → template with 2 nested paths → version 27

## Validated format (from the open-source Zod schemas)

Sources read: `packages/sdk/src/schema/resources.ts` + `data-sources.ts` + `expression.ts`.

### Resource (namespace `resources`)

```ts
{
  id: string,                 // nanoid 21
  name: string,
  method: "get" | "post" | "put" | "delete",
  url: string,                // EXPRESSION — JSON.stringify if literal
  searchParams?: [{ name: string, value: string /* expression */ }],
  headers: [{ name: string, value: string /* expression */ }],  // required (can be [])
  body?: string,              // EXPRESSION
  control?: "system" | "graphql",
}
```

⚠️ Every field marked "expression" must be JSON-stringified when it is a literal. E.g. the URL `"https://api.com"` is sent as `"\"https://api.com\""`.

### DataSource of type "resource" (namespace `dataSources`)

```ts
{
  type: "resource",
  id: string,                 // dataSourceId (different from the resourceId!)
  scopeInstanceId: string,    // rootInstanceId of the page for a "page resource"
  name: string,               // often identical to resource.name
  resourceId: string,         // pointer to the entry in `resources`
}
```

**The dataSourceId is what you bind** in expressions, not the resourceId.

### ⚠️ Response format — the ENVELOPE is mandatory

Source: `packages/sdk/src/resource-loader.ts` (loadResource).

The HTTP response is wrapped in:
```ts
{
  ok: boolean,        // true if status 2xx
  status: number,     // e.g. 200, 404, 500
  statusText: string, // e.g. "OK", "Not Found"
  data: <parsed JSON or text>,  // the body
}
```

**Every path that reaches the body must start with `data`.**

Classic mistake (incident 2026-05-08): binding `title` to `userData.name` instead of `userData.data.name` → `undefined` displayed. Always prefix with `data`.

### Reference a property

```
$ws$dataSource$<dataSourceId>.<path>
```

Examples (resource jsonplaceholder/users/1):
- `$ws$dataSource$xxx.data.name` → "Leanne Graham"
- `$ws$dataSource$xxx.data.address.city` → "Gwenborough"
- `$ws$dataSource$xxx.data.company.bs` → company business string
- `$ws$dataSource$xxx.ok` → `true`/`false` (useful for handling HTTP errors template-side)
- `$ws$dataSource$xxx.status` → 200/404/500

The expression is evaluated by the Webstudio runtime: the dataSource resolves to the `{ok,status,statusText,data}` envelope, and `.path` is plain JS property access.

## Typical workflow for dynamic data

### Case: dynamic product detail page

```ts
// 1. Get the rootInstanceId
const pages = mcp.webstudio_fetch_pages({ projectSlug: "<project>" });
const fiche = pages.find(p => p.path === "/moto/[slug]");

// 2. Create the resource pointing at the n8n webhook
const r = mcp.webstudio_create_resource({
  projectSlug: "<project>",
  scopeInstanceId: fiche.rootInstanceId,
  name: "moto",
  // Dynamic URL with path param:
  urlExpression: `"https://<n8n-host>/webhook/moto?slug=" + $ws$system.params.slug`,
  method: "get",
});

// 3. Bind title and meta
mcp.webstudio_bind_page_field({
  projectSlug, pageId: fiche.id, field: "title",
  binding: { kind: "template", parts: [
    { type: "variable", dataSourceId: r.dataSourceId, path: ["data", "name"] },
    { type: "text", value: " — Acme" },
  ]},
});

mcp.webstudio_bind_page_field({
  projectSlug, pageId: fiche.id, field: "meta.description",
  binding: { kind: "variable", dataSourceId: r.dataSourceId, path: ["data", "description"] },
});
```

## Extended expression helpers

`src/expressions.ts`:
- `variableExpr(dataSourceId, path?)` — supports string/number paths, escapes non-JS-safe keys via `[...]`
- `templateExpr(parts)` — each variable part can carry a `path`
- `bindingToExpression(binding)` — resolves the 3 kinds (variable+path / template / raw)

## Auto-stringification

The "expression" fields auto-stringified by `create_resource`:
- `url` (unless `urlExpression` is provided)
- `headers[].value`
- `body` (unless `bodyExpression` is provided)

To pass a raw expression (with variables / `system.params.X`), use `urlExpression` / `bodyExpression`. The tool accepts both forms.

## Known V1 limitations

- `searchParams` is not exposed in the tool (you can emulate it with a query string in the URL; to be added if needed)
- No `update_resource` or `delete_resource` (the user can do it in the builder, or we add it if needed)
- The `system` variable (for `system.params.slug`) is only reachable via a raw `urlExpression` — no structured helper yet
- No bindings on **instances** (text, props) yet — that is the next MVP-7
