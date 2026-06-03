---
name: Recipes design system — reproducible workflows
description: Figma charter onboarding → Webstudio, perf audit cycle, token troubleshooting
category: workflow
complexity: medium
lastUpdated: 2026-05-20
recommendedTool: (workflow)
recommendedToolNote: Figma → Webstudio onboarding + perf audit cycle
---

# Webstudio design system recipes

Workflows validated on a production project (2026-05-12). Reuse them for any new project.

## 🎨 Recipe 1 — Onboard a Figma charter (simple workflow)

**When to use it**: new project, a reference Figma is available with named Figma variables (colors, spacing, typography).

### Prerequisites
- The Webstudio project exists (Project ID) and MCP auth is configured (`init_project` + `setup_auth`)
- The Figma file has a "Design System" page with exposed variables
- Figma MCP is authenticated (otherwise `mcp__figma__authenticate` then `complete_authentication`)

### Steps (≈ 5 calls)

```js
// 1. Extract the Figma variables
mcp__figma__get_variable_defs({ fileKey: "<KEY>", nodeId: "<NODE>" })
// → returns a dict { "the project/color/primary": "#82bb25", "title/h1": "Font(...)", ... }

// 2. Enable allowPush
webstudio_allow_push({ projectSlug: "<slug>", allow: true })

// 3. Bridge Figma → Webstudio (push CSS vars + tokens in 1 transaction)
webstudio_import_figma_variables({
  projectSlug: "<slug>",
  variables: <dict from step 1>,
  prefix: "brand",      // or another, becomes --brand-color-*, --brand-space-*, etc.
  dryRun: true        // ALWAYS dryRun first, validate the plan, then dryRun:false
})

// 4. Upload the identified fonts
webstudio_upload_asset({ projectSlug: "<slug>", url: "https://cdn.jsdelivr.net/fontsource/fonts/<family>@latest/latin-<weight>-normal.woff2", filename: "<Family>-<Weight>.woff2" })
// repeat for each (family, weight) — typically 3-5 files

// 5. Disable allowPush
webstudio_allow_push({ projectSlug: "<slug>", allow: false })
```

### Why it works
- `import_figma_variables` parses hex colors, spacing units (px→rem auto), and `Font(family:..., size:..., weight:...)` composites
- Smart mapping: Figma prefixes (`the project/color/X`, `acme-title/h1`) → canonical CSS names (`--brand-color-x`, `--brand-title-h1`)
- Automatic ASCII transliteration (`gris-foncé` → `gris-fonce`)
- A single Webstudio transaction = atomic (all-or-nothing)

### Limitations
- If a Figma variable's value is not a hex / number / `Font(...)` (e.g. composite shadow, color with a separate opacity) → it falls through as `unparsed`, to be checked in the WS panel after the push
- Figma's `lineHeight: 100` is handled with a heuristic: 100 → 1.0 ratio. If Figma stored it in px, you have to override.

## 🎨 Recipe 2 — Onboard a charter manually (no Figma MCP)

**When to use it**: no Figma file, charter provided as PDF/Doc, or a Figma without exposed variables (just colors hardcoded in the components).

```js
// 1. Allow push
webstudio_allow_push({ projectSlug, allow: true })

// 2. Define CSS vars (accepts raw CSS strings via the smart parser)
webstudio_define_css_var({
  projectSlug,
  dryRun: false,
  vars: {
    "brand-color-primary": "#82BB25",          // ← string raw OK
    "brand-color-black": "#080808",
    "brand-space-m": "1rem",                   // ← unit auto-detected
    "brand-title-h1": "clamp(2.5rem, calc(0.74vw + 1.85rem), 3rem)",  // ← unparsed
    // ...
  }
})

// 3. Upload fonts (Fontsource ou file local)
webstudio_upload_asset({
  projectSlug,
  url: "https://cdn.jsdelivr.net/fontsource/fonts/sora@latest/latin-700-normal.woff2",
  filename: "Sora-Bold.woff2"
})

// 4. Create tokens (batch)
webstudio_create_tokens({
  projectSlug,
  dryRun: false,
  strict: true,                              // ← rejects if var ref missing (integrity)
  tokens: [
    {
      name: "Titre H1",
      styles: {
        fontFamily: {type:"fontFamily", value:["Sora"]},
        fontSize: {type:"var", value:"brand-title-h1"},  // ← references the var created in step 2
        fontWeight: {type:"unit", unit:"number", value:700},
        lineHeight: {type:"unit", unit:"number", value:1.1}
      }
    },
    // ... other tokens
  ]
})

// 5. Disallow push
webstudio_allow_push({ projectSlug, allow: false })
```

