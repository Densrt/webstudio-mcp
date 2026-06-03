---
name: Project-level meta — head Custom Code + branding fields
description: How to read and write the project-level meta block (head Custom Code, siteName, contactEmail, faviconAssetId, socialImageAssetId) — the "Project Settings" page in the Webstudio builder.
category: workflow
complexity: simple
lastUpdated: 2026-05-28
recommendedTool: pages.update_meta
recommendedToolNote: Use pages.update_meta to init a fresh project's head Custom Code + branding in one call (idempotent, dryRun by default)
---

# Project-level meta — head Custom Code + branding fields

Webstudio stores a per-project meta block (separate from per-page meta) that drives the global `<head>` injection on every page of the published site, plus a few branding fields surfaced in the dashboard. Before v2.10 there was no MCP surface for these fields — they had to be filled by hand in the builder, which broke any "init a project from scratch via code" workflow.

This pattern is what the new `pages.get_meta` + `pages.update_meta` actions cover and how to use them.

## Storage

In the **build object**: `build.pages.meta.<field>`

In the **patch system** (namespace `"pages"`): path is `["meta", "<field>"]` — relative to `build.pages`, not absolute. The first segment is NOT `"pages"`; that prefix would target `build.pages.pages.meta.field` and `build.pages.pages` is the page ARRAY, not an object with meta (bug 2026-05-28).

| Field | Purpose | Type | Encoding |
|---|---|---|---|
| `code` | Head Custom Code blob — typically GTM, Consent Mode v2, JSON-LD (Organization / LocalBusiness / Article…), preconnect/dns-prefetch, polyfills | string | literal (no JSON-stringify wrapping) |
| `siteName` | Used in `og:site_name` + fallback `<title>` | string | literal |
| `contactEmail` | Project-level email referenced by Organization schema, mailto fallbacks, footer links | string | literal |
| `faviconAssetId` | sha256 of an asset uploaded to the project. Renders the favicon | string | literal |
| `socialImageAssetId` | sha256 of an asset uploaded to the project. Default OG image (per-page `meta.socialImageAssetId` overrides it) | string | literal |

Keys are sparse: an unset field is **absent** from the meta object (not stored as `""` or `null`).

## Decision tree — project meta vs page meta

```
Where does the value belong?
│
├─ A <script>/<link>/<meta> for the WHOLE site (every page) → project.code
│   • GTM container, Consent Mode v2, Analytics
│   • JSON-LD Organization / LocalBusiness / MotorcycleDealer / etc.
│   • preconnect / dns-prefetch
│   • polyfills, A/B test snippets, third-party widgets
│
├─ A per-page <title>, <meta name=description>, redirect, language → page.meta
│   • Use pages.update with updates.meta.{description,language,…}
│
├─ A per-page OG image override → page.meta.socialImageAssetId
│   • Same encoding (asset id literal), but page-scoped
│
└─ A bindable expression (title bound to a variable, etc.) → use variables.bind_page_field
```

## Recipe — full project init from scratch

Typical workflow when bootstrapping a new project (e.g. after `pages.duplicate` cloned a sibling site or `project.init` created a blank one):

```
1. assets.upload  → favicon + OG image (capture the sha256 ids returned)
2. pages.update_meta({
     projectSlug,
     meta: {
       code: "<script>(...GTM container...)</script><script>(...Consent Mode v2 default...)</script><script type=\"application/ld+json\">{...JSON-LD...}</script>",
       siteName: "My Site",
       contactEmail: "contact@example.test",
       faviconAssetId: "<sha256-from-step-1>",
       socialImageAssetId: "<sha256-from-step-1>",
     },
     dryRun: false,
   })
3. pages.get_meta({ projectSlug })  // verify
```

## Recipe — append a snippet to existing head code

`code` is stored as a single blob — there is no server-side append. Do read-modify-write:

```js
const { meta } = await pages.get_meta({ projectSlug, fields: ["code"] });
const newCode = (meta.code ?? "") + "\n" + mySnippet;
await pages.update_meta({ projectSlug, meta: { code: newCode }, dryRun: false });
```

The caller owns the separator (newline) and dedup decisions — the MCP keeps no opinion. If the same agent calls this twice with the same snippet, the snippet IS duplicated. Guard upstream if needed.

## Anti-patterns

- **Copy-pasting head code via the builder when cloning a site.** Use `pages.update_meta` instead — idempotent, scriptable, leaves a telemetry trace.
- **Writing GTM into an HtmlEmbed instance dropped at page-root level.** Works but pollutes the page tree and is per-page (must be re-added on every new page). The project-level `code` blob is global and survives `pages.duplicate`.
- **Setting `socialImageAssetId` to a URL.** Webstudio's project-level field expects an asset *id* (sha256 of an asset already uploaded). For an external URL, use the per-page `meta.socialImageUrl` instead.
- **Forgetting `siteName`.** Without it, `og:site_name` falls back to the project domain, which is often a `.webstudio.is` staging URL until DNS is cut over.

## Validation enforced by the MCP

- `contactEmail`: RFC-lite regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`). Empty string allowed (clears the field semantically without removing the key).
- `faviconAssetId` / `socialImageAssetId`: must reference an asset that exists in the project's `build.assets`. Use `assets.list` to discover ids.
- `code`: passthrough (no HTML sanitisation — the caller is responsible).
- Submitting a value equal to the stored value emits no patch (idempotent).
- Submitting `null` on a field removes the key from storage.

## Telemetry keys

| Key | When |
|---|---|
| `detect:orphan-meta-asset` | `get_meta` saw a `faviconAssetId` or `socialImageAssetId` referencing an asset id absent from the project (asset was deleted but the meta wasn't cleared) |
| `write:project-meta` | `update_meta` actually emitted a patch (no-op no-ops don't log) |

## Why this lives on the `pages` mega-tool

The storage path is `["pages", "meta", …]` — same namespace as per-page meta. The diff pipeline (`fetchBuild` → `pushWithRetry` with VERSION_MISMATCHED retry) is identical. Adding a separate "project meta" mega-tool would duplicate that plumbing for 2 actions and break the locality principle. The 4-tier rule (CLAUDE.md) explicitly disqualifies new mega-tools without ≥5 actions and 3 strong reasons.
