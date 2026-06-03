---
name: Page lifecycle — create, duplicate, scaffold from template, delete
description: Decision tree for creating / duplicating / scaffolding a page (create vs duplicate vs clone_subtree vs share_slot_to_page) + wire format JSON-stringified meta, nanoid 21 chars URL-safe, tree-walker delete. Scaffolding a new content page from an existing template goes through pages.duplicate (full page) or instances.clone_subtree with targetAnchor (sections only) — not through build.push_complete.
category: workflow
complexity: medium
lastUpdated: 2026-05-22
recommendedTool: pages.create / pages.duplicate / pages.update / pages.delete / pages.create_folder
recommendedToolNote: pages.duplicate to reuse a template (full page, atomic). pages.create to start from scratch. pages.update.parentFolderId for atomic move + rename. pages.create_folder to structure the navigator. Path uniqueness folder-scoped (v2.7.13). meta = JSON-stringified expressions, nanoid 21 chars.
---

# Webstudio MCP — Page lifecycle

## Decision tree — which tool to create my page?

| Need | Tool(s) | Why |
|---|---|---|
| New page that reuses **the entire structure** of an existing template (header + main + footer + meta + bindings + page-scoped dataSources) | **`pages.duplicate`** | Atomic in 1 call. Preserves the meta expressions, re-scopes the page-scoped resources, and accepts `variableSubstitutions` for SEO variants (city, brand…) |
| New page that shares the site's **Header/Footer**, with a custom main | **`pages.create`** + **`instances.share_slot_to_page`** × N | DAG: editing the Header propagates to all pages |
| **Existing** page to enrich with sections from a template page | **`instances.clone_subtree`** with `targetAnchor: { pagePath, label }` (and `skipChildLabels` if needed) | Acts only on the anchor's children, not on the whole page. See `cross-page-section-cloning` for the full workflow (incl. new page → append anchor → clone). |
| A truly **from scratch** page (no comparable template in the project) | **`pages.create`** + **`instances.append`** + `build.push_fragment` / `push_complete` | Rare case once the project's design system is in place |

See also `meta.describe_pattern({pattern:"shared-slots-between-pages"})` for the Header/Footer branch (DAG vs copy).

## ❌ Anti-pattern: `build.push_complete` to replicate an existing page

Rebuilding a page by re-enumerating `instances` + `props` + `styles` + `cloudTokens` via `push_complete` when a comparable page already exists in the project:

- **Loss of local style overrides** (the `aspect-ratio`, `padding` etc. values set locally on the source page are not re-declared).
- **Risk of divergence on the responsive breakpoints** already tuned on the source page.
- **8+ API calls** (create page → push_complete with tokens → attach → bindings → update_text…) instead of **1 call** `pages.duplicate`.
- **No automatic re-scoping** of the page-scoped dataSources/resources — everything has to be redone by hand.

Simple rule: **if the target page should resemble a source page in the same project, always start with `pages.duplicate`**, then adjust with `instances.update_text` / `instances.prop_update` / `tokens.update_token_styles`. It's faster, safer, and the diff sent to the server is minimal.

## Validation history

Validated end-to-end 2026-05-08 on project `darktest` (Test Claude MCP):
- `webstudio_create_page`: page created, version 9→10, status ok
- `webstudio_delete_page` (now `webstudio_delete_pages`): page deleted + tree-walker, version 10→11, status ok

## Meta format: JS expressions as strings

**Critical discovery**: Webstudio stores `meta.*` as **JS expressions in string form**, not as native JS values. The Zod validator **rejects bare booleans/strings**.

| Meta field | Webstudio type | Conversion |
|---|---|---|
| `description`, `language`, `redirect`, `socialImageUrl` | string (expression) | `JSON.stringify("")` → `"\"\""` |
| `excludePageFromSearch` | string (expression) | `JSON.stringify(false)` → `"false"` |
| `documentType` | literal string (enum) | `"html"` directly, **no stringify** |
| `custom` | array (not an expression) | `[]` or `[{property:"", content:"\"\""}]` |
| `socialImageAssetId` | optional | omitted (undefined) |

**Typical Zod error if forgotten**: `"path": ["pages", N, "value", "meta", "excludePageFromSearch"], "message": "Expected string, received boolean"`.

