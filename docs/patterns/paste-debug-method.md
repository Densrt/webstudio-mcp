---
name: Debugging a Webstudio paste that fails silently
description: Systematic method to isolate the cause when copy-pasting a fragment produces raw text instead of the component.
category: workflow
complexity: simple
lastUpdated: 2026-05-20
recommendedTool: (debug method)
recommendedToolNote: systematic isolation when copy-paste produces text instead of components
---

# Debugging a silently failed Webstudio paste

## Symptom

You paste a WebstudioFragment into the canvas → Webstudio inserts the **JSON as raw text** as paragraph content instead of creating the instances.

**Root cause**: the Zod validator on the Webstudio side (`ClipboardData.parse()` in `apps/builder/app/shared/copy-paste/plugin-instance.ts`) is inside a silent try/catch. If a key is misnamed, a type doesn't match, or a character is corrupted, it throws → falls back to the default clipboard text.

## Debug method

**Step 0 — Verify copy-paste integrity BEFORE looking further afield**

A 1-character typo in a top-level key (e.g. `property` instead of `props`) reproduces exactly the same symptom. When the JSON is large (>10 KB) and passes through a chat or a channel that can truncate/normalize it, the bug may come from there, NOT from the format.

Quick test: regenerate the exact fragment and paste it again (sometimes that's enough).

**Step 1 — Bisection by progressive removal**

If the issue persists after re-paste:
1. Generate an **ultra-minimal** fragment (just the bare component, no styles, no tokens, no complex props)
2. If it pastes → reintroduce ONE group at a time:
   - Basic local styles (px, extended hex color, keyword)
   - States (`:hover`, `[data-state="active"]`)
   - Tokens (with custom IDs)
   - Exotic CSS types (fontFamily, layers, image asset)
   - Keywords on color properties (`transparent`)

At each step, paste and observe. The diff between the version that pastes and the one that crashes isolates the culprit.

## What works (validated in production 2026-05-08, a single-brand project)

All validated individually and combined:
- Radix components with namespace `@webstudio-is/sdk-components-react-radix:*`
- Tokens with custom non-nanoid IDs (e.g. `tok_darktest_surface_card`) — detected on cross-paste
- `fontFamily` type: `{type:"fontFamily", value:["Inter", "system-ui", "sans-serif"]}`
- `transparent` keyword on backgroundColor / borderBottomColor (does NOT require a color with alpha=0)
- **Negative** unit values: `{type:"unit", value:-1, unit:"px"}` (margin -1, letterSpacing -0.5, etc.)
- `:hover` and `[data-state="active"]` states (with quotes escaped in the JSON)
- Mix of tokens + locals on the same instance via `styleSourceSelections.values: [localId, tokenId]`

## How to apply

When the user reports "it's pasting raw text": **start by re-generating + re-pasting**. If it persists, do the bisection above. Do not speculate about CSS types without data — every type we suspected was incompatible (fontFamily, transparent, negative) actually works.
