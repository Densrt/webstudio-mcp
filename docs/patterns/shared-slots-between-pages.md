---
name: Shared Slots between pages — Header/Footer multi-pages via DAG
description: Share the same Slot content (Header, Footer, Cookie banner, Newsletter signup) across N pages of a site. The Webstudio tree is a DAG — one child instance can be referenced by several parent Slot wrappers via children:[{type:"id",value:<sharedId>}]. Editing one side propagates everywhere. Distinct from instances.clone / clone_subtree (independent copy with new IDs).
category: workflow
complexity: medium
lastUpdated: 2026-05-22
recommendedTool: instances.share_slot_to_page
recommendedToolNote: Creates a new Slot wrapper on each target page pointing to the same shared child. Idempotent. Default = append to the page rootInstance.
---

# Shared Slots between pages — Header / Footer across pages

## TL;DR

Webstudio natively supports sharing a Slot across several pages — editing one side propagates everywhere. This is the mechanism to use for elements common to the whole site (Header, Footer, Cookie banner, Newsletter signup, etc.).

- **Tool**: `instances.share_slot_to_page`
- **Mechanism**: DAG (Directed Acyclic Graph) — one child instance can be referenced by N parents
- **vs `instances.clone` (clone_subtree)**: clone duplicates (new IDs, independent — whether the atomic, targetAnchor, or targetAnchors form). `share_slot_to_page` shares (same IDs, propagation).

## How it works technically

Webstudio's `instances[]` is a graph:

```
Home page rootInstance
  └── Slot wrapper id=<wrap_A> label="Header Slot"
        children: [{ type:"id", value:"<shared_header_root>" }] ─┐
                                                                 │
Contact page rootInstance                                        │
  └── Slot wrapper id=<wrap_B> label="Header Slot"               │
        children: [{ type:"id", value:"<shared_header_root>" }] ─┤
                                                                 │
Offres page rootInstance                                         │
  └── Slot wrapper id=<wrap_C> label="Header Slot"               │
        children: [{ type:"id", value:"<shared_header_root>" }] ─┤
                                                                 ▼
                       ┌────────────────────────────────────────────┐
                       │ <shared_header_root> (exists 1× in build) │
                       │   ├── nav links, logo, ...                 │
                       │   └── unique styleSourceSelection          │
                       │       props, styles shared via this id     │
                       └────────────────────────────────────────────┘
```

**3 distinct Slot wrappers** (one per page, each with its own id) but **all point to the same child instanceId**. Modify that child → the change shows on all 3 pages instantly, with no additional action.

## When to use

| Situation | Tool |
|---|---|
| Header reused on every page of the site | **share_slot_to_page** |
| Footer reused on every page | **share_slot_to_page** |
| Global cookie banner / newsletter signup | **share_slot_to_page** |
| Bento section copied from a reference page to other pages with independent tweaks | `instances.clone` with `targetAnchors:[...]` (multi-page copy) |
| Creating a variant of the same header (e.g. a different logo per brand) | `instances.clone` with `targetAnchor` (copy 1 page, then local edits) |
| Creating an empty Slot to fill in manually later | append component:"Slot" |

## Canonical workflow — onboarding a new page

```
1. The Home page already contains the Header Slot (source id) and the Footer Slot.

2. Create the new page (Offers, About, Brands, etc.):
   pages.create({projectSlug, name:"About", path:"/a-propos"})
   → returns { pageId, rootInstanceId }

3. Share Header:
   instances.share_slot_to_page({
     projectSlug: "<project>",
     sourceSlotInstanceId: "<header-slot-id-from-home>",
     targetPagePaths: ["/a-propos"],
     dryRun: false
   })

4. Share Footer:
   instances.share_slot_to_page({
     projectSlug: "<project>",
     sourceSlotInstanceId: "<footer-slot-id-from-home>",
     targetPagePaths: ["/a-propos"],
     dryRun: false
   })

5. Build the page-specific content of the new page (between Header and Footer)
   via build.push_fragment or build.push_complete.
```

**Batch across several pages in one call**:

```
instances.share_slot_to_page({
  projectSlug: "<project>",
  sourceSlotInstanceId: "<header-id>",
  targetPagePaths: ["/offres", "/contact", "/a-propos", "/marques"],
  dryRun: false
})
```

→ Creates 4 Slot wrappers (one per target page) in a single atomic transaction. Already-connected pages are silently skipped (idempotence).