## Full Page format (validated transaction)

```json
{
  "namespace": "pages",
  "patches": [
    {
      "op": "add",
      "path": ["pages", "<pageId>"],
      "value": {
        "id": "<pageId>",
        "name": "Page name",
        "path": "/page-path",
        "title": "Untitled",
        "rootInstanceId": "<rootInstanceId>",
        "meta": {
          "description": "\"\"",
          "excludePageFromSearch": "false",
          "language": "\"\"",
          "redirect": "\"\"",
          "socialImageUrl": "\"\"",
          "custom": [],
          "documentType": "html"
        },
        "marketplace": { "include": false }
      }
    },
    {
      "op": "replace",
      "path": ["folders", "root", "children"],
      "value": [...existingChildren, "<pageId>"]
    }
  ]
}
```

+ namespace `instances`: add `[<rootInstanceId>]` with `{type:"instance", id, component:"ws:element", tag:"body", children:[]}`.

**Title**: ⚠️ **MUST be JSON-stringified** like an expression (`JSON.stringify("Untitled")` = `"\"Untitled\""`). Without the double-encoding, the server accepts the bare string but **the builder displays `undefined`** because it evaluates title as a JS expression. Initial error fixed 2026-05-08 on darktest v15.

**Recap of fields encoded as expressions** (= JSON.stringify required):
- `title` (top-level)
- `meta.description`
- `meta.excludePageFromSearch`
- `meta.language` (BCP 47 format: `fr-FR`, not `fr`)
- `meta.redirect`
- `meta.socialImageUrl`

**Fields in literal string** (NO encoding):
- `name`
- `path`
- `meta.documentType` (enum `"html"` / `"xml"`)
- `marketplace.include` (native boolean)

## Webstudio IDs: nanoid 21 chars URL-safe

The existing builder used `customAlphabet("A-Za-z0-9", 12)` for fragment IDs (which are reassigned on paste). For `create_page` the IDs are **used directly by the server** (not reassigned), so we must follow the Webstudio nanoid convention:

```ts
const wsId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);
```

Full URL-safe alphabet (64 chars: a-z, A-Z, 0-9, `-`, `_`) over 21 chars. Format observed in the captures: `6oa2kyr-NaQseOhr4Nlx_`, `mvyMnfLqyyzTr7Oc24KJs`.

## Folders — Map serialized as an array

`build.pages.folders` is an array `[{id, name, slug, children}]` on the JSON HTTP side. But in server memory it's an **Immer Map**, so the patches use `path: ["folders", "<folderId>", "children"]` (Map key direct).

- Root folder: `id: "root"`, also exposed via `build.pages.rootFolderId`
- To insert a page: `op: "replace"` on `["folders", folderId, "children"]` with the **full** updated list (not an add at an index)
- **The page does NOT have a `parentFolderId` field** — its attachment is entirely carried by `folder.children`. To "move" a page: remove its id from the source `folder.children` + add it to the target `folder.children`. The page itself stays intact in `pages.pages`.

## Path uniqueness — **folder-scoped, not project-scoped**

A page's public URL = concatenation of the `folder.slug` from root down to the direct parent + `page.path`. So:

- `/offres` at the root resolves to `https://site/offres`
- `/offres` in a sub-folder with slug `globex` resolves to `https://site/globex/offres`

→ **Two pages can share the same `path` as long as they are not in the same folder.** Webstudio Cloud allows it, and our MCP handlers `pages.create` / `pages.update` (rename or move) / `pages.duplicate` validate uniqueness within the target folder only.

Typical use case: a multi-brand site with `/offres` at the root (shared offers) **and** `/offres` in the `globex` folder (Globex-specific offers).

Incident resolved in v2.7.13 (real-world production build, 2026-05-22): the scan was global, which forced going through the Webstudio UI to work around it. The shared helper `findPageInFolderByPath(build, path, parentFolderId)` (in `src/tools/pages/folder-utils.ts`) now carries the rule.

## Move via `pages.update` (atomic move + rename)

`updates.parentFolderId` moves the page to another folder. Combined with `updates.path` in the same call, you get an **atomic move + rename** (1 Webstudio transaction, both ops fail or succeed as a block).

