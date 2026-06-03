---
name: Cross-page section cloning — atomic / single-page anchor / multi-page batch
description: Decision tree for cloning a section from one page to one (or several) other pages — atomic via instanceId, single-page via targetAnchor, multi-page batch via targetAnchors. Mandatory workflow create page → append anchor → clone_subtree. Covers the "missing anchor on a brand-new page" UX pitfall (real case 2026-05-26) AND the includeSource duality (children only vs whole section, real case 2026-05-26).
category: workflow
complexity: medium
lastUpdated: 2026-05-26
recommendedTool: instances.clone_subtree
recommendedToolNote: instances.clone_subtree accepts 3 target forms (targetInstanceId, targetAnchor, targetAnchors) AND 2 source scope modes (includeSource:false=children only by default, includeSource:true=whole section). A newly created page has NO anchor by default — you must add one via instances.append before cloning.
---

# Cross-page section cloning

## Decision tree — which `clone_subtree` form?

| Need | Form | When |
|---|---|---|
| Clone a section to a precise location whose instanceId you already know (same build) | `targetInstanceId` (atomic) | A workflow where you just listed/inspected the target right before. The fastest (1 fetch, 1 push). |
| Clone a section to ONE page identified by an anchor label | `targetAnchor: { pagePath, label }` | A workflow like "add the template hero to this new page". More stable than `targetInstanceId` because the main's instanceId can change between sessions. |
| Clone a section to N pages at once (template → derived pages) | `targetAnchors: [{...}, ...]` | Multi-page regeneration (location-1, location-2, ...). Per-target refetch+retry built in, non-fatal skips. |

## Modes

- **`append`** (default) — inserts at the end of the existing children. The most frequent case: "add a section below the ones already there".
- **`prepend`** — inserts at the start. Useful for pushing a hero above existing content.
- **`replace`** — removes the existing children before inserting. The regenerated-template case (the old sections drop).

> **Pitfall**: `replace` is **destructive** on the target anchor's children. If the target page already has 2 sections under its `<main>` and you clone with `mode: "replace"`, **both sections are lost**. Always check the mode before `dryRun: false`.

## Clone scope: `includeSource` (real case 2026-05-26)

`clone_subtree` has two mutually exclusive source-scope semantics:

| Flag | What does the tool copy? | When to use it |
|---|---|---|
| **`includeSource: false`** (default) | Only the **CHILDREN** of `sourceInstanceId`. The source wrapper itself is NOT cloned. | "Fill a template container": copy the contents of one `<main>` into another `<main>`. The typical case of the multi-page workflow (regenerating N pages from a template). Used by default by the legacy `clone_page` wrapper. Compatible with `skipChildLabels`. |
| **`includeSource: true`** | `sourceInstanceId` is included as the **ROOT** of the cloned subtree. | "Clone a specific section to another page": copy a whole Hero `<section>` (wrapper + its children) under a target `<main>`. This is the natural meaning of the name `clone_subtree`. **Incompatible with `skipChildLabels`** (ambiguous semantics → validation error). |

> **Real case 2026-05-26**: an agent wanted to clone a Hero section from `/contact` to `/services`. It passed `sourceInstanceId = <Hero_Contact>` + `targetAnchor = main of /services`, expecting to copy the complete section. But without `includeSource: true`, the tool cloned only the Hero's children (Deco Left, Deco Right, Inner Container) under the target `<main>` — **without the Hero `<section>` wrapper**. Broken layout. Fix v2.9.2: the flag makes the duality explicit.

## Mandatory workflow: new page + cloned section

A page created via `pages.create` has an **empty** body (no `<main>` or any other anchor). Cloning via `targetAnchor` fails with `target anchor not found` until you create the anchor manually.

### Case A — Fill a container with the contents of another (multi-page template)

```ts
// 1. Create the new page
const { rootInstanceId } = await pages.create({
  projectSlug: "p", name: "North Location", path: "/north-location",
});

// 2. Add the anchor <main label="Main"> on the new page
await instances.append({
  projectSlug: "p",
  parentInstanceId: rootInstanceId,
  component: "ws:element", tag: "main", label: "Main",
});

// 3. Clone THE CONTENTS of the template <main> into the new <main>
//    (sections, layout, all without the template's <main> wrapper — our new main already contains it)
await instances.clone({
  projectSlug: "p",
  sourceInstanceId: "<main_template_instanceId>",   // the <main> of the template page
  targetAnchor: { pagePath: "/north-location", label: "Main" },
  mode: "replace",
  // includeSource: false   ← default, we copy the CHILDREN of the template <main>
});
```

