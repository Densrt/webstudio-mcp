---
name: Webstudio Radix components — complete cartography
description: Exhaustive reference of the Radix components exposed by Webstudio. Namespace, required nesting structure, props, JSON examples. Source background agent 2026-05-08.
category: workflow
complexity: advanced
lastUpdated: 2026-05-20
recommendedTool: (reference)
recommendedToolNote: cartography of every Radix component exposed by Webstudio (namespace, structure, props)
---

# Webstudio Radix components — exhaustive reference

**Source**: `webstudio-is/webstudio` repo, `packages/sdk-components-react-radix/`
**Date**: 2026-05-08

## CRITICAL convention: namespace

Every Radix component in `instance.component` must be prefixed:

```
@webstudio-is/sdk-components-react-radix:<ComponentName>
```

Examples:
- `@webstudio-is/sdk-components-react-radix:Dialog`
- `@webstudio-is/sdk-components-react-radix:NavigationMenuTrigger`

The **native Webstudio components** (`Button`, `Link`, `Text`, `Box`, `Paragraph`, `HtmlEmbed`, `Image`) from the `@webstudio-is/sdk-components-react` package have **NO** prefix — just their short name.

## Exposed components (41 total, by family)

| Family | Components |
|---|---|
| Collapsible | Collapsible, CollapsibleTrigger, CollapsibleContent |
| **Dialog** | Dialog, DialogTrigger, DialogOverlay, DialogContent, DialogClose, DialogTitle, DialogDescription |
| **Popover** | Popover, PopoverTrigger, PopoverContent, PopoverClose |
| **Tooltip** | Tooltip, TooltipTrigger, TooltipContent |
| **Tabs** | Tabs, TabsList, TabsTrigger, TabsContent |
| Label | Label |
| Accordion ❌ | (skip — user prefers HTML `<details>`) |
| **NavigationMenu** | NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuTrigger, NavigationMenuContent, NavigationMenuLink, NavigationMenuViewport |
| Select | Select, SelectTrigger, SelectValue, SelectViewport, SelectContent, SelectItem, SelectItemIndicator, SelectItemText |
| **Switch** | Switch, SwitchThumb |
| **Checkbox** | Checkbox, CheckboxIndicator |
| RadioGroup | RadioGroup, RadioGroupItem, RadioGroupIndicator |

⚠️ **Sheet is NOT a component** — it's just a template that reuses Dialog with distinct labels (slide-in panel side). To generate a Sheet: use Dialog with "side panel" styles (position fixed left/right, height 100vh, slide-in animation).

## Key conventions

1. **`contentModel.descendants`** = closed list of components allowed as descendants (not only direct children). Off the list = insertion refused.
2. **`contentModel.children`**: `["instance"]` allows any child instance, `["instance", "rich-text"]` also allows direct text, `category: "none"` = cannot be inserted at the top level.
3. **`indexWithinAncestor`**: for TabsTrigger, TabsContent, NavigationMenuItem → the index within the ancestor is used as the default value of `value`. Tabs with 2 triggers + 2 contents = no need for an explicit `value`, the order is enough.
4. **`states`**: exposed CSS selectors (e.g. `[data-state="open"]`, `[data-state="active"]`).
5. **Internal state managed natively**: Dialog/Popover/Tooltip/Tabs/NavigationMenu manage their state via `useState`. **No dataSource needed** unless externally controlled.
6. **State variables (dataSource) optional**: create a bool/string dataSource only if:
   - Control from the outside (a third-party button opens the Dialog)
   - Synchronization between components
   - Pre-state based on an expression

## Empirical findings (2026-05-08, samples from a single-brand project)

The strict rules from the agent report were **relaxed** after inspecting real examples that work:

### NavigationMenu without dropdown — minimal structure
For a flat menu (just links, no dropdown on hover):
```
NavigationMenu
└── NavigationMenuList
    └── NavigationMenuItem (×N)
        └── NavigationMenuLink
            └── Link (with href of type page or string)
```
**No need for** Trigger/Content/Viewport. These components are only required for **items with a dropdown**.

