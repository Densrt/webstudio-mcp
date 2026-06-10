---
name: Form action — standalone POST resource, NEVER a dataSource
description: How to wire a Form's submit action via the MCP without creating a render-time mutation. Cas réel — a form action registered as a POST resource exposed as a :root dataSource fired empty-body POSTs to the lead webhook on every page render (two production projects, 2026-06-10).
category: workflow
complexity: simple
lastUpdated: 2026-06-10
recommendedTool: resources.create
recommendedToolNote: method:"post" defaults to NO dataSource since v2.20.0 — then bind the Form's action prop (type:"resource") to the returned resourceId.
---

# Form action — standalone POST resource

## The incident (why this pattern exists)

A lead webhook received irregular empty-body `POST`s (`{}`, no payload). Diagnosis:
the form's action had been created with `resources.create({scopeInstanceId: ":root",
method: "post", …})` — which (pre-v2.20.0) ALWAYS created a companion **dataSource**.
A dataSource of type `resource` is, by Webstudio design, **fetched on every render of
its scope**: `:root` scope = every page load (published site AND Builder opening).
No submission at render time → the POST fired with an empty body. The auto-injected
`Cache-Control: max-age=3600` (the old default) explained the irregular rhythm.

## Faulty vs healthy (verified on production builds)

| | Faulty | Healthy |
|---|---|---|
| dataSource referencing the resource | present, scope `:root` (or page) | **none** |
| Form `action` prop | present | present — `type:"resource"`, `value:<resourceId>` |
| Cache-Control header | `max-age=3600` (old auto-default) | irrelevant (inert without dataSource — the resource only fires on submit) |
| Effect at render | POST with empty body on every (cached) render | nothing — fires on submit only |

The Form's `action` prop referencing the resource **by id** is the entire wiring.
The dataSource adds nothing for a form — it only creates the render-time fetch.

## The recipe (v2.20.0+)

```jsonc
// 1. Create the standalone POST resource (no scopeInstanceId, no dataSource —
//    the POST default since v2.20.0):
resources.create({
  projectSlug: "my-site",
  name: "action",
  method: "post",
  url: "$ws$dataSource$<webhookVarId>",          // bound to the webhook URL variable
  urlExpression: "$ws$dataSource$<webhookVarId>",
})
// → { resourceId }  (response shows "dataSource: (none …)")

// 2. Bind the Form:
instances.prop_update({
  projectSlug: "my-site",
  instanceId: "<formInstanceId>",
  name: "action",
  type: "resource",
  value: "<resourceId>",
})
```

In a `push_complete`/`push_fragment` template, the Form carries the prop
`{ name: "action", type: "resource", value: "<resourceId placeholder>" }` and the
resource is created beforehand with the recipe above.

## Server enforcement (v2.20.0)

- `resources.create` method-aware defaults: GET → dataSource + `Cache-Control: max-age=3600`
  (unchanged); **POST/PUT/DELETE → NO dataSource, NO cache header**. `scopeInstanceId`
  becomes optional and is only required when a dataSource is actually created.
- Forcing `exposeAsDataSource: true` on a non-GET still works (exotic cases) but emits a
  loud warning + `detect:resource-mutation-datasource` telemetry.
- `audit.resources_perf` flags every existing non-GET resource exposed as a dataSource
  under "🔥 Render-time mutations" with the fix.

## Pitfalls

- **Do NOT** "fix" by raising the cache TTL — the POST still fires, just less often.
- A page-scoped dataSource is no safer than `:root` for a mutation: it fires on every
  render of that page.
- Deleting the faulty dataSource (Builder: Global Root → Data Variables, or
  `variables.delete`) does NOT delete the resource — the Form's action keeps working.