## ❌ Anti-pattern — `instances.clone` (any form) for Slots

```
// ❌ DO NOT DO THIS to share a Header
instances.clone({
  projectSlug,
  sourceInstanceId: "<header source>",
  targetAnchor: { pagePath: "/offres", label: "main" },
  mode: "append",
})
```

`clone` (whether `targetInstanceId`, `targetAnchor`, or `targetAnchors`) **duplicates** the subtree with **new IDs**. Consequences:
- The two Headers (Home and Offres) are now **independent**
- Editing the Home Header → **does NOT show up** on Offres
- You have to maintain 2 separate versions that diverge over time
- It needlessly bloats the content in `instances[]`

**Regret indicator**: if you find yourself editing the same nav menu N times across N pages, you cloned instead of sharing. Solution: delete the clones and use `share_slot_to_page` instead.

## ❌ Anti-pattern — `append` component:"Slot"

```
// ❌ DO NOT DO THIS to reuse existing content
instances.append({
  projectSlug,
  parentInstanceId: targetPageRoot,
  component: "Slot",
  tag: "div",
  label: "Header Slot"
})
```

→ Creates an **empty** Slot, with no content, disconnected from everything. You end up with a useless wrapper. To reuse an existing Header: `share_slot_to_page`.

## Real case — multi-page site (2026-05)

Starting state (DAG already connected via the UI builder on 2 pages, 3rd to finalize):

| Page | rootInstanceId | Slot Header wrapper | Slot Footer wrapper |
|---|---|---|---|
| `/` (Home) | `<root_home>` | `<wrapper_header_home>` | `<wrapper_footer_home>` |
| `/contact` | `<root_contact>` | `<wrapper_header_contact>` | `<wrapper_footer_contact>` |
| `/offres` | `<root_offres>` | `<wrapper_header_offres>` | _(not yet connected)_ |

Shared children referenced by the wrappers:
- `<shared_header_root>` (label "Header") — referenced by the 3 Header wrappers
- `<shared_footer_root>` — referenced by the 2 Footer wrappers

Reproduction via the MCP tool:

```
instances.share_slot_to_page({
  projectSlug: "<project>",
  sourceSlotInstanceId: "<wrapper_footer_home>",  // Footer Slot from Home
  targetPagePaths: ["/offres"],
  dryRun: false
})
```

Result: a new Slot wrapper created on `/offres` pointing to `<shared_footer_root>`. Edit the footer on Home → visible on `/offres` instantly.

## Edge cases handled

| Case | Behavior |
|---|---|
| Source is not a Slot | `VALIDATION_FAILED` with hint "use instances.clone (clone_subtree) if you want a copy" |
| Empty source Slot (0 child) | `VALIDATION_FAILED` "populate the source via UI builder first" |
| Multi-child source Slot (≥2) | `VALIDATION_FAILED` "Webstudio Slots hold exactly 1 root child" |
| Target page does not exist | outcome `error: "page not found"` |
| Target parent not in target page | outcome `error: "parent not in page"` |
| Target already connected to the shared child | outcome `skipped: "already shared (idempotent)"` |
| Self-share (target = source page rootInstance) | outcome `skipped` |
| Partial multi-page batch | mixed outcomes per target — the atomic transaction only includes the ok ones |

## Safety — editing the shared child

When you edit the content of a shared child (`<shared_header_root>` for example):
- **All pages** are affected simultaneously
- `read.inspect` on the child shows its unique content
- `instances.update_text`, `styles.update`, `instances.append`, etc. work normally — the change is written once and visible everywhere

To **break the sharing** on a specific page (create a local variant):

```
1. instances.clone with targetInstanceId (from the same page onto itself
   with an anchor on the slot child)
   → creates an independent copy
2. Replace the local Slot wrapper's children with the id of the copy
   (via instances.prop_update on the Slot wrapper — TODO: dedicated tool if recurrent)
```

## Rules recap

1. **Multi-page shared Slot** = DAG, the child appears once but is referenced N times.
2. To share: `instances.share_slot_to_page` (DAG, propagation).
3. To duplicate: `instances.clone` with `targetAnchor` or `targetAnchors` (multi-page copy, independent).
4. To create an empty Slot: `instances.append` component:"Slot".
5. **Default behavior** on all Webstudio sites: Header + Footer as a Slot shared across every page, created once on the Home and `share_slot_to_page` on each new page.
6. Idempotent: re-running the same command does not create a duplicate, just a silent skip.