Patches emitted by a pure move:

```ts
{ op: "replace", path: ["folders", "<source>", "children"], value: [<without pageId>] }
{ op: "replace", path: ["folders", "<target>", "children"], value: [<current>, pageId] }
```

Move + rename: the 2 patches above + the standard `replace ["pages", pageId, "path"]`.

Rules:
- Same `parentFolderId` as the current one = no-op, no move patch emitted.
- Target folder must exist, otherwise `PAGE_NOT_FOUND` (cf. the error mismatch catalog documented elsewhere).
- Path uniqueness re-checked in the **target** folder (not the source) — so a move onto a folder that already contains that path = refusal.
- Home page: allowed to move (aligned with the Webstudio UI).

### Create a folder (`pages.create_folder`)

Recurring use case: structuring the navigator of a multi-brand site into one folder per brand (e.g. `acme`, `globex`, `umbrella`) before placing the model pages in them.

`pages.create_folder` transaction (two patches):

```ts
{
  payload: [{ namespace: "pages", patches: [
    { op: "add", path: ["folders", "<newFolderId>"], value: { id, name, slug, children: [] } },
    { op: "replace", path: ["folders", "<parentFolderId>", "children"], value: [...parent.children, newFolderId] },
  ]}]
}
```

Rules:
- `slug` is validated as kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`). The server refuses `"Bad Slug"`, `"UPPER"`, `"-foo"`, `"foo--bar"`. Hard fail, no silent coercion.
- **Slug uniqueness between siblings only** (mirrors the Webstudio UI): two `acme` folders under two different parents = OK. Two `acme` folders under the same parent = `VALIDATION_FAILED` rejection.
- `parentFolderId` defaults to `"root"`; to retrieve it in the hierarchy, call `pages.list_folders` first.
- Rename/move of an existing folder: not supported — `delete_folder` then `create_folder` (or direct editing in the UI).

## Delete page — tree-walker for orphans

The Webstudio builder deletes ONLY the root instance (seen in capture). If the page contained sub-instances, they would become orphans in `instances`. Our MCP does a recursive tree-walker to collect all descendants:

```ts
function collectDescendantIds(rootId, instances) {
  const collected = [];
  const visit = (id) => {
    collected.push(id);
    const inst = instances.find(i => i.id === id);
    for (const child of inst?.children ?? []) {
      if (child.type === "id") visit(child.value);
    }
  };
  visit(rootId);
  return collected;
}
```

Refusal if `pageId === build.pages.homePageId` (safety).

**TODO V2**: does NOT clean up the `props`, `styles`, `styleSourceSelections` attached to the deleted instances. Webstudio tolerates these orphans (verified), but it's dirty. To add once we have a more mature workflow.

## Refactored architecture (2026-05-08)

`src/index.ts` (600+ lines) → split into tool modules:

```
src/
  build-from-args.ts     ← StyleValueSchema + BuildFragmentSchema + buildFromArgs
  tools/
    types.ts             ← interface ToolModule + textResult helper
    build-fragment.ts
    helpers.ts
    projects.ts          ← init/list/list-tokens/define-token
    auth-tools.ts        ← setup-auth/allow-push
    push-fragment.ts
    pages.ts             ← fetch-pages + create-page + delete-page
  index.ts               ← aggregator (~50 lines, just registry + dispatch)
```

Each module exports a `ToolModule { definition, handler }`. `index.ts` aggregates them in a Map and dispatches.

## How to apply

To create a page on a project:

```ts
// 1. Auth already configured + allowPush=true on the slug
// 2. dryRun to verify the target project (returns the project's real name)
mcp.webstudio_create_page({ projectSlug, name, path, dryRun: true });
// 3. Real push
mcp.webstudio_create_page({ projectSlug, name, path, dryRun: false });
// → returns pageId + rootInstanceId
// 4. Push content into the new page:
mcp.webstudio_push_fragment({ ..., pushTo: { projectSlug, parentInstanceId: rootInstanceId } });
```

To delete:
```ts
mcp.webstudio_delete_pages({ projectSlug, pageIds: [pageId], dryRun: false });
// Skips the home page and any not-found page, reporting the reason per item
```
