---
name: Tabs = always Radix, never custom HTML/CSS
description: Team convention — for any Tabs component in Webstudio, use the native Radix component (Tabs, TabsList, TabsTrigger, TabsContent), not a custom HTML/CSS implementation.
category: component
complexity: simple
lastUpdated: 2026-05-20
recommendedTool: build.push_fragment
recommendedToolNote: use the native Radix Tabs components (Tabs/TabsList/TabsTrigger/TabsContent) — NEVER custom HTML
---

# Rule: Tabs → native Webstudio Radix

**Why:** Webstudio natively exposes the Radix UI components (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`) under the `@webstudio-is/sdk-components-react-radix:Tabs` namespace, etc. These components handle active state, transitions, accessibility (ARIA, keyboard nav) and provide a stable API on the Webstudio side. No reason to reimplement.

**How to apply:**
- For any tabs request (product categorization, product sheet with tabs, etc.) → use the Radix `Tabs / TabsList / TabsTrigger / TabsContent` components
- Full reference: see `radix_components.md` (component map + single-brand project patterns)
- Component already validated in production on a single-brand project (full modern dark Tabs, cf. `project_state.md`)

## Priority Radix components (others already identified)

| Component | Use case |
|---|---|
| **Tabs** | Product categorization, product-sheet tabs |
| **Dialog** | Contact popups, video modal |
| **NavigationMenu** | Desktop menu with dropdowns |
| **Sheet** | Mobile drawer |
| **Tooltip** | Contextual help |
| **Popover** | Context menu |
| **Switch** | Toggles in forms |
| **Checkbox** | Form checkboxes |

## Open internal decision

**Criteria for custom HTML/CSS vs Radix vs external lib** — to be formalized.

Proposed decision framework (to validate):
- **Custom HTML/CSS**: pure layouts (bento, scroll-snap), visual stateless components (hero, footer, listing with image+text)
- **Native Webstudio Radix**: any interactive component with state (tabs, dialog, navigation menu, popover, accordion, switch, checkbox, etc.) — Webstudio exposes it, no reason to reinvent
- **External lib (Swiper, etc.)**: when Radix does not cover it (carousel with autoplay/transitions/effects, lightbox, advanced video player, etc.) — via HtmlEmbed with a CDN

To be validated in internal review before locking in.
