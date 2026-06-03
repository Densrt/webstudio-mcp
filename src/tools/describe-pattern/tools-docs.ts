// Deep usage docs for selected webstudio_* tools.
// Lazy-loaded via webstudio_describe_pattern (tool:"<name>") so the per-session
// description budget stays slim while detail remains on-demand.

export const TOOL_DOCS: Record<string, string> = {
  webstudio_upload_asset: `Two-step workflow handled internally:
  1. POST /rest/assets registers metadata (assetId, type, filename) -> server returns the canonical name (basename + 8-char random suffix + ext).
  2. POST /rest/assets/<name> uploads the raw binary body.
After upload, the asset is accessible at /cgi/asset/<name>.
To bind on an Image src after upload:
  webstudio_instance_prop({ updates: [{ instanceId, propName: "src", type: "asset", value: "<assetId>" }] })
dryRun returns the computed assetId + detected MIME + dedupe status without contacting the upload endpoint (useful to check duplicates before push).`,

  webstudio_extract_variant_token: `Workflow:
  1. Targets N instances that use 'sourceToken'.
  2. Creates 'newTokenName' = sourceToken's decls + overrides (explicit or auto-detected from locals).
  3. Replaces sourceToken with newToken in each target instance's selection.
  4. Removes the now-covered local decls (auto cleanup).
Override modes:
  - Explicit: pass \`overrides: { "color": { type: "var", value: "..." }, "fontSize": { type: "unit", unit: "rem", value: 1 } }\`.
  - Auto-detect (omit 'overrides'): scans target instances for local decls shared across ALL of them on the (breakpoint, state) couple, that differ from the source token. Keeps only unanimous overrides.
The new token id is stable, like \`tok_<slug>_<rand>\`.
Typical trigger: detected via dedupe_token_locals --mode=auto-force (overrides found). Run extract_variant_token to turn those overrides into a clean shared variant token.`,

  webstudio_instance_prop: `Single dispatcher for prop ops on instances. Pick action: "update" | "delete" | "bind".

UPDATE (action:"update") — set a LITERAL prop value (href, src, alt, ariaLabel, role, asset id).
  href format:
  - type:"string", value:"/contact"            -> direct path (simple)
  - type:"string", value:"https://..."         -> external URL
  - type:"page",   value:{ type:"page", instanceId|pageId } -> typed reference (rename-safe)
  Safety: preserveExpressions=true refuses to overwrite a prop currently of type "expression" with a different type (would silently break dynamic bindings — e.g. Image.src bound to a collection item field). Pass force=true to override, or preserveExpressions=false on that update.

DELETE (action:"delete") — remove a prop from an instance entirely. Cleaner than passing value="".

BIND (action:"bind") — set a prop to a DYNAMIC EXPRESSION.
  Binding shapes:
  - { kind: "variable", dataSourceId, path? } : direct bind. path is a JS access path: ["data","items",0,"title"] -> .data.items[0].title
  - { kind: "template", parts: [...] } : string + variable concat. parts items: { type:"text", value:"..." } or { type:"variable", dataSourceId, path? }
  - { kind: "raw", expression: "..." } : raw JS expression (advanced; you provide the encoded form).
  Typical use cases: bind alt of a dynamic image to a content field; bind href of a card to "/<base>/" + slug; bind ariaLabel of a button to a form input value.
  WARNING: resources are wrapped in {ok, status, data} — expression path MUST start with .data. (variables/parameters have no wrapper).`,

  webstudio_audit_overflow: `Severity matrix (full list of detectors):
CRITICAL:
  - Fixed width/min-width in px > viewport without smaller mobile override
  - grid-template-columns with \`1fr\` not wrapped in \`minmax(0, 1fr)\` (children bust the grid)
  - flex-wrap: nowrap with multiple children
  - Negative margins
  - Inline SVG with hardcoded px width > viewport
WARNING:
  - Padding/margin px > 32 on Base without mobile override
  - overflow-x explicitly set to visible/auto/scroll
  - font-size px > 48 without smaller override
HINT:
  - position absolute with right/left in extreme px
  - Long unbreakable text (emails, URLs) without overflow-wrap/word-break on the element
Default target: Mobile portrait (max 479px). Pass breakpoint="all" to scan every breakpoint.
Each issue includes: instance id, label, the offending property/value, the breakpoint, and a suggested fix when obvious.`,

  webstudio_styles: `Single dispatcher for local-styles ops. Pick action: "update" | "delete-decl" | "replace-value".

UPDATE (action:"update") — set/update LOCAL style decls on a single instance.
  Non-rendering wrapper safety: refuses to apply styles to wrapper components that don't render their own DOM node (DialogTrigger, DialogClose, DialogPortal, PopoverTrigger, PopoverClose, PopoverPortal, SheetTrigger, SheetClose, SheetPortal, TabsTrigger, AccordionTrigger, TooltipTrigger, TooltipPortal, DropdownMenuTrigger, DropdownMenuPortal, Slot). Styles set on these have no visible effect — target the inner child instead, or pass ignoreWrapperWarning=true.

DELETE-DECL (action:"delete-decl") — remove a specific local style decl from an instance (property, breakpoint, state). Cleaner than passing value="" which leaves a dangling decl.

REPLACE-VALUE (action:"replace-value") — bulk replace local decls matching (property, fromValue) tuple by toValue across the project.
  Match semantics: every local decl with property=X AND value strictly equal to fromValue (deep equality).
  Filters (all optional, AND-combined): instanceLabel (exact), component (exact, e.g. "Image"), tag (HTML tag), pageId|pagePath, breakpoint (label or id), state ("" = default state only).
  includeTokens=false by default — tokens are protected. Set true to also touch token-level decls (dangerous, affects all instances of the token).
  Typical use: replace recurring hardcoded px values by a design system var(). Example: every "Arrow" instance with rowGap=8px → var(--mybrand-space-s) across the whole project.`,

  webstudio_create_resource: `Response envelope shape: { ok: boolean, status: number, statusText: string, data: <body parsed as JSON or text> }
IMPORTANT: to access the response body, the path MUST start with "data". Example: response \`{"name":"Leanne"}\` → use \`path: ["data", "name"]\`. For HTTP error handling, bind to \`path: ["ok"]\` or \`["status"]\`.
Example use case: dynamic page (e.g. product detail) — \`url = 'https://api.example.com/products/' + system.params.slug\`, then bind page fields to resource paths.
Default SSR cache: 1h TTL via auto-injected \`Cache-Control: max-age=3600\`. Skipped if the user already provides a Cache-Control header.`,

  webstudio_update_token_styles: `Common use cases:
  - Tweak a token color/size without recreating
  - Swap a placeholder backgroundImage in a token referenced by N instances (e.g. replace by a clean gradient)
  - Add a new declaration to a token
After bulk edits, follow up with webstudio_audit_token_usage + webstudio_dedupe_token_locals to clean up duplicates.`,

  webstudio_inspect_resource: `Outputs:
  - Resolved URL with searchParams + headers (JSON-decoded from Webstudio storage)
  - HTTP status, response Content-Type
  - Truncated JSON body sample
  - Top-level schema (keys + inferred types) — handy to figure out the access path for bindings
When the resource has searchParams or headers bound to runtime expressions (e.g. system.params.slug), you MUST provide overrides via the searchParams/headers params, otherwise the request fires with the literal expression text and likely fails server-side.`,

  webstudio_update_page: `Supported fields:
  - name: name shown in the Pages panel
  - path: URL path (uniqueness validated)
  - title: HTML title
  - meta.description, meta.language, meta.redirect, meta.socialImageUrl: strings (encoded as expressions)
  - meta.excludePageFromSearch: boolean (encoded as expression)
  - meta.documentType: "html" or "xml" (enum, no encoding)
  - meta.socialImageAssetId: asset sha256 (raw string, no encoding). Native social image — Webstudio renders OG image from this asset with dashboard preview + Cloudflare transform. RECOMMENDED over socialImageUrl.
Conflict handling: setting socialImageAssetId removes socialImageUrl (and vice-versa).`,

  webstudio_update_instance_text: `mode="expression" example: convert a static text to a binding (Tag of a Hero: "MyBrand" → expression \`$ws$dataSource$X.categorie\`).
childIndex (default 0) lets you pick which text/expression child to replace when the instance has multiple eligible children.`,

  // (webstudio_styles already documented above with action:"update" | "delete-decl" | "replace-value")

  webstudio_css_var: `Example payload:
  vars: {
    "mybrand-radius-s": { type:"unit", unit:"px", value:2 },
    "mybrand-font-weight-bold": { type:"unit", unit:"number", value:700 },
    "mybrand-letter-spacing-uppercase": { type:"unit", unit:"px", value:1 }
  }
Implementation note: the tool looks up the ":root"-instance selection, picks the first local source on it, or bootstraps a fresh local + selection when none exists.`,

  webstudio_rename_tokens: `Examples:
  - Remove project prefix (when scoped to that project): fromPattern: "^MyBrand ", toReplacement: ""
  - Rename family:                                       fromPattern: "^Text ", toReplacement: "Heading "
  - Backref:                                             fromPattern: "^MyBrand (.+) Dark$", toReplacement: "$1 (dark)"`,

  webstudio_dedupe_token_locals: `Typical chain: audit_token_usage finds duplicates → dedupe_token_locals (auto-dedupe) cleans them; if auto-force overrides are needed, follow with extract_variant_token to turn the override pattern into a clean shared variant.`,

  webstudio_init_brand_tokens: `Generates tokens with stable slugs: color-<slug>, spacing-<slug>, font-<slug>, text-<slug>, radius-<slug>.
Color: hex → token with \`color\` property (also usable for backgroundColor/borderColor).
Spacing: stored as multi-side padding (paddingTop/Right/Bottom/Left) for flexible reuse.
Radius: stored as 4-corner borderRadius for flexible reuse.
Reuse afterwards via useTokens:[{instanceId, tokenSlug}] in build_fragment / push_fragment.
Example payload:
{
  projectSlug: "brand-x",
  colors: { primary: "#E07B1A", dark: "#111", light: "#F5F5F5" },
  spacings: { sm: 8, md: 16, lg: 24 },
  fontSizes: { sm: 0.875, base: 1, lg: 1.25 },
  fonts: { heading: ["Bebas Neue", "sans-serif"] },
  radii: { md: 8, full: 9999 }
}`,

  webstudio_flatten_instance: `Use case: structural simplification.
Example:
  <div Title>
    <h2>Title</h2>
    <div Arrow>...</div>
  </div>
With dropChildLabels=["Arrow"], the wrapper and the Arrow are removed; the <h2> takes the wrapper's place in the parent.
Cleanup: removes the wrapper + dropped children + all their descendants (instances, props, styleSourceSelections, local styleSources, styles).`,

  webstudio_clone_subtree: `Typical use: duplicate page content (e.g. clone /source-page's <main> onto /target-page's <main>) while preserving each page's pageId, URL, and meta.
What gets cloned with new IDs: instances, their props, local style sources + their styles, styleSourceSelections (with token IDs preserved as-is), dataSources, resources.`,

  webstudio_bind_page_field: `Binding shapes:
  - { kind: "variable", dataSourceId } : direct bind (equivalent to JSON.stringify of the variable value)
  - { kind: "template", parts: [...] } : string + variable concat. parts items: { type:"text", value:"..." } or { type:"variable", dataSourceId }
  - { kind: "raw", expression: "..." } : raw JS expression (advanced)
After push: reload the builder tab to see the binding appear in Page Settings.`,
};