## 🔍 Recipe 3 — Full perf audit (site with content)

Run periodically, or before a go-live.

```js
webstudio_audit_fonts({ projectSlug, sizeThresholdKB: 80 })
// → flag fonts > 80KB, non-.woff2 format, weights uploaded but not used in styles

webstudio_audit_images({ projectSlug, heroDepth: 3 })
// → flag Images without loading attr, hero without eager, below-fold without lazy, raw <img> in HtmlEmbed

webstudio_audit_scripts({ projectSlug })
// → flag render-blocking scripts, external Google Fonts, detected trackers

webstudio_audit_resources_perf({ projectSlug, maxPerPageThreshold: 5 })
// → flag duplicated URLs, sync chains, missing cacheMaxAge, count per page

webstudio_audit_orphans({ projectSlug })
// → periodic cleanup: variables/resources/assets/tokens never referenced
```

## 🔍 Recipe 4 — Full cleanup (nuke a project)

To reuse a project as a template, or to perform a full reset.

```js
// 1. Mandatory backup before nuke
webstudio_allow_push({ projectSlug, allow: true })
webstudio_export_project({
  projectSlug,
  outputPath: "/path/to/backups/<slug>-pre-nuke-<date>.json"
})

// 2. Nuke (dryRun=true first to see the plan)
webstudio_nuke_project({
  projectSlug,
  confirm: "<slug>",          // MUST be strictly equal to the projectSlug (safeguard)
  keepHomeEmpty: true,        // keeps the home page but wipes its content
  scope: {                    // all categories by default
    pages: true, folders: true, variables: true, resources: true,
    assets: true, cssVars: true, tokens: true, orphanLocals: true
  },
  dryRun: true
})
// Validate the plan, then dryRun: false for the real nuke

// 3. Verify
webstudio_audit_orphans({ projectSlug })
// should output "✅ clean" everywhere

// 4. Allow push off
webstudio_allow_push({ projectSlug, allow: false })
```

## 🚨 Troubleshooting

### "INSTANCE_NOT_FOUND" on `:root`
**Cause**: you are using an MCP build from before the patch of 2026-05-12 evening. Update the MCP via `git pull` on `webstudio-mcp`, then reload Claude Code.

### "Validation error" on `define_css_var` with strings
**Cause**: you are on an old version. The smart parser lands in commit `c8e3977`. Update + reload.

### Tokens created but invisible in Webstudio
**Cause**: you used `define_token` (LOCAL only). Switch to `create_token` (direct push) or run `sync_local_tokens` to push the local set to Cloud.

### Font uploaded but unused (used=0 in `list_assets`)
**Normal** when no style/token declares `font-family: <Family>`. Create a typography token (`fontFamily: ["Sora"]`) and apply it to instances → the asset will become `used=N`.

### The audit says "X orphans" but is that normal?
Yes, it is expected right after seeding. Variables/CSS vars/tokens are created BUT not yet consumed by any instance. Once you start building the site (header/footer/sections), the usages will climb automatically. The audit is useful **mid-build** and **before prod**, not right after seeding.

### The Webstudio cookie/csrf is expired
Symptom: `Auth required` or `Session expired` on every tool. Solution: re-run `webstudio_setup_auth` with a fresh cookie copied from F12 → Network → `/trpc/polly.poll` → Request Headers (`cookie`, `x-csrf-token`, `x-webstudio-client-version`).

## 📚 References
- [Session 2026-05-12 evening](session_2026_05_12_evening_design_system.md) — details of the 16 tools shipped
- [CSS vars scope pattern](pattern_css_vars_scope.md) — when to put a var on :root vs body
- [Tokens architecture](architecture_tokens.md) — project token system (local vs Cloud, stable IDs)
