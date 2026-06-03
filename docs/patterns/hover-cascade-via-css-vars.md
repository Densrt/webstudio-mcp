---
name: Hover cascade via CSS variables (parent hover → child animation)
description: Trigger an animation on a child via the parent's :hover — impossible natively in the Webstudio UI, clean workaround via CSS custom properties.
category: component
complexity: simple
lastUpdated: 2026-05-20
recommendedTool: styles.update + cssvar.define
recommendedToolNote: parent :hover sets a custom prop, child consumes it — bypasses Webstudio UI limitation
---

# Hover cascade via CSS variables

## Problem

The Webstudio UI does not let you trigger an animation/transition on a **child** when the **parent** is hovered. The Styles panel can only style the selected instance itself, not its descendants via CSS combinators.

Typical case: a button with an arrow icon → you want the arrow to move a few pixels when the whole button is hovered (not only when the icon is hovered).

## Native solution — CSS custom properties

CSS custom properties (CSS variables) **inherit** and **re-evaluate on hover**: this is the only native Webstudio mechanism to cascade an interaction state from parent → child.

### Architecture

1. On the **parent**: define a CSS variable (e.g. `--arrow-translate-x`) with:
   - a base value (normal state)
   - a different value on the `:hover` state
2. On the **child**: reference that variable in the animated property + add a `transition`.
3. When the parent is hovered → the var changes → the browser re-evaluates the child → the transition animates.

### Concrete example (a production project, 2026-05-13)

**Token `Button L`** (parent):
```css
--arrow-translate-x: 0px;            /* base */
```
`:hover` state:
```css
--arrow-translate-x: 4px;
```
Important: `listed: true` on the token so the var is visible/editable in the Style panel.

**Token `Btn Arrow Icon`** (child — applied to the icon):
```css
transform: translateX(var(--arrow-translate-x, 0px));
transition: transform var(--brand-transition-fast) var(--brand-easing-default);
```

→ Apply `Btn Arrow Icon` to any button arrow icon → free hover animation, inherited from the parent regardless of DOM depth.

## Why it works

- Custom properties are **inherited** by default (unlike `transform`).
- A re-evaluation on the parent's `:hover` propagates the new value to all descendants that consume it via `var()`.
- The `transition` set on the child handles the interpolation — no need to put it on the parent.

## Gotchas

- **Style panel autocompletion**: vars defined via `HtmlEmbed` (`:root { --foo: 1px; }`) are **not** autocompleted in the Style panel — you have to type the name by hand. Vars defined via **token** (with `listed: true`) are.
- **Mandatory fallback**: always use `var(--arrow-translate-x, 0px)` with a default value, otherwise the prop becomes invalid if the var is not defined.
- **Transition on the child**: if you forget `transition` on the child side, the var change is instant (no animation).
- **No CSS combinator in Webstudio**: don't try to simulate this with a `.parent:hover .child` selector via HtmlEmbed — it works but it's off-panel, unreadable, and breaks on refactor.

## Source

- Official Webstudio docs: https://docs.webstudio.is/university/foundations/css-variables (section "parent interaction modifies children")
