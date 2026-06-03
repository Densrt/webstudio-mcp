---
name: HtmlEmbed CSS injection — ad-hoc Webstudio stylesheet
description: The HtmlEmbed component is de facto a Webstudio project's emergency stylesheet. When to use it, when to avoid it, and why it's sometimes the only way to set a critical rule.
category: workflow
complexity: medium
lastUpdated: 2026-05-20
recommendedTool: build.push_fragment (HtmlEmbed)
recommendedToolNote: last-resort stylesheet — use sparingly when no panel option exists
---

# HtmlEmbed CSS injection — ad-hoc Webstudio stylesheet

**Why**: Webstudio generates atomic hash classes (`.w-abc123`) from the Style Panel. These classes are regenerated at build and can disappear on React re-render (className pollution case on Radix asChild — see pattern `sheet-mobile-radix`). The `HtmlEmbed` component accepts CSS via a `<style>...</style>` in the `code` prop — it's the only clean way to set rules **that always survive**, to target literal classes, or to inject `@keyframes`/`@media`/`@supports`/`@font-face`.

## When to use HtmlEmbed for CSS

### 1. Radix animations (data-state)
Radix components expose `[data-state="open"]`, `[data-state="closed"]`, `[data-state="active"]` that the runtime updates. The Webstudio Style Panel handles simple states well, but the `@keyframes` required for exit animations (Radix waits for `animationend` before unmounting) are **not** definable on the Style Panel side.

```html
<style>
  @keyframes brand-slide-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  @keyframes brand-slide-out {
    from { transform: translateX(0); }
    to { transform: translateX(100%); }
  }
  [data-role="menu-content"][data-state="open"] {
    animation: brand-slide-in 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  [data-role="menu-content"][data-state="closed"] {
    animation: brand-slide-out 200ms ease-in forwards;
  }
</style>
```

See also: pattern `sheet-mobile-radix`.

### 2. Scoped CSS custom properties (hover-cascade)
A parent defines `--my-var` on its `:hover` state, the children reference `var(--my-var)` in their normal style. This technique is natively supported via the Style Panel (see pattern `hover-cascade-via-css-vars`), but when the cascade crosses several levels with conditional overrides (`@media`, `@supports`), an HtmlEmbed stays more readable:

```html
<style>
  .product-card { --card-bg: #fff; --card-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .product-card:hover { --card-bg: #fafafa; --card-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  @media (prefers-reduced-motion: reduce) {
    .product-card { transition: none; }
  }
</style>
```

### 3. Targeting surviving literal classes
The Webstudio atomic hash classes (`.w-abc123`) can be lost on re-render (see Radix asChild bug in SPA navigation). Literal classes set via the `class` prop **always** survive the `cloneElement` merge because they are part of the initial DOM.

Defensive pattern for critical rules (display, visibility, reserved dimensions):

```html
<style>
  /* Ensures the burger stays at display:flex even if the hash class is lost */
  .burger-btn { display: inline-flex; align-items: center; justify-content: center; }
  /* Ensures the desktop menu stays hidden on mobile even if Webstudio regenerates */
  @media (max-width: 767px) { .nav-desktop { display: none; } }
</style>
```

Combined with a `class="burger-btn"` prop on the Button (never on the Trigger — see pattern `sheet-mobile-radix` § Major pitfall).

### 4. Global p / h1-h6 reset
Instead of re-setting `margin: 0` on each Text/Heading instance by instance (a local style that pollutes the project), a single root HtmlEmbed is enough. See pattern `reset-margins-global`.

### 5. Animating inline SVG
When an SVG is embedded in an HtmlEmbed, its internal classes/IDs (paths, groups) are not accessible from the Style Panel. The `<style>` of the same HtmlEmbed targets them directly:

```html
<style>
  .logo-svg path.bar1 { transform-origin: center; transition: transform 300ms; }
  .logo-svg:hover path.bar1 { transform: rotate(45deg); }
</style>
<svg class="logo-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path class="bar1" d="..."/>
  <path class="bar2" d="..."/>
</svg>
```

