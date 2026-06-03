---
name: Component architecture — CSS vars vs tokens vs local styles
description: Decision tree + anti-patterns for where styles live. CSS vars = primitives (10+ reuse). Tokens = complete components. Locals = one-off overrides only.
category: architecture
complexity: medium
lastUpdated: 2026-05-20
recommendedTool: (read FIRST — decision tree)
recommendedToolNote: CSS vars vs tokens vs locals — read before any push_fragment with new components
---

# Component architecture: CSS vars vs tokens vs local styles

The three places where styles can live in a Webstudio project, and the rule for picking the right one. Misuse compounds: a wrong choice gets copy-pasted across N instances and pollutes the design system. This pattern fixes that.

Observed in production on `<template-project>` (2026-05-20) — concrete anti-patterns below come from that audit.

## Decision tree

```
Need to apply a style value?
│
├─ Is it a PRIMITIVE of the design system (brand color, spacing scale, base typo)
│  AND reused 10+ times across the site?
│  → CSS var on :root (cssvar.define)
│
├─ Is it a COMPONENT's full visual identity (button, card, badge, h1 typo, …)
│  AND reused 2+ times?
│  → Token (tokens.create_tokens / tokens.update_token_styles)
│
└─ Is it a ONE-OFF override on a single instance (1 button slightly wider on 1 page)?
   → Local style on the instance (styles.update)
```

Default bias: **create the fewest CSS vars possible**. Most values belong in a token, not a var.

## Rule 1 — CSS vars are universal primitives only

A CSS var (`--brand-primary`, `--space-m`) exists only if:
1. It's a **primitive** of the design system (brand color, spacing/padding scale, base typo scale).
2. It's **reused 10+ times** across the site.

Do NOT create a var for:
- The height of one specific component (`--card-height: 600px` used in 2 places). Put it in a token or local.
- A one-off color (`--hero-overlay: rgba(...)` used once). Local.
- A padding value applied to one section. Local or component token.

## Rule 2 — A token contains a COMPLETE component

A token (`StyleSource type="token"`) carries **all the decls** that define a reusable component: layout + spacing + decoration + typo + effects. Typical button token: 25–30 decls (font + padding + bg + border + radius + backdrop + color).

Exception — **pure typo tokens** (`Titre H1`, `Texte M`) carry only font-* + `margin: 0`. They apply to `<h1>`/`<p>` whose positioning comes from the parent.

## Rule 3 — Local styles are punctual overrides ONLY

A local decl on an instance handles **one specific case** (one button wider on one page). If you find yourself pushing N identical local decls on 2+ instances → that's a token waiting to exist. Refactor:

1. `tokens.create_tokens` (or `tokens.update_token_styles` to enrich an incomplete token).
2. `tokens.attach_token` on the matched instances.
3. `tokens.dedupe_locals` to strip the now-redundant local decls.

## Rule 4 — No wrapper instance for text

To put text inside a `<a>`, `<button>`, `<span>` — insert directly via `children: [{ type: "expression", value: "\"Mon texte\"" }]` (a string literal as an expression). Do NOT create `Link > Box > Span` chains unless you need genuinely different semantics (icon + label, two distinct styled fragments).

Since v2.3.2, `instances.update_text` accepts adding the first child on an empty instance.

## Anti-patterns

### A — Poor token + duplicated local decls

**Wrong** — token `Acme Bouton Italic` with only 5 decls (`fontFamily`, `fontWeight`, `fontStyle`, `fontSize`, `margins=0`); then 25 layout/spacing/border/radius/backdrop/color decls pushed as **local** on each of 2 Link instances.

Result: 50 duplicated local decls across 2 buttons. Scale to 20 buttons → 500 repeats. The token is doing 1% of its job.

**Right** — migrate the 25 button decls **into the token**:

```jsonc
// tokens.update_token_styles
{
  "action": "update_token_styles",
  "label": "fill-btn-italic",
  "projectSlug": "<template-project>",
  "tokenName": "Acme Bouton Italic",
  "updates": [
    { "property": "paddingLeft",  "value": { "type": "unit", "value": 32, "unit": "px" } },
    { "property": "paddingRight", "value": { "type": "unit", "value": 32, "unit": "px" } },
    { "property": "backgroundColor", "value": { "type": "rgb", "alpha": 1, "r": 0, "g": 0, "b": 0 } },
    { "property": "borderTopLeftRadius", "value": { "type": "unit", "value": 999, "unit": "px" } }
    // … etc, all 25 decls
  ]
}
```

Then `tokens.dedupe_locals` on the 2 button instances → 50 local decls collapse to 0. A 21st button = attach the token, done.

### B — CSS var for a one-off value

**Wrong** — `--acme-card-height: 600px` defined on `:root`, used by 2 card instances on one page.

**Right** — value lives in the component token `Acme Card` (if you'll have 2+ cards), or directly local on the 2 instances. No `:root` var.

### C — Wrapper Link > Box > Span for a button

**Wrong** — 3 instances:

```jsonc
{ "id":"l", "component":"Link",  "tag":"a",    "children":[{"type":"id","value":"b"}], "label":"Btn link" }
{ "id":"b", "component":"Box",   "tag":"div",  "children":[{"type":"id","value":"s"}], "label":"Btn wrapper", "styles":[ /* 20 layout decls */ ] }
{ "id":"s", "component":"Text",  "tag":"span", "children":[{"type":"text","value":"En savoir plus"}], "label":"Btn label", "tokenSelections":[/* typo token */] }
```

**Right** — 1 instance:

```jsonc
{
  "id": "btn",
  "component": "Link",
  "tag": "a",
  "label": "Btn link",
  "children": [{ "type": "expression", "value": "\"En savoir plus\"" }],
  "props": [{ "type": "string", "name": "href", "value": "/contact" }],
  "tokenSelections": ["tok_acme_bouton_italic"]
}
```

One instance carries the token (full styles) + props (href) + text expression. No wrapper. No span.

## Pre-push checklist

Before `build.push_fragment`, verify:

1. **Every CSS var I'm referencing is reused 10+ times site-wide.** Otherwise inline the value or move it into a token.
2. **Every styled component (button, card, badge, …) has a complete token attached.** If I'm pushing more than ~5 local decls on a styled element, a token is missing.
3. **No two instances in the fragment share an identical block of local decls.** Identical locals = missing token.
4. **No text-only wrapper instances (Box > Span containing just a string).** Use `{ type: "expression", value: "\"…\"" }` on the parent's children.
5. **After attaching a token to N instances, I have a `tokens.dedupe_locals` step planned.** Otherwise stale locals shadow the token.

## See also

- `tokens-variants-vs-overrides` — when to extract a variant token (hover/focus) vs add a local breakpoint override.
- `css-vars-scope` — where vars are scoped (project vs page) and how `var()` resolves.
- `architecture-tokens` — registry / IDs / sync workflow for the local tokens.json.
