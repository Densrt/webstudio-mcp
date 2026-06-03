#!/usr/bin/env node
// One-shot migration: inject `recommendedTool` + `recommendedToolNote` into the
// frontmatter of each docs/patterns/*.md, sourced from the (now-deprecated)
// PATTERN_TO_TOOL mapping in src/tools/meta-mega.ts (v2.7.0).
//
// After this runs, PATTERN_TO_TOOL is dead code and the meta.guide handler
// reads recommendedTool/Note directly from listPatternResources(). New patterns
// only need to declare these two fields in their frontmatter — zero TS edits.
//
// Run: node scripts/migrate-frontmatter-recommended-tool.mjs
// Idempotent: skips files that already have a recommendedTool line.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const patternsDir = resolve(here, "../docs/patterns");

// Sourced verbatim from src/tools/meta-mega.ts (v2.7.0 PATTERN_TO_TOOL).
const PATTERN_TO_TOOL = {
  "navigation-menu-radix": { tool: "build.create_navigation_menu", note: "one-call desktop mega menu (Radix NavigationMenu + chevron rotation)" },
  "sheet-mobile-radix": { tool: "build.create_sheet", note: "one-call mobile drawer with collapsibles + CTA + socials" },
  "inline-bg-image-overlay": { tool: "build.push_fragment + styles.update", note: "set backgroundImage:{type:'layers',value:[gradient,image]} on the element itself — NOT nested absolute divs" },
  "ws-collection-bindings": { tool: "cms.bind_collection_to_instance", note: "creates Resource + ws:collection in one call (Directus / WordPress / n8n)" },
  "ticker-recipe": { tool: "build.push_fragment", note: "use a single HtmlEmbed with CSS marquee keyframes" },
  "swiper-carousel": { tool: "build.push_fragment", note: "HtmlEmbed for Swiper.js init + .swiper structure as instances" },
  "carousel-scroll-snap": { tool: "build.push_fragment", note: "pure CSS scroll-snap horizontal — no JS" },
  "tabs-radix-gotchas": { tool: "build.push_fragment", note: "use the native Radix Tabs components (Tabs/TabsList/TabsTrigger/TabsContent) — NEVER custom HTML" },
  "video-component": { tool: "build.push_fragment", note: "use the native Video component — NEVER ws:element tag='video' (breaks SSR)" },
  "component-architecture": { tool: "(read FIRST — decision tree)", note: "CSS vars vs tokens vs locals — read before any push_fragment with new components" },
  "reset-margins-global": { tool: "build.push_fragment", note: "drop one HtmlEmbed at body root with p/h1-h6 margin reset" },
  "css-vars-scope": { tool: "cssvar.define", note: "multi-brand: scope custom properties to body[data-brand]; single-brand: :root" },
  "tokens-variants-vs-overrides": { tool: "tokens.extract_variant", note: "variant token if a local override pattern is reused ≥2x (ghost/outline button)" },
  "hover-cascade-via-css-vars": { tool: "styles.update + cssvar.define", note: "parent :hover sets a custom prop, child consumes it — bypasses Webstudio UI limitation" },
  "html-embed-css-injection": { tool: "build.push_fragment (HtmlEmbed)", note: "last-resort stylesheet — use sparingly when no panel option exists" },
  "variables-and-bindings": { tool: "variables.create + variables.bind_page_field", note: "format: $ws$dataSource$<id> in expressions" },
  "resources-http-data": { tool: "resources.create", note: "HTTP fetched data exposed as dataSource type 'resource'" },
  "border-color-ui-quirk": { tool: "styles.update", note: "write color on all 4 sides; limit width/style to the wanted side(s)" },
  "flexbox-flex-basis-direction-trap": { tool: "styles.update", note: "override flex-basis on column breakpoint — flex:1 collapses height when direction flips" },
  "page-management": { tool: "pages.create / pages.delete", note: "meta = expressions JSON-stringified, nanoid 21 chars" },
  "paste-debug-method": { tool: "(debug method)", note: "systematic isolation when copy-paste produces text instead of components" },
  "radix-components-reference": { tool: "(reference)", note: "cartography of every Radix component exposed by Webstudio (namespace, structure, props)" },
  "recipes-design-system": { tool: "(workflow)", note: "Figma → Webstudio onboarding + perf audit cycle" },
  "webstudio-fragment-format": { tool: "(reference)", note: "JSON format captured via copy from the builder" },
  "webstudio-cloud-auth": { tool: "auth.setup", note: "cookies + CSRF + sec-fetch headers for tRPC access" },
  "architecture-tokens": { tool: "tokens.init_brand_kit + tokens.sync_local", note: "registry tokens.json per project with stable IDs" },
  "trpc-api-reference": { tool: "(reference)", note: "tRPC mutation universelle build.patch + Immer JSON patches" },
  "font-naming-conventions": { tool: "assets.upload", note: "parseSubfamily bug: italic without weight keyword in subfamily → font-weight 900 instead of 400" },
};

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

let patched = 0;
let skipped = 0;
let missing = 0;
const noMapping = [];

for (const entry of readdirSync(patternsDir)) {
  if (!entry.endsWith(".md")) continue;
  const slug = entry.replace(/\.md$/, "");
  const mapping = PATTERN_TO_TOOL[slug];
  if (!mapping) {
    noMapping.push(slug);
    continue;
  }
  const path = join(patternsDir, entry);
  const body = readFileSync(path, "utf8");
  const fm = body.match(FRONTMATTER_RE);
  if (!fm) {
    console.error(`✗ ${slug}: no frontmatter block — skipped`);
    missing += 1;
    continue;
  }
  const fmBody = fm[1];
  if (/^recommendedTool:/m.test(fmBody)) {
    console.log(`= ${slug}: already has recommendedTool — skipped`);
    skipped += 1;
    continue;
  }
  // Insert the two lines at the end of the frontmatter block (before the closing ---).
  // Escape any literal quotes in note that could break YAML, though our values are
  // bare scalars so the parser used by extractFrontmatter accepts them as-is.
  const recommendedToolLine = `recommendedTool: ${mapping.tool}`;
  const recommendedToolNoteLine = `recommendedToolNote: ${mapping.note}`;
  const newFmBody = fmBody.replace(/\s*$/, "") + "\n" + recommendedToolLine + "\n" + recommendedToolNoteLine;
  const newBody = body.replace(FRONTMATTER_RE, `---\n${newFmBody}\n---\n`);
  writeFileSync(path, newBody);
  console.log(`✓ ${slug}: patched`);
  patched += 1;
}

console.log("\n=== summary ===");
console.log(`patched : ${patched}`);
console.log(`skipped : ${skipped} (already had recommendedTool)`);
console.log(`missing : ${missing} (no frontmatter block)`);
if (noMapping.length > 0) {
  console.log(`no mapping in PATTERN_TO_TOOL for: ${noMapping.join(", ")}`);
}
