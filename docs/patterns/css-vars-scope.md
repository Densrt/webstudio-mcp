---
name: Pattern — where to place CSS variables (:root vs body scope)
description: A recurring architecture decision on Webstudio projects. Single-brand (one identity) vs multi-brand (several brands under one corporate identity). Validated internally 2026-05-08.
category: workflow
complexity: medium
lastUpdated: 2026-05-20
recommendedTool: cssvar.define
recommendedToolNote: multi-brand: scope custom properties to body[data-brand]; single-brand: :root
---

# CSS variables: where to place them in Webstudio

**An architecture decision that recurs on every project.** Validated internally on 2026-05-08 on a test project.

## Webstudio exposes 2 scope levels

| Level | Component | ID | Reach |
|---|---|---|---|
| **Global root** | `ws:root` | `:root` (constant) | All pages of the project |
| **Page root** | `ws:element` (body) | The page's `<rootInstanceId>` | This page only |

`:root` does NOT appear in `build.instances` (managed implicitly by Webstudio), but you can attach a `styleSourceSelection` to it directly via the path `[":root"]`.

## Archetype 1 — Single-brand project

One identity, no per-section variations.

```
:root (Global root)
├── --color-bg-page: ...
├── --color-text-primary: ...
├── --font-family-primary: ...
└── ...
```

**Rules:**
- All CSS vars go in `:root`, full stop.
- **No need for an intermediate token** like "Theme / Colors" — `:root` hosts the definitions directly
- Semantic tokens (`color-bg-page`, `text-primary`) are optional: you can use `var(--color-bg-page)` directly in instance styles
- A single cascade level, simple and readable

## Archetype 2 — Multi-brand project

The site sells several brands (e.g. Brand-A + Brand-B + Brand-C). Each brand has its own identity, but the site also has its own identity (header, footer, legal notices).

```
:root (Global root)                  ← Site identity
├── --color-brand-primary            (the site's corporate colors)
├── --color-brand-secondary
├── --font-family-primary
├── --color-header-bg
└── ...

  body of /pages/<brand-a>/*         ← Brand-A identity override
  ├── --color-bg-page (Brand-A)
  ├── --color-text-primary (Brand-A)
  └── ...

  body of /pages/<brand-b>/*         ← Brand-B identity override
  ├── --color-bg-page (Brand-B)
  └── ...
```

**Rules:**
- `:root` hosts ONLY the vars common to the site (header, footer, legal, corporate identity)
- The vars **specific to each brand** go on the `body` (rootInstanceId) of that brand's pages
- Natural cascade: the brand overrides the site for colliding vars
- You can use a "Theme / Colors <Brand>" token attached to the body — but it is not required (you can put the vars in a local on the body directly)

**Why this pattern:**
- Adding a new brand = you don't duplicate everything, you just override the brand vars
- Shared components (the site header) stay identical on every page
- A brand header can still pull from the site's `var(--color-brand-primary)` if needed

## Mapping archetypes ↔ projects

| Archetype | When to use it |
|---|---|
| **Single-brand** | A single identity (single-brand company, association, institutional site). Everything in `:root`. |
| **Multi-brand** | A site that distributes several brands. `:root` for the site identity + per-brand body sections. |
| **Test / dev** | The multi-brand pattern, to validate the workflow before production. |

## How to apply via MCP

### For global vars (`:root`)

```js
// No need to look up a rootInstanceId — use ":root" literally
const ROOT = ":root";
// styleSourceSelection.path = [":root"]
// styles.path = "<sourceId>:<bpId>::<--var-name>"
```

### For page-scoped vars

```js
// The page's rootInstanceId (obtainable via fetch_pages.rootInstanceId)
// The body created by create_page is that rootInstanceId
```

### When to create an intermediate token?

- **Single-brand** → no, vars directly on `:root`
- **Multi-brand, site-level vars** → optional for the site vars (a "Site identity" token on `:root`), often unnecessary
- **Multi-brand, brand-level vars** → optional but useful when you want to reuse the full set across several pages of the same brand (e.g. `/<brand-a>/cat-1`, `/<brand-a>/cat-2`, `/<brand-a>/cat-3` all share the Brand-A vars via the token on their body)