### Case B — Clone a specific section to an existing page

```ts
// 1. The /services page already exists with a <main label="Main"> (created via Case A or directly)
// 2. Clone the Hero from /contact to /services (WHOLE section, wrapper included)
await instances.clone({
  projectSlug: "p",
  sourceInstanceId: "<Hero_Contact_instanceId>",    // the Hero <section> of /contact
  targetAnchor: { pagePath: "/services", label: "Main" },
  mode: "append",
  includeSource: true,    // ← includes the Hero <section> as the clone root
});
```

Result: the `<main>` of `/services` receives a new `<section>` Hero entry (with its Deco Left, Deco Right, Inner Container intact inside). This is what you want when you say "clone a section to a page".

### Why is `instances.append` (step 2 of Case A) mandatory for a brand-new page?

- `pages.create` does not scaffold an anchor by default (intentional — popup pages, custom layouts, slots; some projects don't use `<main>`).
- `clone_subtree` does not create a missing instance (separation of concerns: it copies, it does not structure).
- The calling agent explicitly decides the semantic tag and the label.

## ❌ Anti-pattern A: using `instances.clone` (atomic) cross-page without thinking

```ts
// 🚫 works by accident, but semantically incorrect
instances.clone({
  sourceInstanceId: "hero_of_page_a",
  targetInstanceId: "main_of_page_b",   // instanceId of another page
  mode: "append",
});
```

Why this is bad:
- The instanceId of a `<main>` can change (page re-creation, wrapper recreation). The workflow breaks silently.
- No refetch between pushes if you chain several cross-page ops → versioned race condition.
- No per-target outcome report if you loop on the caller side.

→ **Prefer `targetAnchor: { pagePath, label }`.** More stable, more readable, handles the refetch.

## ❌ Anti-pattern B: `clone_page` (deprecated v2.9.0)

`instances.clone_page` still works but has two limitations:
- Mode hardcoded to `replace` → silently overwrites the target's existing content.
- Keeps the old `sourcePagePath` / `targetPagePaths` / `anchorLabel` parameters — surface duplication with `clone_subtree`.

→ **Migrate to `clone_subtree` with `targetAnchors[]` + an explicit `mode`.** A `detect:clone-page-deprecated-usage` telemetry measures the remaining calls.

## Common errors and remediations

| Error | Cause | Remediation |
|---|---|---|
| `target anchor not found on "/x" (label="Main")` | The page exists but has no instance with that label. | Add the anchor: `instances.append({ parentInstanceId: <rootInstanceId>, component: "ws:element", tag: "main", label: "Main" })`. Then re-run. |
| `Source instance "..." not found` | sourceInstanceId is stale (re-creation) or copy-pasted wrong. | Re-list via `instances.list` or `read.inspect` on the source page. |
| `Provide exactly one of: targetInstanceId, targetAnchor, targetAnchors` | No target form provided. | Choose ONE of the 3 forms per the decision table above. |
| `Provide ONLY one of: ... (mutually exclusive)` | Two forms provided at once. | Remove the one you are not using. |
| `Cannot combine includeSource:true with skipChildLabels` | Ambiguous semantics: either you clone the whole subtree, or you filter the top-level children — not both. | Choose: `includeSource:true, skipChildLabels:[]` (clone whole section) or `includeSource:false, skipChildLabels:[...]` (filter the children). |
| Incomplete target layout (section wrapper missing after clone) | Likely `includeSource:false` (default) where the agent meant to clone the whole section. | Re-run with `includeSource: true` to include the source wrapper as the clone root. |

## Observed telemetry

- `detect:clone-page-missing-anchor` — incremented when a caller passes `targetAnchor` or `targetAnchors` on a page that has no matching anchor. A "forgotten scaffold step" indicator.
- `detect:clone-page-deprecated-usage` — incremented on every `clone_page` call. A "callers to migrate" indicator.

## Cited real case

**2026-05-26** — a UX incident on a production project: the workflow "create a new page then clone the hero of an existing page". The error `target anchor lost on refetch` did not indicate the remediation (manually create the `<main>` "Main" on the target page). The caller fell back to atomic `instances.clone` (accidental cross-page) instead of `clone_subtree` with `targetAnchor`. Fix v2.9.0: unification of the two tools, an actionable error message with a hint pointing to `instances.append`, and a dedicated pattern doc (this document).

## Related

- `page-management.md` — decision tree create / duplicate / clone / share_slot
- `shared-slots-between-pages.md` — DAG share vs clone (Header/Footer)
- `component-architecture.md` — local vs token (orthogonal but useful for understanding the cost of a cross-token `replace`)
