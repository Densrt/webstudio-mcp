---
name: Per-project token system architecture
description: MCP tool overhaul with a per-project tokens.json registry. Tokens have stable IDs and are applied by slug. Validated end-to-end 2026-05-08.
category: workflow
complexity: medium
lastUpdated: 2026-05-20
recommendedTool: tokens.init_brand_kit + tokens.sync_local
recommendedToolNote: registry tokens.json per project with stable IDs
---

# MCP builder token system

**Validated on 2026-05-08** on the `demo` test project.

## Why

To industrialize section generation, each project needs a stable **design token registry**:
- The same reusable tokens across N sections
- Stable IDs between successive pastes (Webstudio matches by ID + name → no duplication)
- Editing a token = automatic propagation to every instance that uses it

## Architecture

### File structure

```
/root/webstudio-mcp/
├── projects/
│   ├── {projectSlug}/
│   │   └── tokens.json        ← project registry
│   └── ...
└── src/
    ├── projects.ts            ← read/write tokens.json
    ├── builder.ts             ← FragmentBuilder.loadProject() + .useToken()
    ├── types.ts
    └── index.ts               ← MCP tools
```

### `tokens.json` format

```json
{
  "version": 1,
  "projectSlug": "<project>",
  "projectName": "Acme France",
  "webstudioProjectId": "...",        // optional, useful in Phase 2
  "figmaFileKey": "D2F2u...",         // optional, useful for Figma re-sync
  "tokens": {
    "background-dark": {
      "id": "tok_acme_background_dark",   // STABLE — prefix `tok_<projectSlug>_<tokenSlug>`
      "name": "Acme Background Dark",     // Webstudio name in the Tokens panel
      "styles": {
        "backgroundColor": { "type": "color", "colorSpace": "hex", "components": [0, 0.18, 0.21], "alpha": 1 }
      }
    },
    "heading-1": { ... },
    "button-primary": { ... }
  }
}
```

**ID convention**: `tok_<projectSlug>_<tokenSlug>` (clean alphanumeric). Stable across sessions, readable.

## Builder API

```ts
const b = new FragmentBuilder();

// Load the project registry (reads tokens.json)
b.loadProject("<project>");

// List the available tokens
b.getProjectTokens();  // [{ slug: "heading-1", name: "Acme Heading 1" }, ...]

// Create an instance
const title = b.addInstance("Heading", { id: "hero-title", tag: "h1", parentId: hero });

// Apply a token by slug — on the first call, the token is added to the fragment
// Subsequent uses reuse the same styleSourceId (deduplication)
b.useToken(title, "heading-1");

// Can be combined with local styles (override)
b.addStyle(title, "color", color("#ff0000"));  // override the token's color

// Multiple tokens can stack (the last one wins on conflicts)
b.useToken(card, "card-default");
b.useToken(card, "primary-blue");  // override backgroundColor of card-default
```

## Exposed MCP tools

| Tool | Role |
|---|---|
| `webstudio_init_project(projectSlug, projectName, ...)` | Creates the project structure (empty tokens.json). Idempotent. |
| `webstudio_list_projects()` | Lists all configured projects. |
| `webstudio_list_tokens(projectSlug)` | Lists a project's available tokens (slugs, names, properties). **Call before every section generation** to know which tokens exist. |
| `webstudio_define_token(projectSlug, tokenSlug, name, styles)` | Creates or updates a token. Stable ID is generated automatically. |
| `webstudio_build_fragment(... + projectSlug? + useTokens?)` | Extended: `projectSlug` loads the registry, `useTokens: [{ instanceId, tokenSlug }]` applies the registry tokens to the instances. |

## Standard workflow for a new project

### A) Onboarding a new project (once per client)

```
1. webstudio_init_project(slug, name, figmaFileKey)
2. mcp__figma__use_figma → extract variables (colors, spacings, typography)
3. webstudio_define_token(...) × N for each design system token
4. (Optional) Visual check: generate a swatch fragment via build_fragment
```

### B) Generating a section (on every request)

```
1. webstudio_list_tokens(slug) → Claude sees the available tokens
2. webstudio_build_fragment({
     projectSlug: slug,
     instances: [...],
     props: [...],
     styles: [...],          // local styles (overrides)
     useTokens: [             // tokens to apply
       { instanceId: "hero-section", tokenSlug: "background-dark" },
       { instanceId: "hero-title", tokenSlug: "heading-1" },
       { instanceId: "hero-cta", tokenSlug: "button-primary" }
     ]
   })
3. User pastes into Webstudio → tokens created (first time) or matched (subsequent times)
```

## Webstudio paste behavior

On the first paste containing tokens that are new for the project:
- Webstudio adds the tokens to the Tokens panel (visible via the palette icon on the left)
- The instances receive the styles through the token binding

On subsequent pastes with the same tokens (identical ID + name):
- Webstudio detects the conflict via `detectFragmentTokenConflicts`
- Dialog: "keep existing / overwrite"
- If "keep": the existing token stays, the new instances point to it
- If "replace": the token is updated with the new values (propagates to every instance that uses it)

## Current limitations (v1)

- No support for **breakpoints** in tokens (a token = "base" styles only). Responsive overrides must be local on the instances.
- No support for **states** (`:hover`, etc.) in tokens.
- No auto-extraction from Figma into tokens.json (manual pipeline via `define_token`).
- No consistency validation (e.g. 2 tokens with the same name but different slugs → Webstudio will match by name on the next paste).

To do later:
- A `webstudio_extract_tokens_from_figma(projectSlug, fileKey)` tool that automates the Figma → tokens.json pipeline
- Breakpoint variant support per token
- State variant support per token
- A "design system standards" helper lib (Open Props) for quick bootstrapping

## Recommended CSS vars to seed at every project init (convention)

Beyond the design tokens managed by `init_brand_tokens`, these **cross-cutting CSS vars** should be
seeded via `define_css_var` at the start of a project — validated on a production project (2026-05-13). Avoids
recreating these values in every component.

```js
webstudio_define_css_var({
  projectSlug: "<slug>",
  vars: {
    // Standard transitions
    "brand-transition-fast": "200ms",       // short hover color, opacity, transform
    "brand-transition-slow": "400ms",       // slide-in panels, drawer open
    "brand-easing-default": "cubic-bezier(0.4, 0, 0.2, 1)",  // Material standard
    "brand-easing-soft": "ease",            // subtle fallback

    // Subtle borders (hairline white on dark bg)
    "brand-color-border-subtle": { type: "unparsed", value: "rgba(255, 255, 255, 0.08)" },

    // Header offset (used by floating overlays / drawers)
    "brand-header-height": "6.5rem",        // adjust to the actual header height
  }
});
```

Use the `brand-` prefix by convention to distinguish cross-cutting (reusable) vars from
project-specific vars (`brand-*`, `acme-*`, etc.). Adapt to your internal naming.

These vars are consumed by the newer tools (`create_sheet`, `create_navigation_menu`) via
`topOffset: "var(--brand-header-height)"`, `viewportOffset: "var(--brand-transition-fast)"`, etc.
