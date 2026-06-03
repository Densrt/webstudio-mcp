---
name: Token variants vs local overrides
description: When a token + local override represents a stable variant (≥2 instances or a reusable pattern such as ghost/outline/secondary), create a dedicated variant token as an ADDITIVE OVERLAY rather than re-overriding on every instance. Validated on a production project — 2026-05-13.
category: workflow
complexity: simple
lastUpdated: 2026-05-20
recommendedTool: tokens.extract_variant
recommendedToolNote: variant token if a local override pattern is reused ≥2x (ghost/outline button)
---

# Token variants vs local overrides

**Rule:** a local override = a one-off exception, **not** a variant.

As soon as an override (or a cluster of overrides) on a token describes a **stable variant** (≥2 potential instances, or a reusable pattern such as ghost/outline/secondary/destructive), you should **extract a dedicated variant token** rather than re-override locally.

## How to detect the need

1. `webstudio_audit_token_overlap` on a token consumed by ≥2 instances → spot the shared `OVERRIDE`s or `UNIQUE`s
2. `webstudio_audit_local_styles` (`verbose:true`) → spot clusters of identical locals across ≥2 instances → missing tokens
3. `webstudio_audit_page` → label inconsistencies (≥2 instances with the same label, diverging props)

## Two strategies

### A. **Additive variant (recommended)** — overlay token

The variant token contains **only the overrides**. The base token stays applied, the variant is stacked on top.

**Advantage**: any change to the base (padding, radius, transitions…) automatically propagates to the variants.

**Example observed in production — `Button L` + `Button L Outline`**:

```text
Hero CTA Secondary tokens = [ "Button L" (base), "Button L Outline" (variant) ]
                                       │                │
                                       ▼                ▼
                          display, padding,    backgroundColor: transparent,
                          font, radius,        border 4 sides solid white,
                          transitions, hover   hover: border+color primary,
                                               hover: backgroundColor transparent
                                                       (neutralise hover base)
```

### B. **Substitutive variant (pure semantics)** — full token

The variant clones all of the base's declarations + overrides. The base token is no longer applied.

**Drawback**: duplication, base changes no longer propagate.

→ Reserve for cases where the variant diverges strongly (e.g. `Button Ghost` vs `Button L`).

## MCP workflow

```bash
# 1. Create the variant token as an additive overlay
webstudio_create_token  → define ONLY the overrides

# 2. Apply to instances (position: before-local for ordering)
webstudio_apply_token_to_instances
  tokenId: <variant>
  instanceIds: [...]
  coveredPropsCleanup: auto-dedupe
  position: before-local

# 3. If residual overrides (JSON structures differ, e.g. transitionDuration as var vs layers[var]):
webstudio_delete_local_style_decl  → explicit per (instanceId, property, state)

# 4. Audit final
webstudio_audit_token_overlap  → 0 DUPE · 0 OVERRIDE
```

## Pitfalls encountered

1. **Neutralizing the inherited hover** — if the base defines `backgroundColor::hover: primary-opacity-80`, the outline variant must **explicitly** override with `backgroundColor::hover: transparent`. Otherwise the primary hover fires on the outline → color flash.

2. **`update_token_styles` + `unparsed` values for transitions** — `transitionDuration` and `transitionTimingFunction` do not accept `{type:"unparsed", value:"var(...)"}` as source. You need the explicit layers format:
   ```json
   {"type":"layers","value":[{"type":"var","value":"brand-transition-fast"}]}
   ```
   Otherwise the MCP falls back to the default value (0s, ease) **silently**.

3. **`audit_token_overlap` classes as `UNIQUE` the declarations covered by ANOTHER token** — the audit is single-token. If a declaration is in the additive variant, it shows up as UNIQUE relative to the base token. This is cosmetic, not a problem.

4. **`dedupe_token_locals` does not always match hovers** — when a `borderTopColor::hover` declaration is strictly identical between token and local but stays classed as UNIQUE, fall back to an explicit `delete_local_style_decl` with `state: ":hover"`.

## Decision heuristic

| Case | Action |
|---|---|
| 1 instance with 1 override | local OK (one-off case) |
| 1 instance with 5+ overrides | suspect an upcoming variant → prepare the token when a 2nd instance appears |
| ≥2 instances with the same overrides | **variant token** (additive if overrides are a minority, substitutive if a majority) |
| Recurring pattern across ≥2 differently-named components but with identical declaration clusters | **component token** (e.g. `USP Card`, `Icon Box`, `Section Page`) |

## Measured result (a production project, home page)

- 679 → 531 local declarations (**-22%**)
- 7 new tokens: Button L Outline, Section Page, USP Card, Icon Box, Burger Bar, Slide Title, Slide Description
- 7 enriched tokens: Button L, Titre H1/H2/H3, mega-menu Trigger, Sub-link (drawer), Collapsible TOC (drawer), Flat link (drawer)
