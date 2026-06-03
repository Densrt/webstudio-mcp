---
name: Sheet Mobile Radix Dialog pattern (production-validated)
description: Complete, validated pattern for a mobile Sheet/Dialog in Webstudio — animated burger + slide-in/out + idempotent cleanup. Acme architecture.
category: workflow
complexity: medium
lastUpdated: 2026-05-20
recommendedTool: build.create_sheet
recommendedToolNote: one-call mobile drawer with collapsibles + CTA + socials
---

# Sheet Mobile Nav pattern (Radix Dialog) — validated 2026-05-09 on darktest

**Why:** First complex Radix Dialog pattern with working animations. Reverse-engineered from a production project. Many pitfalls, several broken iterations before this one.

**How to apply:** For any Radix Dialog/Sheet/Drawer in Webstudio. NEVER reinvent it — start directly from this pattern.

## Architecture (validated)

**2 top-level sibling instances** (NOT the CSS inside the Dialog):
1. `Dialog` (label "Menu mobile" or similar)
2. `HtmlEmbed` with `<style>...</style>` + prop `executeScriptOnCanvas: false`

Dialog structure:
```
Dialog
├── DialogTrigger (data-ws-show=true, aria-label)
│   └── Button (class="burger-btn", data-ws-show=true)
│       ├── ws:element div "Top bar"
│       ├── ws:element div "Middle bar"
│       └── ws:element div "Bottom bar"
└── DialogOverlay (data-role="menu-overlay")
    └── DialogContent (data-role="menu-content")
        └── ws:element nav
            └── links...
```

## Critical rules (otherwise it breaks)

### 1. Radix animations = `@keyframes`, NEVER `transition`
Radix unmounts the DOM on close. `transition` does not play the exit. `animation` with `forwards` makes Radix wait for `animationend` before unmounting.

### 2. data-state propagation
- The Webstudio SDK `DialogTrigger` uses `asChild={true}` → forwards `data-state` onto its **first child** (the Button)
- `DialogOverlay` and `DialogContent` receive `data-state` directly
- So `class="burger-btn"` on the Button makes `.burger-btn[data-state="open"]` match

### 3. Animated burger: CSS vars in Webstudio styles + override in the CSS embed
- **Webstudio styles on the Button**: declare the default vars (closed state)
  - `--angle: 0deg, --move: 0, --middle-op: 1, --angle-rev: 0deg, --move-rev: 0`
- **CSS embed**: override on `[data-state="open"]`
  - `--angle: 45deg, --move: 6px, --middle-op: 0, --angle-rev: -45deg, --move-rev: -6px`
- **Bars (Webstudio styles)**: `transform: translateY(var(--move,0)) rotate(var(--angle,0deg))` + `transition: transform 300ms cubic-bezier(.4,0,.2,1)` (the transition smooths the var changes)

### 4. Burger color via `currentColor`
- Button: `color: #111111` (dark by default)
- Bars: `backgroundColor: keyword("currentColor")` → inherits from the parent
- Lets you change the color in a single place (the button)

### 5. Burger z-index > overlay
The burger MUST stay visible during the open animation, otherwise the user does not see the hamburger→X transformation.
- Button: `position: relative, zIndex: 1002`
- Overlay: `zIndex: 998`

### 6. Minimal CSS (no overlay fade-in)
Match Acme: the overlay appears instantly on open, fading out only on close. The content slide is visually enough.

```css
.burger-btn[data-state="open"] { --angle: 45deg; --move: 6px; ... }

@keyframes brand-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes brand-slide-out { from { transform: translateX(0); } to { transform: translateX(100%); } }
@keyframes brand-fade-out { from { opacity: 1; } to { opacity: 0; } }

[data-role="menu-content"] { will-change: transform; }
[data-role="menu-content"][data-state="open"] { animation: brand-slide-in 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }
[data-role="menu-content"][data-state="closed"] { animation: brand-slide-out 200ms ease-in forwards; }
[data-role="menu-overlay"][data-state="closed"] { animation: brand-fade-out 200ms ease-in forwards; }
```

### 7. Slide direction
- Slide from the right: `marginLeft: auto` + keyframes `translateX(100%)` → `0`
- Slide from the left: `marginRight: auto` + keyframes `translateX(-100%)` → `0`

