// Radix NavigationMenu helper with mega-menu support — desktop top nav with optional
// multi-column dropdowns. Built on the pattern documented in pattern:"navigation-menu-radix".
//
// Structure produced:
//   NavigationMenu (root, position:relative, max-width:max-content)
//   ├── NavigationMenuList (flex row, gap)
//   │   ├── Item (flat) → NavigationMenuLink > Link > text
//   │   └── Item (mega) → NavigationMenuTrigger > Button > [Text + Box.Icon > HtmlEmbed.Chevron]
//   │                   + NavigationMenuContent > Box.Panel > [Box.Col×N, optional Image]
//   ├── Box "Viewport Container" (position:absolute, top:100%, marginTop=offset, flex justify-center)
//   │   └── NavigationMenuViewport (position:relative, width/height from --radix-* vars)
//   └── HtmlEmbed "Mega menu animations CSS" (override Radix data-motion defaults with fade)
//
// All 4 critical pitfalls from the pattern doc are handled:
//   1. No transition on viewport width/height
//   2. Viewport container position:absolute, NavigationMenu position:relative
//   3. NavigationMenu max-width:max-content
//   4. Animation override via data-role + sibling CSS embed

import { FragmentBuilder, newId, color, px, num, keyword, raw, transitionLonghands } from "../builder.js";
import type { InstanceId, StyleValue } from "../types.js";

const CHEVRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

export type MegaColumn = { items: { label: string; href: string }[]; title?: string };

export type MegaPanel = {
  columns: MegaColumn[];
  /** Optional image displayed to the right of the columns. */
  image?: { assetId: string; alt?: string; width?: StyleValue };
};

export type MegaNavItem =
  | { kind: "link"; label: string; href: string; active?: boolean }
  | { kind: "mega"; label: string; panel: MegaPanel };

export interface MegaNavigationMenuOptions {
  parentId?: InstanceId;
  id?: string;
  items: MegaNavItem[];

  // ── Trigger / link typography (apply via the project's "Lien Nav" token AFTER push via
  //    apply_token_to_instances if desired; defaults below render as inline-flex with currentColor)
  textColor?: string;          // hex, default "#FFFFFF"
  hoverColor?: string;         // hex, default "#82BB25"

  // ── Mega-menu panel
  panelBg?: string;            // hex, default "#262525"
  panelTextColor?: string;     // hex, default "#FFFFFF"
  panelPadding?: StyleValue;   // default px(24)
  panelColumnGap?: StyleValue; // default px(24)
  panelRadius?: StyleValue;    // default px(16)
  colMinWidth?: StyleValue;    // default px(200)
  colRowGap?: StyleValue;      // default px(8)
  imageWidth?: StyleValue;     // default px(320)

  // ── Layout
  listColumnGap?: StyleValue;  // default px(32) — gap between top-level items in the list
  viewportOffset?: StyleValue; // marginTop on the viewport-container, distance from nav. default px(48)
  triggerColumnGap?: StyleValue; // default px(4) — gap between trigger label and chevron

  // ── Animation
  /** Unique slug used to namespace the data-role attr + keyframes. Default: "mega". */
  animSlug?: string;
  /** Type of entrance animation. Default: "fade-down" (subtle from-top + fade). */
  animation?: "fade" | "fade-down" | "none";

  /** Set to false to skip the chevron icon on mega-menu triggers. Default true. */
  triggerChevron?: boolean;
}

export interface MegaNavigationMenuResult {
  navId: InstanceId;
  listId: InstanceId;
  viewportContainerId: InstanceId;
  viewportId: InstanceId;
  animCssEmbedId: InstanceId;
  itemIds: InstanceId[];
  /** Map of mega-item index → { triggerButtonId, contentId, panelId, columnIds, linkIds, imageId? } */
  megaIds: Array<{
    itemIndex: number;
    triggerButtonId: InstanceId;
    iconContainerId?: InstanceId;
    contentId: InstanceId;
    panelId: InstanceId;
    columnIds: InstanceId[];
    linkIds: InstanceId[];
    imageId?: InstanceId;
  }>;
  /** Map of flat-item index → { linkId } */
  flatIds: Array<{ itemIndex: number; linkId: InstanceId }>;
}

