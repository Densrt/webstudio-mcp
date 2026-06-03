---
name: Border color — Webstudio UI quirk
description: For a border visible on a SINGLE side (e.g. top), you must write the color on all 4 sides and limit width/style to the wanted side. Otherwise the Border panel UI becomes uneditable.
category: component
complexity: simple
lastUpdated: 2026-05-20
recommendedTool: styles.update
recommendedToolNote: write color on all 4 sides; limit width/style to the wanted side(s)
---

# Border color — the "4 sides color + per-side width/style" rule

## Symptom

When you push only `borderTopColor` on an instance (without touching the other 3 sides), the border renders correctly on the site but **Webstudio's Border panel becomes uneditable**: the "color" field stays empty or frozen, and you cannot change the color through the UI.

Reproduced on a production project (Sheet Socials, 2026-05-13): a minimal push of 3 per-side decls broke UI editing.

## Cause

Webstudio's Border panel exposes a **single unified "color" field** that only activates if all 4 sides (`borderTopColor` / `borderRightColor` / `borderBottomColor` / `borderLeftColor`) have the **same value**. This is by design — the CSS `border-color` shorthand accepts a single value for all 4 sides.

If only one side is set, the panel doesn't know which value to show in the unified field → the field is inert.

## Solution

To visually render a SINGLE border side (top/right/bottom/left):

1. Write the **color on all 4 sides** (same value)
2. Write **`borderXxxWidth` + `borderXxxStyle` ONLY on the wanted side**

The other 3 sides keep their color but without width/style → invisible.

### Example — translucent white top border

```ts
// ❌ WRONG — UI breaks
{
  borderTopColor: var("brand-border-subtle"),
  borderTopWidth: px(1),
  borderTopStyle: keyword("solid"),
}

// ✅ RIGHT — editable UI
{
  // Color on all 4 sides
  borderTopColor: var("brand-border-subtle"),
  borderRightColor: var("brand-border-subtle"),
  borderBottomColor: var("brand-border-subtle"),
  borderLeftColor: var("brand-border-subtle"),
  // Width + style ONLY on top
  borderTopWidth: px(1),
  borderTopStyle: keyword("solid"),
}
```

## Cases where it does NOT apply

- Border on **all sides** (equal): no problem, set it normally
- **Per-side different** borders (e.g. top red, bottom blue): technically possible but the UI panel will show "—" / uneditable. Reserved for advanced cases.

## MCP side

- The `addSheet` helper applies this rule automatically as of the following commit (`262741e`+1).
- Any new helper that uses per-side `borderXxxColor` must apply the rule: color on all 4, width/style targeted.

## Reference

Bug encountered: a production project on build 3040, Border panel of `brand-sheet-socials` uneditable after pushing my 3 `borderTop*` decls.
