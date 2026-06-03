---
name: Reset global margins on p / h1-h6 via a single HtmlEmbed
description: Avoid re-pasting `margin: 0` on every Text/Heading instance — drop one HtmlEmbed at the body root with a global reset. Cleaner local styles, guaranteed consistency.
category: component
complexity: simple
lastUpdated: 2026-05-20
recommendedTool: build.push_fragment
recommendedToolNote: drop one HtmlEmbed at body root with p/h1-h6 margin reset
---

# Reset global margins (p, h1-h6)

## The problem

Browsers ship default margins on `<p>`, `<h1>`–`<h6>` (typically `1em` top/bottom). Webstudio's default styles inherit these. Result: every `Text` and `Heading` instance has visible vertical spacing you didn't ask for.

The instinctive fix — set `margin: 0` as a **local style** on each Text/Heading — works but:
- Pollutes the local-styles namespace (50+ instances × 4 margins each = 200+ local decls)
- Diverges over time (someone adds a Heading and forgets the reset)
- Defeats the point of a design system (margin should be a token, not a per-instance override)

## The pattern

Drop **one** `HtmlEmbed` at the body root with a global reset:

```html
<style>
p, h1, h2, h3, h4, h5, h6 {
  margin: 0;
}
</style>
```

Done. All headings/paragraphs across the project now have zero default margin. Layout-driven gaps (flex/grid `gap`, padding on parents) take over — which is the correct Webstudio idiom anyway.

## Where to place the HtmlEmbed

| Scope desired | Location |
|---|---|
| Whole project (recommended) | `body` instance (root of every page) |
| Single page only | Page-level `body` instance |
| Section only | Closest parent of the affected Text/Heading instances |

Put it at the very first child position so it's parsed before any Text/Heading renders. Visually it's empty (`<style>` tag), so order doesn't affect layout.

## Why this is better than per-instance overrides

1. **Single source of truth** — change "all paragraphs have 0 margin" by editing one HtmlEmbed.
2. **Zero local-style pollution** — `webstudio_audit_local_styles` returns a much cleaner report.
3. **Future-proof** — new Text/Heading instances inherit the reset automatically.
4. **Webstudio-native** — HtmlEmbed is a first-class component; `<style>` inside it is honored by SSR.

## Companion patterns

If you want margins on SOME paragraphs (e.g. articles), use tokens or a class:

```html
<style>
p, h1, h2, h3, h4, h5, h6 { margin: 0; }
.prose p { margin-bottom: 1em; }
.prose h2 { margin-top: 2em; }
</style>
```

Then add `class="prose"` to the article wrapper via `update_instance_prop`. One override location, scoped.

## Verified on

Single-brand + production projects (2026-04 to 2026-05).