### Dialog/Sheet — flexibility confirmed
- **DialogTitle and DialogDescription are optional on paste** (the builder doesn't fail without them, contrary to what the contentModel says) **BUT** Radix logs a console warning on **every open** if they're absent — required for screen readers. **Always provide at least visually-hidden ones** (cf. pattern `sheet-mobile-radix` § Mandatory a11y). `webstudio_create_sheet` auto-injects them by default.
- **DialogClose is strictly optional**: if you provide a close UX via overlay click + Escape, it's not needed.
- **The Dialog accepts direct children OUTSIDE the official structure**: a Logo (`a` + HtmlEmbed) can be a direct child of the Dialog alongside Trigger/Overlay
- **Reuse pattern**: the desktop NavigationMenu can be placed INSIDE the DialogContent of the mobile menu (no duplication of the links)

### Custom HTML props accepted
Beyond the "official" props (`open`, `value`, etc.), Webstudio accepts **any HTML attribute** as a string prop:
- `class: "burger-btn"` (custom CSS class)
- `data-role: "menu-overlay"` (custom data attribute)
- `aria-*` (a11y)

### Responsive menu pattern, single-brand project (reference)
```
Header
├── NavigationMenu (display:none mobile, display:flex desktop)
│   └── NavigationMenuList → flat NavigationMenuItems
└── Dialog "Mobile menu" (display:none desktop via DialogOverlay, display:block tablet+)
    ├── Logo (a + HtmlEmbed) — always visible
    ├── DialogTrigger (burger button — display:none desktop, display:flex tablet+)
    └── DialogOverlay (position:fixed, inset:0, z-index:50)
        └── DialogContent (position:relative, full screen tablet+, flex column)
            ├── Nav (ws:tag="nav")
            │   ├── NavigationMenu (reused — becomes vertical via flex column)
            │   └── CTA Button
            └── Logo + Social links
```

## Dialog

**Path**: `packages/sdk-components-react-radix/src/dialog.{ws.ts,tsx,template.tsx}`

**Components**:
- `Dialog` (root, category instance)
- `DialogTrigger` (Dialog descendant) — **must contain 1 child** Button/Link (asChild)
- `DialogOverlay` (Dialog descendant) — rendered via Portal
- `DialogContent` (DialogOverlay descendant) — rendered via Portal
- `DialogTitle` (DialogContent descendant) — h2 by default, `tag` prop h1-h6
- `DialogDescription` (DialogContent descendant) — p
- `DialogClose` (DialogContent descendant) — button

**Required structure**:
```
Dialog
├── DialogTrigger
│   └── Button (exactly 1 child)
└── DialogOverlay
    └── DialogContent
        ├── DialogTitle
        ├── DialogDescription
        ├── ...free content
        └── DialogClose
            └── Button
```

**Key props**:
- Dialog: `open` (boolean) — initialProps
- DialogTitle: `tag` (enum h1-h6)

**CSS states**: `[data-state="open"]`, `[data-state="closed"]` on Trigger/Overlay/Content.

## Popover

**Path**: `packages/sdk-components-react-radix/src/popover.{ws.ts,tsx,template.tsx}`

**Components**: Popover, PopoverTrigger, PopoverContent, PopoverClose.
**Difference vs Dialog**: no Overlay. PopoverContent rendered directly in a Portal.

**Structure**:
```
Popover
├── PopoverTrigger
│   └── Button
└── PopoverContent
    ├── ...content
    └── PopoverClose (optional)
        └── Button
```

**Key PopoverContent props**:
- `side` ("top"|"right"|"bottom"|"left")
- `sideOffset` (number, default 4)
- `align` ("center"|"start"|"end")
- `alignOffset` (number)
- `arrowPadding`, `avoidCollisions`, `hideWhenDetached`, `sticky`, `updatePositionStrategy`
- Popover: `open` (boolean)

## Tooltip

**Path**: `packages/sdk-components-react-radix/src/tooltip.{ws.ts,tsx,template.tsx}`

**Components**: Tooltip, TooltipTrigger, TooltipContent.
**Auto-Provider**: Tooltip automatically wraps in `TooltipPrimitive.Provider`. No need to generate a separate Provider.

**Structure**:
```
Tooltip
├── TooltipTrigger
│   └── Button
└── TooltipContent
    └── Text
```

**Key props**:
- Tooltip: `open`, `delayDuration` (default 700ms), `disableHoverableContent`
- TooltipContent: `side`, `sideOffset` (default 4), `align`, `alignOffset`, `aria-label`, `arrowPadding`, `avoidCollisions`, `hideWhenDetached`, `sticky`, `updatePositionStrategy`

**States**: `[data-state="closed"]`, `[data-state="delayed-open"]`, `[data-state="instant-open"]`

## Tabs

**Path**: `packages/sdk-components-react-radix/src/tabs.{ws.ts,tsx,template.tsx}`

**Components**: Tabs, TabsList, TabsTrigger, TabsContent.
- TabsTrigger and TabsContent have `indexWithinAncestor: Tabs` → if `value` is not provided, it uses the index within Tabs.

**Structure**:
```
Tabs (defaultValue="0")
├── TabsList
│   ├── TabsTrigger (value="0", auto if omitted)
│   ├── TabsTrigger (value="1")
│   └── TabsTrigger (value="2")
├── TabsContent (value="0")
├── TabsContent (value="1")
└── TabsContent (value="2")
```

**Trigger ↔ Content pairing**: via the `value` prop or via index if omitted.

**Key props**:
- Tabs: `defaultValue` (string), `value`, `activationMode` ("automatic"|"manual"), `orientation` ("horizontal"|"vertical"), `dir` ("ltr"|"rtl")
- TabsList: `loop` (boolean)
- TabsTrigger / TabsContent: `value` (string)

**States**: `[data-state="active"]`, `[data-state="inactive"]`

## NavigationMenu

**Path**: `packages/sdk-components-react-radix/src/navigation-menu.{ws.ts,tsx,template.tsx}`

**Components**: NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuTrigger, NavigationMenuContent, NavigationMenuLink, NavigationMenuViewport.

**Structure**:
```
NavigationMenu
├── NavigationMenuList
│   ├── NavigationMenuItem (with dropdown)
│   │   ├── NavigationMenuTrigger
│   │   │   └── Button
│   │   └── NavigationMenuContent
│   │       ├── NavigationMenuLink
│   │       │   └── Link
│   │       └── NavigationMenuLink
│   │           └── Link
│   └── NavigationMenuItem (simple link, no dropdown)
│       └── NavigationMenuLink
│           └── Link
└── NavigationMenuViewport
```

**Dropdown items**: Trigger + Content (+ Links).
**Simple link items**: just a direct NavigationMenuLink.

**Key props**:
- NavigationMenu: `defaultValue`, `value`, `delayDuration` (200ms), `skipDelayDuration` (300ms), `dir`
- NavigationMenuItem: `value` (string; otherwise uses indexWithinAncestor=NavigationMenu)
- NavigationMenuLink: `active` (boolean — marks as active via data-active)

**States**: `[data-state="open"]`, `[data-state="closed"]` on Trigger/Content/Viewport

⚠️ **Builder bug**: if `value === ""` on the builder side (renderer="canvas"), Radix replaces it with `"-1"` to force the Viewport render. At production runtime, an empty value = nothing open.

## Switch

**Path**: `packages/sdk-components-react-radix/src/switch.{ws.ts,tsx,template.tsx}`

**Components**: Switch, SwitchThumb.

**Structure**:
```
Switch (button)
└── SwitchThumb (animated span)
```

**Props**: Switch has `checked`, `required`, `id`, `class`, `name`, `value` (HTML form integration).

**States**: `[data-state="checked"]`, `[data-state="unchecked"]`

## Checkbox

**Path**: `packages/sdk-components-react-radix/src/checkbox.{ws.ts,tsx,template.tsx}`

**Components**: Checkbox, CheckboxIndicator.

**Recommended pattern** (with Label + Text alongside):
```
Label
├── Checkbox (button)
│   └── CheckboxIndicator (span)
│       └── HtmlEmbed (svg check)
└── Text "label"
```

**Props**: Checkbox has `checked`, `required`, `id`, `class`, `name`, `value`.

**States**: `[data-state="checked"]`, `[data-state="unchecked"]`, `[data-state="indeterminate"]` (3 states!)

## Quick component → HTML tag mapping

| Component | Default tag | Notes |
|---|---|---|
| Dialog/Popover/Tabs/NavigationMenu (root) | div | – |
| `*Trigger` | (asChild → direct child, no wrapper) | Trigger keeps the tag of the Button/Link child |
| `*Overlay` | div | Portal |
| `*Content` | div | Portal for Dialog/Popover/Tooltip |
| `DialogTitle` | h2 (presetStyle) / h1 (React default) | configurable via `tag` |
| `DialogDescription` | p | – |
| `*Close` / `Switch` / `Checkbox` | button | – |
| `TooltipTrigger` | (asChild) | Auto Provider |
| `Tabs` | div | – |
| `TabsList` | div | role=tablist (Radix) |
| `TabsTrigger` | button | indexWithinAncestor |
| `TabsContent` | div | indexWithinAncestor |
| `NavigationMenuList` | div | (real Radix = ul, presetStyle div) |
| `NavigationMenuItem` | div | (real Radix = li, indexWithinAncestor) |
| `NavigationMenuLink` | (asChild → a) | `active` prop |
| `NavigationMenuViewport` | div | – |
| `SwitchThumb` / `CheckboxIndicator` | span | – |

## MCP validation rules

Before emitting a Radix fragment, verify:
1. The required descendants are present (cf. the contentModel table)
2. The Triggers (`DialogTrigger`, `PopoverTrigger`, etc.) have **exactly 1 child** Button/Link
3. For Tabs and NavigationMenu: a consistent number of Triggers and Contents (unless `value` is set manually)
4. No direct children other than the allowed ones (e.g. no Box directly as a child of Dialog — it must be DialogContent)
5. The top-level wrapper has `category: "instance"` (the sub-components have `category: "none"` and are rejected if they leave their parent)
6. **No `class`/`className`/`style`/`id` on a non-rendering wrapper** (cf. next section). The `webstudio_styles`, `webstudio_instance_prop` and `webstudio_push_fragment` tools refuse these props with a structured `RADIX_TRIGGER_POLLUTION` error.

## Non-rendering wrappers (asChild & Portal) — whitelist of allowed props

These Radix components **do not render their own DOM**. Either they use `asChild={true}` and forward their props onto the first child via `React.cloneElement`, or they render into a `createPortal`. In both cases, any local style applied to them is silently ignored, and any `class`/`className`/`style`/`id` prop overwrites the Webstudio atomic hash class of the target child (critical bug in SPA navigation — cf. pattern `sheet-mobile-radix` § Major pitfall).

**Exhaustive list** (up to date with MCP v0.4.x):

| Component | Mechanism | Real style target |
|---|---|---|
| `DialogTrigger` | asChild → 1st child | Button/Link child |
| `DialogClose` | asChild → 1st child | Button child |
| `DialogPortal` | createPortal | n/a (never style) |
| `PopoverTrigger` | asChild → 1st child | Button/Link child |
| `PopoverClose` | asChild → 1st child | Button child |
| `PopoverPortal` | createPortal | n/a |
| `SheetTrigger` | asChild → 1st child | Button/Link child |
| `SheetClose` | asChild → 1st child | Button child |
| `SheetPortal` | createPortal | n/a |
| `TabsTrigger` | renders a `<button>` | renders DOM, exception — OK to style |
| `TooltipTrigger` | asChild → 1st child | Button/Link child |
| `TooltipPortal` | createPortal | n/a |
| `DropdownMenuTrigger` | asChild → 1st child | Button child |
| `DropdownMenuPortal` | createPortal | n/a |
| `NavigationMenuTrigger` | renders a `<button>` | renders DOM, exception — OK to style |
| `NavigationMenuLink` | asChild → 1st child | Link child |
| `Slot` (primitive) | asChild → 1st child | the child itself |

⚠️ **`TabsTrigger` and `NavigationMenuTrigger` render their own `<button>`** — they're style-OK, and are **not** in `RADIX_NON_RENDERING_WRAPPERS`.

**Whitelist of allowed props** on the non-rendering wrappers:

- `data-ws-show` — Webstudio flag for the builder canvas render (always OK)
- `aria-label`, `aria-labelledby`, `aria-describedby` — Radix forwards them correctly
- Other technical `aria-*` (never visual)
- Custom technical `data-*` (e.g. `data-role="menu-overlay"` used as a CSS selector in a sibling HtmlEmbed — cf. pattern `sheet-mobile-radix`)

**Props refused by default**:
- `class` / `className`
- `style`
- `id` (pollutes the DOM, loses the atomic hashes)
- Any purely presentational HTML attribute

Emergency opt-out: `ignoreWrapperWarning: true` on `webstudio_styles` / `webstudio_instance_prop` / `webstudio_push_fragment` — to be avoided, the real solution is to move the prop/style onto the child.

## Builder implementation plan

To add in `src/builder.ts` (or a new `src/radix.ts`):

1. **Namespace mapping**: if `component` matches a known Radix name → prefix with `@webstudio-is/sdk-components-react-radix:`. Otherwise, either ws:element + tag, or a short native component.
2. **High-level helpers**:
   - `addDialog(builder, options)` → generates root + trigger + overlay + content + title + close
   - `addTabs(builder, items)` → items = `[{label, content}, ...]` generates Tabs + List + Triggers + Contents with value=index
   - `addNavigationMenu(builder, items)` → items with dropdown or simple link
   - `addTooltip(builder, options)` → trigger + content
   - etc.
3. **Validation**: verify the nesting before `build()` and raise a clear error if the structure is invalid.

## Key source files (reference)

- `packages/sdk-components-react-radix/src/components.ts` — public exports
- `packages/sdk-components-react-radix/src/metas.ts` — metas registry
- `packages/sdk-components-react-radix/src/hooks.ts` — builder hooks registry
- `packages/sdk-components-react-radix/src/shared/meta.ts` — proxy `radix.*` → namespace
- `packages/sdk-components-react-radix/src/<component>.{ws.ts,tsx,template.tsx}` + `__generated__/<component>.props.ts`
