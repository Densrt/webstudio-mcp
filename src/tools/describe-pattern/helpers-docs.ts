// Docs for builder helpers (sheet, tabs, navigationmenu, accordion, card, dialog).
// Consumed by webstudio_describe_pattern.

export type PatternDoc = {
  name: string;
  category: string;
  helper: string;
  description: string;
  options: Array<{ name: string; type: string; required?: boolean; default?: string; doc: string }>;
  result: Array<{ name: string; type: string; doc: string }>;
  example: string;
  notes?: string;
};

export const HELPER_DOCS: Record<string, PatternDoc> = {
  sheet: {
    name: "Sheet (mobile drawer)",
    category: "navigation",
    helper: "addSheet(builder, options)",
    description: "Mobile drawer with animated hamburger (3 bars → X), slide-in/out from left or right, dark overlay. Built on Radix Dialog + CSS keyframes.",
    options: [
      { name: "links", type: "{ label: string; href: string }[]", required: true, doc: "Navigation links" },
      { name: "parentId", type: "string", doc: "If provided, the Dialog becomes a child of this parent. Otherwise top-level." },
      { name: "id", type: "string", doc: "Prefix for deterministic IDs (default: nanoid)" },
      { name: "label", type: "string", default: "Mobile menu", doc: "Dialog label" },
      { name: "direction", type: "'left' | 'right'", default: "right", doc: "Slide direction" },
      { name: "panelBg", type: "hex string", default: "#111111", doc: "Panel background color" },
      { name: "textColor", type: "hex string", default: "#E5E5E5", doc: "Link color" },
      { name: "hoverColor", type: "hex string", default: "#E07B1A", doc: "Link hover color" },
      { name: "burgerColor", type: "hex string", default: "#111111", doc: "Burger bar color" },
      { name: "withCssEmbed", type: "boolean", default: "true", doc: "Include the sibling CSS embed with keyframes/vars" },
    ],
    result: [
      { name: "dialogId", type: "string", doc: "Radix Dialog ID" },
      { name: "buttonId", type: "string", doc: "Hamburger Button ID" },
      { name: "panelId", type: "string", doc: "DialogContent panel ID" },
      { name: "linkIds", type: "string[]", doc: "Nav link IDs" },
      { name: "cssEmbedId", type: "string?", doc: "CSS HtmlEmbed ID (if withCssEmbed)" },
    ],
    example: `import { addSheet } from "./dist/components.js";
const { dialogId, panelId } = addSheet(b, {
  links: [
    { label: "Home", href: "/" },
    { label: "Products", href: "/products" },
    { label: "Contact", href: "/contact" },
  ],
  direction: "right",
  panelBg: "#111111",
  hoverColor: "#E07B1A",
});`,
    notes: "Animation uses keyframes (not transition), otherwise the exit animation does not play with Radix. The burger needs z-index > overlay, otherwise it gets hidden during the open animation.",
  },
  tabs: {
    name: "Radix Tabs",
    category: "navigation",
    helper: "addTabs(builder, options)",
    description: "Radix Tabs with a list of triggers + content panels. Compatible with design system tokens.",
    options: [
      { name: "items", type: "{ label: string }[]", required: true, doc: "Triggers (one per tab)" },
      { name: "parentId", type: "string", doc: "Parent to insert the tabs into" },
      { name: "id", type: "string", doc: "ID prefix" },
    ],
    result: [
      { name: "tabsId", type: "string", doc: "Tabs root" },
      { name: "listId", type: "string", doc: "TabsList container" },
      { name: "triggerIds", type: "string[]", doc: "One per item" },
      { name: "contentIds", type: "string[]", doc: "One per item — attach content via parentId" },
    ],
    example: `const { triggerIds, contentIds } = addTabs(b, { parentId: card, items: [{label:"Bike"},{label:"Quad"}] });
contentIds.forEach((cid, i) => { const p = b.addInstance("Paragraph", { parentId: cid }); b.addText(p, labels[i]); });`,
  },
  navigationmenu: {
    name: "Radix NavigationMenu",
    category: "navigation",
    helper: "addNavigationMenu(builder, options)",
    description: "Horizontal desktop navigation menu (flat links). For mega-menus see pattern:\"navigation-menu-radix\" (full recipe with 3 critical pitfalls).",
    options: [
      { name: "items", type: "{ label, href, active? }[]", required: true, doc: "Nav links" },
      { name: "parentId", type: "string", doc: "Parent (typically the header)" },
    ],
    result: [
      { name: "navId", type: "string", doc: "NavigationMenu root" },
      { name: "listId", type: "string", doc: "NavigationMenuList" },
      { name: "itemIds", type: "string[]", doc: "Items (one per link)" },
    ],
    example: `addNavigationMenu(b, { parentId: header, items: [{label:"Home",href:"/"},{label:"About",href:"/about",active:true}] });`,
    notes: "For mega-menus with viewport: call webstudio_describe_pattern({pattern: \"navigation-menu-radix\"}) — full reverse-engineered recipe with 3 critical pitfalls (transition trap, viewport positioning, root max-width).",
  },
  accordion: {
    name: "Accordion (HTML <details>)",
    category: "structure",
    helper: "addAccordion(builder, options)",
    description: "Native HTML <details>/<summary> accordion (lighter alternative to Radix Accordion: smaller bundle, accessible by default).",
    options: [
      { name: "items", type: "{ summary, content, open? }[]", required: true, doc: "Sections" },
      { name: "parentId", type: "string", doc: "Parent" },
      { name: "borderColor", type: "hex string", doc: "Border between sections" },
    ],
    result: [
      { name: "containerId", type: "string", doc: "Container div" },
      { name: "itemIds", type: "{detailsId, summaryId, contentId}[]", doc: "One per item" },
    ],
    example: `addAccordion(b, { parentId: section, items: [
  { summary: "Question 1", content: "Answer 1" },
  { summary: "Question 2", content: "Answer 2", open: true },
]});`,
  },
  card: {
    name: "Card (image + title + text + CTA)",
    category: "structure",
    helper: "addCard(builder, options)",
    description: "Simple card with top image, title, text, and optional CTA. Sensible defaults (orange CTA, override via tokens).",
    options: [
      { name: "title", type: "string", required: true, doc: "Card title" },
      { name: "imageSrc", type: "string", doc: "URL or asset ID" },
      { name: "imageAlt", type: "string", doc: "Alt text" },
      { name: "text", type: "string", doc: "Paragraph content" },
      { name: "ctaLabel", type: "string", doc: "CTA button label" },
      { name: "ctaHref", type: "string", doc: "CTA link" },
      { name: "titleTag", type: "'h2'|'h3'|'h4'", default: "h3", doc: "Heading level" },
      { name: "bg / textColor / ctaBg / ctaTextColor", type: "hex string", doc: "Custom colors" },
    ],
    result: [
      { name: "cardId", type: "string", doc: "Article container" },
      { name: "imageId / titleId / textId / ctaId", type: "string?", doc: "Sub-element IDs (optional, depending on options)" },
    ],
    example: `addCard(b, { parentId: grid, title: "Our bike", text: "Description", imageSrc: "...", ctaLabel: "View", ctaHref: "/bike" });`,
  },
  ticker: {
    name: "Ticker (marquee CSS)",
    category: "motion",
    helper: "addTicker(builder, options)",
    description: "Infinite horizontal scrolling band of logos / testimonials / news. Pure CSS, single HtmlEmbed, pauses on hover, respects prefers-reduced-motion.",
    options: [
      { name: "items", type: "{ href, ariaLabel, svg | imgSrc, imgAlt? }[]", required: true, doc: "Logos / cards. Duplicated automatically with aria-hidden on the second half." },
      { name: "parentId", type: "string", doc: "Parent instance" },
      { name: "classPrefix", type: "string", default: "tk", doc: "CSS class prefix (avoid collisions when multiple tickers per page)" },
      { name: "durationSec", type: "number", default: "30", doc: "Scroll duration in seconds" },
      { name: "heightPx / logoHeightPx / gapPx / fadeMaskPx", type: "number", doc: "Sizing knobs" },
      { name: "direction", type: "'left' | 'right'", default: "left", doc: "Scroll direction" },
      { name: "pauseOnHover", type: "boolean", default: "true", doc: "Pause when hovered" },
    ],
    result: [
      { name: "embedId", type: "string", doc: "HtmlEmbed instance ID" },
      { name: "html", type: "string", doc: "The full HTML pushed as `code` prop (useful for tests / inspection)" },
      { name: "className", type: "string", doc: "The CSS class root (e.g. 'myproj-tk')" },
    ],
    example: `addTicker(b, {
  parentId: section,
  classPrefix: "myproj-tk",
  items: [
    { href: "https://a.com", ariaLabel: "Acme", svg: "<svg>...</svg>" },
    { href: "https://b.com", ariaLabel: "Beta", imgSrc: "/logo-b.png", imgAlt: "Beta" },
  ],
});`,
    notes: "Each item is rendered TWICE in the DOM to make the loop seamless. Duplicates stay clickable but get aria-hidden+tabindex=-1 so screen readers and keyboard navigation skip them.",
  },
  bento: {
    name: "Bento (multi-cell CSS grid)",
    category: "structure",
    helper: "addBento(builder, options)",
    description: "Asymmetric CSS grid layout with cards positioned via grid-column / grid-row spans. Collapses to a 1-column stack on mobile by default.",
    options: [
      { name: "items", type: "{ col, row, bg?, textColor?, label?, text? }[]", required: true, doc: "Cards. col/row accept CSS values like 1, '1 / 3'." },
      { name: "columns", type: "string", default: "1fr 1fr", doc: "grid-template-columns" },
      { name: "rows", type: "string", default: "repeat(6, 1fr)", doc: "grid-template-rows" },
      { name: "gapPx / paddingPx / radiusPx / minHeightPx", type: "number", doc: "Sizing" },
      { name: "mobileBreakpointLabel", type: "string | null", default: "Mobile portrait", doc: "Breakpoint where the layout collapses to 1 column. Pass null to disable." },
    ],
    result: [
      { name: "gridId", type: "string", doc: "Grid container" },
      { name: "cardIds", type: "string[]", doc: "One per item" },
    ],
    example: `addBento(b, {
  parentId: section,
  columns: "1fr 1fr",
  rows: "repeat(6, 1fr)",
  items: [
    { col: 1, row: "1 / 4", bg: "#7c3aed" },
    { col: 1, row: "4 / 7", bg: "#0891b2" },
    { col: 2, row: "1 / 3", bg: "#dc2626" },
    { col: 2, row: "3 / 5", bg: "#16a34a" },
    { col: 2, row: "5 / 7", bg: "#ea580c" },
  ],
});`,
    notes: "Visual styling (colors, padding, radius) is built-in via options. To use design-system tokens instead, apply them after via webstudio_apply_token on the returned IDs.",
  },
  carousel: {
    name: "Carousel (CSS scroll-snap, no lib)",
    category: "motion",
    helper: "addCarousel(builder, options)",
    description: "Horizontal scroll-snap carousel with prev/next arrows driven by a small inline JS. No external dependency. Use addSwiper if you need autoplay / loops / effects.",
    options: [
      { name: "slides", type: "{ label?, text? }[]", doc: "Static slides. Provide either slides or slotCount." },
      { name: "slotCount", type: "number", doc: "Alternative: create N empty placeholders (typically replaced by a ws:collection later)" },
      { name: "cardsPerView", type: "{ desktop, tablet, mobile }", default: "{ 3, 2, 1 }", doc: "Visible cards per breakpoint" },
      { name: "gap", type: "CSS length", default: "16px", doc: "Gap between cards (accepts var(--token))" },
      { name: "arrows", type: "boolean", default: "true", doc: "Render prev/next buttons" },
      { name: "hideArrowsBelow", type: "string | null", default: "Mobile portrait", doc: "Breakpoint where arrows disappear (native swipe takes over)" },
    ],
    result: [
      { name: "wrapperId / trackId / slideIds / prevId / nextId / embedId", type: "string", doc: "Component IDs" },
    ],
    example: `addCarousel(b, {
  parentId: section,
  cardsPerView: { desktop: 4, tablet: 2, mobile: 1 },
  gap: "var(--gap-2)",
  slides: [{ text: "Slide A" }, { text: "Slide B" }, { text: "Slide C" }, { text: "Slide D" }],
});`,
    notes: "Track uses grid + gridAutoColumns: calc((100% - gaps) / N) instead of flex so card widths can never bust the viewport. The init script is scoped per [data-carousel-root] so multiple carousels coexist.",
  },
  swiper: {
    name: "Swiper (carousel via Swiper.js CDN)",
    category: "motion",
    helper: "addSwiper(builder, options)",
    description: "Full-featured carousel: loop, autoplay, pagination dots, navigation arrows, effects (fade/cube/coverflow/etc). Pulls Swiper.js from a CDN, lazy-inits via IntersectionObserver, scoped per [data-swiper-root].",
    options: [
      { name: "slides", type: "{ imgSrc, alt?, caption? }[]", doc: "Static image slides. Leave empty if you'll attach a ws:collection to wrapperEl later." },
      { name: "config", type: "SwiperConfig", doc: "Runtime config: loop, slidesPerView, spaceBetween, speed, autoplay, pagination, navigation, effect" },
      { name: "maxWidthPx", type: "number", default: "720", doc: "Max width of the carousel container" },
      { name: "aspectRatio", type: "string | null", default: "16 / 9", doc: "CSS aspect-ratio. null to skip." },
      { name: "swiperVersion", type: "string", default: "11", doc: "Pin a specific Swiper major" },
    ],
    result: [
      { name: "rootId / swiperEl / wrapperEl / slideIds / paginationEl / embedId / embedHtml", type: "string", doc: "Component IDs + the embed HTML" },
    ],
    example: `addSwiper(b, {
  parentId: section,
  slides: [
    { imgSrc: "/a.jpg", alt: "A" },
    { imgSrc: "/b.jpg", alt: "B" },
  ],
  config: { loop: true, autoplay: { delay: 4000 }, pagination: true, effect: "fade" },
});`,
    notes: "Use addSwiper when you need autoplay / loop / effects. For a no-dependency horizontal carousel with arrows, addCarousel is lighter.",
  },
  dialog: {
    name: "Radix Dialog (modal)",
    category: "navigation",
    helper: "addDialog(builder, options)",
    description: "Standard Radix modal Dialog with trigger button, overlay, and content. For mobile drawers prefer addSheet.",
    options: [
      { name: "triggerLabel", type: "string", doc: "Trigger button text" },
      { name: "title", type: "string", doc: "DialogTitle" },
      { name: "description", type: "string", doc: "DialogDescription" },
      { name: "parentId", type: "string", doc: "Parent" },
    ],
    result: [
      { name: "dialogId / triggerId / overlayId / contentId / closeId", type: "string", doc: "Component IDs" },
    ],
    example: `addDialog(b, { parentId: section, triggerLabel: "Open", title: "Confirm", description: "..." });`,
  },
};

export function renderHelperDoc(p: PatternDoc): string {
  const optsTable = p.options
    .map((o) => `  - ${o.name}${o.required ? " *" : ""} (${o.type})${o.default ? ` [default: ${o.default}]` : ""}: ${o.doc}`)
    .join("\n");
  const resultTable = p.result.map((r) => `  - ${r.name} (${r.type}): ${r.doc}`).join("\n");

  return `# ${p.name}

Category: ${p.category}
Helper: ${p.helper}

${p.description}

## Options
${optsTable}
(* = required)

## Result
${resultTable}

## Example
\`\`\`ts
${p.example}
\`\`\`
${p.notes ? `\n## Notes\n${p.notes}` : ""}`;
}