## 🚨 Major pitfall — className pollution on DialogTrigger (SPA-navigation bug)

**Symptom**: on a page change in SPA (clicking a header `<Link>`), the burger button's slot suddenly becomes visible in the flex parent and shifts the other header items. The button falls back to its default dimensions. **Hard refresh: no bug. SPA nav: systematic bug.**

### Root cause

When a Radix `*Trigger` (DialogTrigger, PopoverTrigger, SheetTrigger, etc.) using `asChild` carries a `class` prop and/or local styles, the `React.cloneElement` merge **overwrites the child's className instead of concatenating it**. The atomic hash classes that Webstudio injects on the child Button disappear from the render; only the literal class survives.

Detailed mechanism:

1. The Radix `*Trigger` uses `asChild={true}` → does not render its own DOM.
2. At runtime, Radix does `React.cloneElement(child, mergedTriggerProps)` to merge its props onto the first child.
3. If the Trigger has its own `class` prop, that one takes priority in the merge and **overwrites the `className` Webstudio should have injected on the child**.
4. Result: the rendered `<button>` has only the literal class (prop), not the atomic hash classes that carry the real CSS decls (`display`, `width`, dimensions, etc.).
5. The `<button>` falls back to its default render styles → takes up space in the flex parent → shifts the other items.
6. The local styles on the Trigger are themselves useless (the Trigger renders no DOM of its own), but their presence degrades the merge further.

### Why only on SPA navigation

If the header contains both a Radix `NavigationMenu` and a Radix `Dialog` (mobile Sheet + desktop nav case), the `NavigationMenu` consumes `useLocation()` to mark the active link. On a route change, its React reconciliation triggers a cascade of re-renders in the parent. The asChild target Button is re-rendered and the correct className is not (or never) re-applied. **On the first static HTML load, SSR placed the right classes; in SPA after navigation, the `cloneElement` merge takes over and loses the hashes.**

### Fix

On the Radix Trigger:

- **Remove** the `class` / `className` prop
- **Remove** all local styles
- **Remove** any `id` or purely presentational attribute

Put the `class` prop and the styles **on the child Button** (which is the element actually rendered).

**OK whitelist on the Trigger**: `data-ws-show`, `aria-label`, `aria-describedby`, `aria-labelledby`, other technical `aria-*`, technical `data-*`.

### MCP guard

The `webstudio_styles`, `webstudio_instance_prop` (update/bind), and `webstudio_push_fragment` tools refuse by default any `class`/`className`/`style`/`id` prop or local style on non-rendering Radix wrappers. Structured error `RADIX_TRIGGER_POLLUTION` with a hint toward the target child component. Opt out via `ignoreWrapperWarning: true` if truly necessary (rare).

The audit `webstudio_audit({ kind: "radix-trigger-pollution" })` scans the whole project and flags already-present pollution with a suggestion to migrate to the child.

## ♿ Mandatory a11y — visually-hidden DialogTitle + DialogDescription

Radix logs a console warning on **every open** of the Dialog if `DialogContent` lacks a child `DialogTitle`. It is required for a11y (screen readers).

`webstudio_create_sheet` auto-injects 2 visually-hidden children at the top of the `DialogContent` by default:

- `DialogTitle` with default text "Navigation menu" (configurable via `a11yTitle`)
- `DialogDescription` with default text "Links to the main sections of the site" (configurable via `a11yDescription`)

Opt out via `skipA11yLabels: true` (discouraged except in special cases — e.g. you provide your own visible labels).

Standard **visually-hidden** style to apply:

```css
position: absolute;
width: 1px;
height: 1px;
padding: 0;      /* split longhand → paddingTop/Right/Bottom/Left */
margin: -1px;    /* split longhand → marginTop/Right/Bottom/Left */
overflow: hidden;
clip-path: inset(50%);
white-space: nowrap;
border-width: 0; /* split longhand → borderTop/Right/Bottom/LeftWidth */
```

NEVER use `display: none` instead — screen readers ignore unrendered elements.

## Push idempotence

MANDATORY for any push of a recurring pattern (Dialog, Sheet, etc.) — otherwise every push duplicates.

