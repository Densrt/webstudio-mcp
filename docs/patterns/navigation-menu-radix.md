---
name: NavigationMenu Radix + mega menu pattern (MVP-9)
description: Complete NavigationMenu Webstudio Radix recipe with mega menu. Validated on darktest 2026-05-08. Includes the critical pitfalls discovered (viewport transition, container positioning).
category: workflow
complexity: medium
lastUpdated: 2026-05-20
recommendedTool: build.create_navigation_menu
recommendedToolNote: one-call desktop mega menu (Radix NavigationMenu + chevron rotation)
---

# NavigationMenu Radix + mega menu

**Native Webstudio Radix component**: `@webstudio-is/sdk-components-react-radix:NavigationMenu` and its sub-components. Webstudio manages the state (open/close), keyboard nav, ARIA, and viewport positioning via internal CSS vars.

**Validated on darktest 2026-05-08** after 3 attempts. Reverse-engineered from the default Webstudio fragment (the one inserted via the UI when you add the component).

## Exact DOM architecture

```
NavigationMenu (root)                  ← position: relative; max-width: max-content
├── NavigationMenuList                 ← flex centered, padding/margin 0, list-style none
│   ├── NavigationMenuItem (mega)
│   │   ├── NavigationMenuTrigger
│   │   │   └── Button                 ← Webstudio component (NOT a direct text)
│   │   │       ├── Text "Label"
│   │   │       └── Box (Icon Container)
│   │   │           └── HtmlEmbed (chevron SVG)
│   │   └── NavigationMenuContent      ← position: absolute; top:0; left:0; width:max-content
│   │       └── Box "Content"          ← flex row of columns
│   │           └── Box "Flex Column"  ← flex column of links
│   │               └── NavigationMenuLink
│   │                   └── Link       ← Webstudio component (renders <a>)
│   │                       ├── Text "Title"
│   │                       └── Paragraph "Description"
│   └── NavigationMenuItem (simple link)
│       └── NavigationMenuLink
│           └── Link "Standalone"
└── Box "Viewport Container"           ← position: ABSOLUTE; top: 100%; left: 0; flex justify-center
    └── NavigationMenuViewport         ← position: relative; width/height: var(--radix-...); NO transition
```

## ⚠️ CRITICAL PITFALLS (4 major bugs)

### 1. NEVER put a `transition` on the viewport width/height

**Symptom**: the mega menu shrinks progressively to infinity as it appears.

**Cause**: Radix updates `--radix-navigation-menu-viewport-height/width` continuously during the open animation. A `transition: width, height` interpolates on every tick → a loop that keeps shrinking.

**Fix**: no transition on the viewport. If you want an appearance animation, apply it to `opacity` or `transform: scale()` (not to the sizing).

### 2. Viewport container: `position: absolute`, NOT `fixed`

**Symptom**: the mega menu appears in the wrong place (full-width at the top, or detached from the menu).

**Cause**: with `fixed`, it leaves the NavigationMenu context and loses the Radix reference.

**Fix**: `position: absolute; top: 100%; left: 0; display: flex; justify-content: center`. The NavigationMenu root must be `position: relative` so the absolute element anchors to it. The viewport then floats just below the NavigationMenu.

### 3. NavigationMenu root MUST have `position: relative; max-width: max-content`

**Symptom**: viewport mispositioned or mega menu spanning the full screen width.

**Fix**: these 2 styles at minimum on the root for everything to work.

### 4. Radix applies default `data-motion` animations — to be overridden

**Symptom**: when a mega menu appears, the panel slides in from the right OR the left depending on the hover direction. Moving from one item to another also triggers a lateral slide. Looks "weird" if you just want a fade or a subtle top-slide.

**Cause**: the Radix `NavigationMenuContent` receives `data-motion="from-end"|"from-start"|"to-end"|"to-start"|""` depending on the direction of movement between items. Webstudio includes default `@keyframes` that slide in from the corresponding side.

**Fix**: add an `HtmlEmbed` sibling to the `NavigationMenuList` (inside the `NavigationMenu` root) with CSS that overrides the animations. Tag each `NavigationMenuContent` with `data-role="<unique-slug>-mega-content"` (unique per project to avoid collisions).