### 6. `@font-face` with fine control
Webstudio handles fonts well via `webstudio_upload_asset` + tokens, but for `unicode-range`, `font-display: optional`, or fallback metrics (`size-adjust`, `ascent-override`), go through HtmlEmbed:

```html
<style>
  @font-face {
    font-family: 'CustomFont';
    src: url('/assets/custom.woff2') format('woff2');
    font-display: optional;
    unicode-range: U+0000-00FF;
    size-adjust: 105%;
  }
</style>
```

## Anti-patterns (DO NOT do)

- ❌ **Reproduce with HtmlEmbed what the Style Panel already does well.** Static colors, paddings, font-sizes stay in the instance styles — that is editable visually and linked to the tokens.
- ❌ **Reinvent a design system in embedded CSS.** Webstudio tokens + project CSS vars are editable visually and propagated. A homemade system in HtmlEmbed becomes invisible to audits (`webstudio_audit({ kind: "token-usage" })` does not see it).
- ❌ **Inject JS via `<script>` in the same HtmlEmbed** without `executeScriptOnCanvas: false` — the script executes in the builder on every selection of the instance and can break the canvas. See the § Bonus below.
- ❌ **`!important` everywhere** to beat the hash classes. When you need `!important`, it often means you have another specificity problem — look first for the right `update_styles` in the right place.
- ❌ **Embedded CSS that depends on a fragile selector** (`.section:nth-child(3) > div > h1`). These selectors break at the slightest rearrangement of the tree in the builder. Prefer literal classes (`class` prop) + a direct selector.

## Position in the tree

The CSS HtmlEmbed can be:

- **Top-level sibling** of a Dialog/Sheet (validated pattern `sheet-mobile-radix` — the embed with `<style>` is a sibling, not a child)
- **Direct child of the body root** for a global reset or cross-project rules
- **Child of a section** when the rule only concerns one area

The browser evaluates the `<style>` at the moment the DOM encounters it — its position in the tree has no functional importance (unless you have 2 embeds that override each other: the last one in the DOM wins).

## Bonus — `executeScriptOnCanvas: false`

If your HtmlEmbed contains both a `<style>` AND a `<script>` (e.g. Swiper.js init with its CSS in the same block), the `executeScriptOnCanvas: false` prop disables execution of the `<script>` on the builder canvas side. The `<style>` stays applied (the canvas shows the styling correctly), the `<script>` only executes at production render (deployed site).

Without it, the builder executes the `<script>` on every click on the instance — it can break the canvas if the script attaches global listeners or modifies the DOM outside its scope.

```ts
webstudio_instance_prop({
  action: "update",
  instanceId: "<embed-id>",
  propName: "executeScriptOnCanvas",
  value: false,
  valueType: "boolean",
})
```

## Comparison with native Webstudio styles

| Case | Style Panel | HtmlEmbed CSS |
|---|---|---|
| Static padding/margin/color | ✅ canonical | ❌ pollutes |
| `:hover`, `:focus`, `:active` | ✅ UI states | ⚠️ OK for a complex pattern |
| `@keyframes` | ❌ not supported | ✅ required |
| Simple `@media` | ✅ UI breakpoints | ⚠️ OK for `prefers-*` |
| `@supports`, `@container` | ❌ not supported | ✅ required |
| `[data-state="..."]` selectors | ✅ UI states | ⚠️ OK for fine combinations |
| Targeting literal classes | ❌ hash classes | ✅ required |
| Targeting internal inline SVG | ❌ not accessible | ✅ required |
| Global reset | ⚠️ explodes into locals | ✅ 1 root embed |
| Re-render-robust fallback | ❌ hash classes lost | ✅ literal classes survive |

## Related patterns

- `sheet-mobile-radix` — uses HtmlEmbed heavily for the slide-in/out `@keyframes` + targets surviving literal classes
- `hover-cascade-via-css-vars` — native approach when possible
- `reset-margins-global` — a single root HtmlEmbed to zero out margins
- `swiper-carousel` — self-contained HtmlEmbed with Swiper.js + CSS, `executeScriptOnCanvas: false` required