export function addMegaNavigationMenu(b: FragmentBuilder, options: MegaNavigationMenuOptions): MegaNavigationMenuResult {
  const p = options.id ?? newId();
  const slug = options.animSlug ?? "mega";

  const textColor = color(options.textColor ?? "#FFFFFF");
  const hoverColor = color(options.hoverColor ?? "#82BB25");
  const panelBg = color(options.panelBg ?? "#262525");
  const panelTextColor = color(options.panelTextColor ?? "#FFFFFF");
  const linkBorder = color({ r: 1, g: 1, b: 1, a: 0.08 });

  const panelPadding = options.panelPadding ?? px(24);
  const panelColumnGap = options.panelColumnGap ?? px(24);
  const panelRadius = options.panelRadius ?? px(16);
  const colMinWidth = options.colMinWidth ?? px(200);
  const colRowGap = options.colRowGap ?? px(8);
  const imageWidth = options.imageWidth ?? px(320);
  const listColumnGap = options.listColumnGap ?? px(32);
  const viewportOffset = options.viewportOffset ?? px(48);
  const triggerColumnGap = options.triggerColumnGap ?? px(4);
  const showChevron = options.triggerChevron !== false;

  // 1. NavigationMenu root
  const navId = b.addInstance("NavigationMenu", { id: `${p}-nav`, parentId: options.parentId, label: "Navigation" });
  b.addStyles(navId, {
    position: keyword("relative"),
    maxWidth: keyword("max-content"),
  });

  // 2. NavigationMenuList
  const listId = b.addInstance("NavigationMenuList", { id: `${p}-list`, parentId: navId });
  b.addStyles(listId, {
    display: keyword("flex"),
    alignItems: keyword("center"),
    columnGap: listColumnGap,
    listStyleType: keyword("none"),
    margin: num(0),
    padding: num(0),
  });

  // 3. Viewport container + Viewport
  const vpWrapId = b.addInstance("Box", { id: `${p}-vp-wrap`, parentId: navId, label: "Viewport Container" });
  b.addStyles(vpWrapId, {
    position: keyword("absolute"),
    top: { type: "unit", value: 100, unit: "%" },
    left: num(0),
    right: num(0),
    display: keyword("flex"),
    justifyContent: keyword("center"),
    marginTop: viewportOffset,
    zIndex: num(50),
  });
  const vpId = b.addInstance("NavigationMenuViewport", { id: `${p}-vp`, parentId: vpWrapId });
  b.addStyles(vpId, {
    position: keyword("relative"),
    width: { type: "var", value: "radix-navigation-menu-viewport-width" } as StyleValue,
    height: { type: "var", value: "radix-navigation-menu-viewport-height" } as StyleValue,
    // NO transition on width/height — Radix updates these continuously during open animation.
  });

  // 4. Items
  const itemIds: InstanceId[] = [];
  const megaIds: MegaNavigationMenuResult["megaIds"] = [];
  const flatIds: MegaNavigationMenuResult["flatIds"] = [];

  options.items.forEach((it, i) => {
    const itemId = b.addInstance("NavigationMenuItem", {
      id: `${p}-item-${i}`,
      parentId: listId,
      label: `Item ${it.label}`,
    });
    itemIds.push(itemId);

    if (it.kind === "link") {
      // Flat: NavigationMenuLink > Link > text
      const wrapId = b.addInstance("NavigationMenuLink", { id: `${p}-nl-${i}`, parentId: itemId });
      if (it.active) b.addProp(wrapId, "active", "boolean", true);
      const linkId = b.addInstance("Link", { id: `${p}-l-${i}`, parentId: wrapId });
      b.addProp(linkId, "href", "string", it.href);
      b.addText(linkId, it.label);
      b.addStyles(linkId, {
        color: textColor,
        textDecorationLine: keyword("none"),
        ...transitionLonghands("color", "200ms", "ease"),
      });
      b.addStyle(linkId, "color", hoverColor, "base", ":hover");
      flatIds.push({ itemIndex: i, linkId });
      return;
    }

    // Mega: Trigger > Button > [Text + (optional) IconContainer > HtmlEmbed] + Content > Panel > ...
    const triggerId = b.addInstance("NavigationMenuTrigger", { id: `${p}-trig-${i}`, parentId: itemId });
    const btnId = b.addInstance("Button", { id: `${p}-tbtn-${i}`, parentId: triggerId, label: `Trig Btn ${it.label}` });
    b.addStyles(btnId, {
      display: keyword("inline-flex"),
      alignItems: keyword("center"),
      columnGap: triggerColumnGap,
      backgroundColor: keyword("transparent"),
      borderTopWidth: num(0), borderRightWidth: num(0), borderBottomWidth: num(0), borderLeftWidth: num(0),
      paddingTop: num(0), paddingRight: num(0), paddingBottom: num(0), paddingLeft: num(0),
      cursor: keyword("pointer"),
      color: textColor,
      textDecorationLine: keyword("none"),
      ...transitionLonghands("color", "200ms", "ease"),
      // Chevron rotation CSS var (set per-state via :hover below)
      ...(showChevron && {
        "--navigation-menu-trigger-icon-transform": { type: "unit", value: 0, unit: "deg" } as StyleValue,
      }),
    });
    b.addStyle(btnId, "color", hoverColor, "base", ":hover");
    if (showChevron) {
      b.addStyle(btnId, "--navigation-menu-trigger-icon-transform" as never, { type: "unit", value: 180, unit: "deg" } as StyleValue, "base", ":hover");
    }
    const txtId = b.addInstance("Text", { id: `${p}-ttxt-${i}`, parentId: btnId });
    b.addText(txtId, it.label);

    let iconContainerId: InstanceId | undefined;
    if (showChevron) {
      iconContainerId = b.addInstance("Box", { id: `${p}-ico-${i}`, parentId: btnId, label: `Icon Container ${it.label}` });
      b.addStyles(iconContainerId, {
        display: keyword("inline-flex"),
        alignItems: keyword("center"),
        rotate: { type: "var", value: "navigation-menu-trigger-icon-transform" } as StyleValue,
        ...transitionLonghands("rotate", "200ms", "cubic-bezier(0.4, 0, 0.2, 1)"),
      });
      const chevId = b.addInstance("HtmlEmbed", { id: `${p}-chev-${i}`, parentId: iconContainerId, label: `Chevron ${it.label}` });
      b.addProp(chevId, "code", "string", CHEVRON_SVG);
      b.addProp(chevId, "executeScriptOnCanvas", "boolean", false);
    }

    // Content + Panel
    const contentId = b.addInstance("NavigationMenuContent", { id: `${p}-cont-${i}`, parentId: itemId });
    b.addProp(contentId, "data-role", "string", `${slug}-content`);
    b.addStyles(contentId, {
      position: keyword("absolute"),
      top: num(0),
      left: num(0),
      width: keyword("max-content"),
    });

    const panelId = b.addInstance("Box", { id: `${p}-panel-${i}`, parentId: contentId, label: `Panel ${it.label}` });
    b.addStyles(panelId, {
      display: keyword("flex"),
      columnGap: panelColumnGap,
      paddingTop: panelPadding, paddingRight: panelPadding, paddingBottom: panelPadding, paddingLeft: panelPadding,
      backgroundColor: panelBg,
      color: panelTextColor,
      borderTopLeftRadius: panelRadius,
      borderTopRightRadius: panelRadius,
      borderBottomLeftRadius: panelRadius,
      borderBottomRightRadius: panelRadius,
    });

    const columnIds: InstanceId[] = [];
    const linkIds: InstanceId[] = [];
    it.panel.columns.forEach((col, ci) => {
      const colId = b.addInstance("Box", { id: `${p}-col-${i}-${ci}`, parentId: panelId, label: `Col ${i}-${ci}` });
      b.addStyles(colId, {
        display: keyword("flex"),
        flexDirection: keyword("column"),
        rowGap: colRowGap,
        minWidth: colMinWidth,
      });
      columnIds.push(colId);
      col.items.forEach((sub, si) => {
        const subId = b.addInstance("Link", { id: `${p}-l-${i}-${ci}-${si}`, parentId: colId });
        b.addProp(subId, "href", "string", sub.href);
        b.addText(subId, sub.label);
        b.addStyles(subId, {
          color: panelTextColor,
          textDecorationLine: keyword("none"),
          ...transitionLonghands("color", "200ms", "ease"),
        });
        b.addStyle(subId, "color", hoverColor, "base", ":hover");
        linkIds.push(subId);
      });
    });

    let imageId: InstanceId | undefined;
    if (it.panel.image) {
      imageId = b.addInstance("Image", { id: `${p}-img-${i}`, parentId: panelId, label: `Img ${it.label}` });
      b.addProp(imageId, "src", "asset", it.panel.image.assetId);
      if (it.panel.image.alt) b.addProp(imageId, "alt", "string", it.panel.image.alt);
      b.addStyles(imageId, {
        width: it.panel.image.width ?? imageWidth,
        height: keyword("auto"),
        objectFit: keyword("cover"),
        borderTopLeftRadius: px(8),
        borderTopRightRadius: px(8),
        borderBottomLeftRadius: px(8),
        borderBottomRightRadius: px(8),
      });
    }

    megaIds.push({ itemIndex: i, triggerButtonId: btnId, iconContainerId, contentId, panelId, columnIds, linkIds, imageId });
    void linkBorder; // keep helper imported even when unused in mega-only configs
  });

  // 5. Animation override CSS (override Radix default data-motion slide-from-side)
  const animCssEmbedId = b.addInstance("HtmlEmbed", {
    id: `${p}-anim-css`,
    parentId: navId,
    label: "Mega menu animations CSS",
  });
  b.addProp(animCssEmbedId, "code", "string", megaMenuAnimationCss(slug, options.animation ?? "fade-down"));
  b.addProp(animCssEmbedId, "executeScriptOnCanvas", "boolean", false);

  return {
    navId, listId, viewportContainerId: vpWrapId, viewportId: vpId,
    animCssEmbedId, itemIds, megaIds, flatIds,
  };
}

function megaMenuAnimationCss(slug: string, mode: "fade" | "fade-down" | "none"): string {
  const role = `${slug}-content`;
  if (mode === "none") {
    return `<style>
[data-role="${role}"] { animation: none !important; }
</style>`;
  }
  const enter = mode === "fade-down"
    ? `from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); }`
    : `from { opacity: 0; } to { opacity: 1; }`;
  return `<style>
[data-role="${role}"] { animation: none !important; }
[data-role="${role}"][data-state="open"]   { animation: ws-mcp-${slug}-in 180ms ease-out forwards !important; }
[data-role="${role}"][data-state="closed"] { animation: ws-mcp-${slug}-out 120ms ease-in forwards !important; }
@keyframes ws-mcp-${slug}-in  { ${enter} }
@keyframes ws-mcp-${slug}-out { from { opacity: 1; } to { opacity: 0; } }
</style>`;
}