```html
<!-- HtmlEmbed sibling of the list, inside NavigationMenu root -->
<style>
[data-role="brand-mega-content"] { animation: none !important; }
[data-role="brand-mega-content"][data-state="open"]   { animation: brand-mega-fade-in 180ms ease-out forwards !important; }
[data-role="brand-mega-content"][data-state="closed"] { animation: brand-mega-fade-out 120ms ease-in forwards !important; }
@keyframes brand-mega-fade-in  { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes brand-mega-fade-out { from { opacity: 1; } to { opacity: 0; } }
</style>
```

Possible variants:
- **Pure fade**: drop the `translateY(-6px)` from the keyframe
- **Slide from the top**: `translateY(-10px)` + 220ms duration
- **No animation**: `animation: none !important` on all states

Validated on a production project, build 3037 (2026-05-13).

## Trigger: required structure

`NavigationMenuTrigger > Button > [Text + Box (Icon Container) > HtmlEmbed]`

**Not** `NavigationMenuTrigger > text` directly (Radix expects a Button child to bind the state).

**The Button** receives the `[data-state="open"]` from Radix. Style on it, not on the Trigger.

**Chevron 180° rotation when open**:
```js
// On the local Button:
"--navigation-menu-trigger-icon-transform": deg(0)            // base
"--navigation-menu-trigger-icon-transform": deg(180)          // [data-state="open"]
// On the local Icon Container:
"rotate": v("navigation-menu-trigger-icon-transform")
"transition": "all 200ms cubic-bezier(0.4, 0, 0.2, 1)"
```

## NavigationMenuLink: required structure

`NavigationMenuLink > Link > [text or Text + Paragraph]`

**Not** `NavigationMenuLink > text` directly. The child `Link` renders the `<a href>` and receives the Radix props via asChild.

## Exposed Radix CSS vars

| Variable | Description |
|---|---|
| `--radix-navigation-menu-viewport-width` | Dynamic width of the active content |
| `--radix-navigation-menu-viewport-height` | Dynamic height |
| `--navigation-menu-trigger-icon-transform` | Custom (we define it) for the chevron rotation |

## Description with 2-line line-clamp

For the description paragraphs inside the NavigationMenuLink:
```js
{
  margin: 0 (all directions),
  overflowX: "hidden", overflowY: "hidden",
  display: "-webkit-box" (unparsed),
  "-webkit-box-orient": "vertical",
  "-webkit-line-clamp": 2 (number),
  fontSize: 0.875rem, lineHeight: 1.375,
  color: "var(--color-text-muted)"
}
```

## When to use what

- **Mega menu (Trigger + Content + Viewport)**: for sections with rich visual sub-categories (product models, services, resources with descriptions)
- **Simple link directly in Item**: for standalone links without a sub-menu (Contact, About, etc.)

## Differences: custom pattern vs Webstudio default

2 patterns observed in production:
- Custom (legacy production): viewport container `position: fixed; width: 100vw; top: <header-height-px>`
- Webstudio default: viewport container `position: absolute; top: 100%; left: 0`

**The Webstudio default pattern is more reliable** (natively responsive, no need to adjust top in px based on the header height). Use it by default.

The fixed pattern can be useful if the mega menu must overflow the NavigationMenu significantly (full-width). But it adds responsive complexity. Avoid it unless specifically needed.

## For programmatic creation via MCP

See `clone-radix-default.mjs`. Pattern:
- 5 structure instances (header + nav + list + viewport container + viewport)
- For each mega item: 7 instances (item + trigger + button + 2 buttonChildren + content + contentBox)
- For each column: 1 colBox + N (navLink + link + title + desc) per link
- 1 transaction ~120 instances + 30 props + ~470 styles for 2 mega menus of 2 cols × 2 links + 1 simple link

## TODO V2 (potential `webstudio_create_navmenu` MCP tool)

Inputs:
- `projectSlug`, `parentInstanceId` (where to insert the header)
- `items[]`: `{ kind: "mega" | "link", label, href?, columns?: [{ items: [{ title, desc, href }] }] }`
- `theme`: 'dark' | 'light'
- `tokens`: names of the tokens to use (color-bg-card, etc.)

Generates the whole transaction in one go.
