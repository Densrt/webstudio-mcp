---
name: Flexbox trap — flex-basis inherited across row → column
description: When flex-direction switches from row to column, a flex-basis:0 (typical of flex:1) applies on the vertical axis and collapses the child's height, even with an explicit height.
category: component
complexity: simple
lastUpdated: 2026-05-20
recommendedTool: styles.update
recommendedToolNote: override flex-basis on column breakpoint — flex:1 collapses height when direction flips
---

# Flexbox trap — flex-basis: 0 kept across row → column

## Symptom

A flex-row parent with `flex: 1` children (i.e. `flex-basis: 0`) switches to `flex-direction: column` at a smaller breakpoint (mobile/tablet). Result: the child **disappears visually** — it has the correct width but a height of 0, even when a `height: 280px` is set explicitly.

Reproduced on a production project (2026-05-13) on a 3-column layout that collapses into a vertical stack.

## Cause

`flex-basis` applies on the flex container's **main axis**:
- `flex-direction: row` → main axis = horizontal → `flex-basis: 0` = width 0 (compensated by `flex-grow: 1`)
- `flex-direction: column` → main axis = **vertical** → `flex-basis: 0` = **height 0**

The value `0` is preserved across the direction change (it's the same breakpoint cascade). In column, `flex-grow: 1` tries to distribute the parent's **available vertical space** — which is often zero (parent with auto height) → the child collapses.

`height: 280px` does not regain control because `flex-basis` takes priority over `height` when it is defined (and here it equals 0).

## Solution

At the breakpoint where you switch to `column`, **override `flex-basis: auto`** on the child. `auto` hands control back to `height` / intrinsic content.

### Snippet

```ts
// Token "Col 1/3" (mobile-first row layout)
{
  flex: "1 1 0",         // base: 3 equal columns in row
  height: "280px",        // ignored in row, intended for column
}

// At the "Mobile L" breakpoint where the parent switches to flex-direction:column
{
  flexBasis: "auto",      // ← critical: hands control back to height
}
```

Alternative: if you don't need equal columns in row, use `flex: 1 1 auto` from the start. But you lose perfectly equal columns.

## How to diagnose quickly

1. The child has the correct `width` but `height: 0` or very small (DevTools).
2. The parent is in `flex-direction: column` at the current breakpoint.
3. The child has `flex: 1` or `flex-basis: 0` (often inherited from an "equal column" token).
4. → bingo, add `flex-basis: auto` at the column breakpoint.

## Bonus gotcha

If you see a flex child that "ignores" its explicitly set `width` or `height` → always check `flex-basis` first. It's the property that silently wins on the main axis.