Pattern in the script:
1. `fetchBuild` → find the old instances by label at root level
2. Wide catch: for Sheet, possible labels are `["Sheet", "Sheet Mobile Nav", "Menu mobile"]` + `["CSS animation menu"]` for the HtmlEmbed
3. Tree-walker to collect descendants
4. Cleanup transaction BEFORE pushing the new fragment
5. Re-fetch the build for the new version


## Bug fixed in the MCP: multi-root push

**Problem**: `fragmentToTransaction` only took `payload.children[0]` as the root. The other top-level instances were orphaned.

**Fix**: `src/fragment-to-patches.ts` now iterates over all `payload.children` filtered on `type:"id"` and inserts each as a child of the parent (at consecutive indices `insertIndex + i`).

Allows pushing:
- Dialog + CSS HtmlEmbed siblings
- Several sibling sections at once
- Any multi-tree pattern

## Pitfalls to avoid (learned the hard way)

- ❌ Putting `transform: translateX(100%)` + `transition` in Webstudio styles on the panel → the exit does not play
- ❌ `[data-role="menu-overlay"][data-state="open"] { animation: fade-in... }` without an initial `opacity:0` → does not play (the element already starts at 1)
- ❌ No z-index on the burger → the overlay covers the animation
- ❌ White bars on a white background → invisible
- ❌ Push without cleanup → sheets duplicated
- ❌ Putting the CSS embed as a child of the Dialog (works but less clean than a sibling)
- ❌ Setting `borderTopColor` alone on the panel/socials without the other 3 sides → the UI's Border panel becomes uneditable (cf. pattern `border-color-ui-quirk`)
- ❌ Betting on `display: contents` to isolate the React reconciliation of a subtree — **it does not work**. React reconciliation operates at the React component level, not the CSS box. A React wrapper (even `display: contents`) is still reconciled by the parent. The only true "isolator" would be `React.memo`, which Webstudio does not expose.

## "Drawer floating under the header" variant (validated on a production project 2026-05-13)

To get a drawer that does NOT cover the full viewport height and stays visually detached from the edges:

**Overlay**:
- `top: var(--brand-header-height)` (instead of 0) → the header stays visible and interactive
- `padding: var(--brand-space-m)` on all 4 sides → inner margin between overlay and panel

**Panel**:
- `border-radius: var(--brand-radius-m)` on all 4 corners → rounded corners
- `box-shadow: none` (overrides the helper's default shadow used for the full-height slide from the right)

**Slide direction LEFT**: `marginRight: auto` (already handled by the helper with `direction: "left"`)

Benefit: the header stays usable (clickable logo), the drawer floats with a visual gap — a more modern UX than a full-height drawer.

## Fallback workaround — `display:none/flex` wrapper (legacy polluted Trigger)

Use case: you inherit a project where the `DialogTrigger` already carries a `class` prop or local styles, and you cannot (or do not want to) touch the component.

Trick: wrap the whole Dialog in a `ws:element` `<div>` that carries the responsive visibility styles:

```
ws:element div "Sheet wrapper"   ← styles: display:none @Base, display:flex @Tablet
└── Dialog "Mobile menu"
    ├── DialogTrigger
    │   └── Button (polluted — literal class, inert styles)
    └── DialogOverlay > DialogContent > ...
```

**Why it works**: the hash class on that wrapper always survives the SPA re-renders (it is a normal element, **not an asChild target**). The `cloneElement` merge does not touch the wrapper, only the Trigger's child Button.

Use only as a fallback — the clean solution is still to migrate the Trigger's props/styles to the child Button (cf. § Major pitfall).

## Radix components used

Namespace: `@webstudio-is/sdk-components-react-radix:`
- `Dialog` (root)
- `DialogTrigger` (asChild forwarded onto the first child)
- `DialogOverlay` (creates its own Portal, accepts children via spread props)
- `DialogContent` (rendered inside the Overlay via portal)
- `DialogClose` (optional, for a dedicated X button)
- `DialogTitle`, `DialogDescription` (a11y, optional)

SDK source: https://github.com/webstudio-is/webstudio/tree/main/packages/sdk-components-react-radix/src/dialog.tsx
