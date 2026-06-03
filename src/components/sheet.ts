// Sheet (mobile drawer Dialog).
// Validated full pattern: animated hamburger + slide-in/out keyframes + dark panel.

import { FragmentBuilder, newId, color, px, rem, num, keyword, raw, transitionLonghands } from "../builder.js";
import type { InstanceId, StyleValue } from "../types.js";
import { sheetAnimationCss } from "./animations.js";

export interface SheetLink {
  label: string;
  /** Required if no `children`. Ignored when `children` is provided (the group label is not a link itself). */
  href?: string;
  /** When provided, the entry becomes a `<details><summary>` collapsible group containing these leaf links. */
  children?: { label: string; href: string }[];
}

const DETAILS_CHEVRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

export interface SheetOptions {
  /** If provided, the Dialog + CSS embed become children of this parent. Otherwise top-level. */
  parentId?: InstanceId;
  /** Prefix for deterministic IDs (default: nanoid). */
  id?: string;
  /** Main Dialog label (default: "Mobile menu"). */
  label?: string;
  /** Slide direction. Default: "right". */
  direction?: "left" | "right";
  /** Navigation links. */
  links: SheetLink[];
  /** Colors (hex strings). Defaults: dark panel, light text, accent color (orange by default, override via tokens). */
  panelBg?: string;          // default "#111111"
  textColor?: string;        // default "#E5E5E5"
  hoverColor?: string;       // default "#E07B1A"
  burgerColor?: string;      // default "#111111"
  overlayBgRgba?: { r: number; g: number; b: number; a: number }; // default rgba(0,0,0,0.7)
  /** CSS embed label (default "CSS animation menu"). */
  cssLabel?: string;
  /** Include the sibling CSS embed (default true). Set to false if you supply your own CSS. */
  withCssEmbed?: boolean;
  /** Padding applied to all 4 sides of the panel (default: px(24)). Pass a project design-system var for consistency. */
  panelPadding?: StyleValue;
  /** Vertical gap between top-level nav items inside the panel (default: px(8)). */
  panelRowGap?: StyleValue;
  /** Font-size of flat leaf links AND of collapsible-group summary labels (default: rem(1.125)). */
  linkFontSize?: StyleValue;
  /** Font-size of sub-links inside collapsible groups (default: rem(1)). Should be ≤ linkFontSize for visual hierarchy. */
  subLinkFontSize?: StyleValue;
  /** Optional logo Image at the top of the drawer (above the nav). Pass the Webstudio assetId
   *  (sha256). Width defaults to px(120); pass any StyleValue to override. */
  topLogo?: { assetId: string; alt?: string; width?: StyleValue; marginBottom?: StyleValue };
  /** Optional row of social icons at the bottom of the drawer. Built-in SVGs for facebook /
   *  instagram / linkedin / twitter / youtube / tiktok. Each link can have either `href` (static)
   *  or `hrefExpression` (Webstudio expression like `$ws$dataSource$<varId>`). */
  socials?: SheetSocial[];
  /** Offset from viewport top — overlay starts below this point (e.g. header height) so the
   *  header stays visible and interactive when the drawer is open. Default: 0. */
  topOffset?: StyleValue;
  /** Gap (overlay padding) between the overlay's inner edges and the panel — creates a
   *  "floating" drawer detached from screen borders. Pass per-side or a single value. */
  panelInset?: { top?: StyleValue; right?: StyleValue; bottom?: StyleValue; left?: StyleValue };
  /** Border-radius applied to all 4 corners of the panel (default: none). */
  panelRadius?: StyleValue;
  /** Drop the panel's default box-shadow (which assumes a side-slide full-height drawer). Default false. */
  noPanelShadow?: boolean;
  /** Auto-hide the burger button at base + show it at the given breakpoint label
   *  ("tablet" | "mobile-landscape" | "mobile-portrait"). Eliminates 2 update_styles post-create. */
  responsiveBurger?: { visibleAt: "tablet" | "mobile-landscape" | "mobile-portrait" };
  /** Accessibility title injected as a visually-hidden DialogTitle in the panel — required by
   *  Radix Dialog to silence runtime warnings and provide a name for screen readers.
   *  Default: "Navigation menu". Pass null to opt out (NOT recommended). */
  a11yTitle?: string | null;
  /** Accessibility description injected as a visually-hidden DialogDescription in the panel —
   *  required by Radix Dialog to silence the "Missing Description" warning and aid screen readers.
   *  Default: "Links to the main sections of the site.". Pass null to opt out (NOT recommended). */
  a11yDescription?: string | null;
}

export type SheetSocialPlatform = "facebook" | "instagram" | "linkedin" | "twitter" | "youtube" | "tiktok";
export interface SheetSocial {
  platform: SheetSocialPlatform;
  href?: string;
  /** Webstudio expression for dynamic binding, e.g. "$ws$dataSource$<varId>". Mutually exclusive with `href`. */
  hrefExpression?: string;
  ariaLabel?: string;
}

const SOCIAL_SVG: Record<SheetSocialPlatform, string> = {
  facebook: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M22 12.0611C22 6.50479 17.5226 2 12.0006 2C6.47742 2 2 6.50479 2 12.0611C2 17.0829 5.65723 21.2447 10.4376 22V14.969H7.89904V12.0611H10.4376V9.84429C10.4376 7.32317 11.931 5.92982 14.2147 5.92982C15.309 5.92982 16.4537 6.1266 16.4537 6.1266V8.60278H15.192C13.9501 8.60278 13.5629 9.37794 13.5629 10.1736V12.0611H16.3361L15.8929 14.969H13.5629V22C18.3433 21.2447 22 17.0829 22 12.0611Z"/></svg>`,
  instagram: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M15.5927 3.5C18.5739 3.5 20.9995 5.92513 20.9995 8.90682V16.0932C20.9995 19.0744 18.5739 21.5 15.5927 21.5H8.40631C5.42462 21.5 3 19.0744 3 16.0932V8.90682C3 5.92513 5.42462 3.5 8.40631 3.5H15.5927ZM15.5927 5.19357H8.40631C6.35866 5.19357 4.69306 6.85917 4.69306 8.90682V16.0932C4.69306 18.1408 6.35866 19.8064 8.40631 19.8064H15.5927C17.6403 19.8064 19.3064 18.1408 19.3064 16.0932V8.90682C19.3064 6.85917 17.6403 5.19357 15.5927 5.19357ZM12.0738 8.0669C14.5177 8.0669 16.5064 10.0555 16.5064 12.5C16.5064 14.944 14.5177 16.9326 12.0738 16.9326C9.6293 16.9326 7.64067 14.944 7.64067 12.5C7.64067 10.0555 9.6293 8.0669 12.0738 8.0669ZM12.0738 9.66025C10.5079 9.66025 9.23402 10.9341 9.23402 12.5C9.23402 14.0654 10.5079 15.3392 12.0738 15.3392C13.6391 15.3392 14.913 14.0654 14.913 12.5C14.913 10.9341 13.6391 9.66025 12.0738 9.66025ZM16.7653 6.71367C17.3478 6.71367 17.8204 7.18628 17.8204 7.76878C17.8204 8.35179 17.3478 8.8244 16.7653 8.8244C16.1823 8.8244 15.7097 8.35179 15.7097 7.76878C15.7097 7.18628 16.1823 6.71367 16.7653 6.71367Z"/></svg>`,
  linkedin: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.86-3.04-1.86 0-2.14 1.45-2.14 2.95v5.66H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.86 3.37-1.86 3.6 0 4.27 2.37 4.27 5.45zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57z"/></svg>`,
  twitter: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  youtube: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.56A3.02 3.02 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12c0 1.94.17 3.86.5 5.8a3.02 3.02 0 0 0 2.12 2.14C4.5 20.5 12 20.5 12 20.5s7.5 0 9.38-.56a3.02 3.02 0 0 0 2.12-2.14c.33-1.94.5-3.86.5-5.8 0-1.94-.17-3.86-.5-5.8zM9.75 15.57V8.43L15.82 12z"/></svg>`,
  tiktok: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.1z"/></svg>`,
};

export interface SheetResult {
  dialogId: InstanceId;
  triggerId: InstanceId;
  buttonId: InstanceId;
  barIds: [InstanceId, InstanceId, InstanceId];
  overlayId: InstanceId;
  panelId: InstanceId;
  navId: InstanceId;
  linkIds: InstanceId[];
  cssEmbedId?: InstanceId;
  logoId?: InstanceId;
  socialsBoxId?: InstanceId;
  socialLinkIds?: InstanceId[];
  /** DialogTitle injected as the first child of the panel (sr-only). Present unless a11yTitle=null. */
  a11yTitleId?: InstanceId;
  /** DialogDescription injected as the second child of the panel (sr-only). Present unless a11yDescription=null. */
  a11yDescId?: InstanceId;
}

/** Visually-hidden style block (a11y "sr-only" pattern) — keeps the node in the a11y tree
 *  for screen readers but removes it from visual / layout flow. */
const SR_ONLY_STYLES: Record<string, StyleValue> = {
  position: keyword("absolute"),
  width: px(1),
  height: px(1),
  paddingTop: num(0), paddingRight: num(0), paddingBottom: num(0), paddingLeft: num(0),
  marginTop: px(-1), marginRight: px(-1), marginBottom: px(-1), marginLeft: px(-1),
  overflowX: keyword("hidden"), overflowY: keyword("hidden"),
  clipPath: raw("inset(50%)"),
  whiteSpace: keyword("nowrap"),
  borderTopWidth: num(0), borderRightWidth: num(0), borderBottomWidth: num(0), borderLeftWidth: num(0),
};

export function addSheet(b: FragmentBuilder, options: SheetOptions): SheetResult {
  const p = options.id ?? newId();
  const dir = options.direction ?? "right";
  const fromOff = dir === "right" ? "100%" : "-100%";
  const panelMargin = dir === "right" ? "marginLeft" : "marginRight";

  const panelBg = color(options.panelBg ?? "#111111");
  const textColor = color(options.textColor ?? "#E5E5E5");
  const hoverColor = color(options.hoverColor ?? "#E07B1A");
  const burgerColor = color(options.burgerColor ?? "#111111");
  const overlayBg = color(options.overlayBgRgba ?? { r: 0, g: 0, b: 0, a: 0.7 });
  const linkBorder = color({ r: 1, g: 1, b: 1, a: 0.08 });
  const shadow = color({ r: 0, g: 0, b: 0, a: 0.5 });

  // Tokenizable spacing/sizing — defaults preserved for backward compat; pass design-system
  // vars (e.g. {type:"var", value:"brand-space-l"}) for consistency with the project tokens.
  const panelPadding = options.panelPadding ?? px(24);
  const panelRowGap = options.panelRowGap ?? px(8);
  const linkFontSize = options.linkFontSize ?? rem(1.125);
  const subLinkFontSize = options.subLinkFontSize ?? rem(1);

  const noBorders = {
    borderTopWidth: num(0), borderRightWidth: num(0), borderBottomWidth: num(0), borderLeftWidth: num(0),
    borderTopStyle: keyword("none"), borderRightStyle: keyword("none"),
    borderBottomStyle: keyword("none"), borderLeftStyle: keyword("none"),
  };
  const radius = (v: number) => ({
    borderTopLeftRadius: px(v), borderTopRightRadius: px(v),
    borderBottomRightRadius: px(v), borderBottomLeftRadius: px(v),
  });

  // 1. Dialog
  const dialogId = b.addInstance("Dialog", {
    id: `${p}-sheet`,
    parentId: options.parentId,
    label: options.label ?? "Mobile menu",
  });
  b.addProp(dialogId, "data-ws-show", "boolean", true);

  // 2. Trigger
  const triggerId = b.addInstance("DialogTrigger", { id: `${p}-trigger`, parentId: dialogId, label: "Sheet Trigger" });
  b.addProp(triggerId, "data-ws-show", "boolean", true);
  b.addProp(triggerId, "aria-label", "string", "Open menu");

  // 3. Burger button (CSS vars in Webstudio styles → closed state by default)
  const buttonId = b.addInstance("Button", { id: `${p}-burger`, parentId: triggerId });
  b.addProp(buttonId, "class", "string", "burger-btn");
  b.addProp(buttonId, "data-ws-show", "boolean", true);
  b.addStyles(buttonId, {
    "--angle": { type: "unit", value: 0, unit: "deg" },
    "--move": px(0),
    "--middle-op": num(1),
    "--angle-rev": { type: "unit", value: 0, unit: "deg" },
    "--move-rev": px(0),
    display: keyword("flex"),
    flexDirection: keyword("column"),
    alignItems: keyword("center"),
    justifyContent: keyword("center"),
    rowGap: px(4),
    width: rem(2.5),
    height: rem(2.5),
    backgroundColor: keyword("transparent"),
    ...noBorders,
    paddingTop: num(0), paddingRight: num(0), paddingBottom: num(0), paddingLeft: num(0),
    cursor: keyword("pointer"),
    outlineStyle: keyword("none"),
    color: burgerColor, // bars inherit via currentColor
    ...radius(8),
    position: keyword("relative"),
    zIndex: num(1002),
  });

  // 4. 3 bars
  const barCommon = {
    width: px(20),
    height: px(2),
    backgroundColor: keyword("currentColor"),
    borderTopLeftRadius: px(1), borderTopRightRadius: px(1),
    borderBottomLeftRadius: px(1), borderBottomRightRadius: px(1),
  };
  const barTop = b.addInstance("ws:element", { id: `${p}-bar-top`, parentId: buttonId, label: "Top bar", tag: "div" });
  b.addStyles(barTop, {
    ...barCommon,
    transform: raw("translateY(var(--move, 0)) rotate(var(--angle, 0deg))"),
    ...transitionLonghands("transform", "300ms", "cubic-bezier(0.4, 0, 0.2, 1)"),
  });
  const barMid = b.addInstance("ws:element", { id: `${p}-bar-mid`, parentId: buttonId, label: "Middle bar", tag: "div" });
  b.addStyles(barMid, {
    ...barCommon,
    opacity: raw("var(--middle-op, 1)"),
    ...transitionLonghands("opacity", "200ms", "ease"),
  });
  const barBot = b.addInstance("ws:element", { id: `${p}-bar-bot`, parentId: buttonId, label: "Bottom bar", tag: "div" });
  b.addStyles(barBot, {
    ...barCommon,
    transform: raw("translateY(var(--move-rev, 0)) rotate(var(--angle-rev, 0deg))"),
    ...transitionLonghands("transform", "300ms", "cubic-bezier(0.4, 0, 0.2, 1)"),
  });

  // ── responsiveBurger: hide burger at base, show at the given breakpoint
  if (options.responsiveBurger) {
    b.addStyle(buttonId, "display", keyword("none"));
    b.addStyle(buttonId, "display", keyword("flex"), options.responsiveBurger.visibleAt);
  }

  // 5. Overlay
  const overlayId = b.addInstance("DialogOverlay", { id: `${p}-overlay`, parentId: dialogId, label: "Sheet Overlay" });
  b.addProp(overlayId, "data-role", "string", "menu-overlay");
  const inset = options.panelInset ?? {};
  b.addStyles(overlayId, {
    position: keyword("fixed"),
    top: options.topOffset ?? num(0),
    right: num(0),
    bottom: num(0),
    left: num(0),
    zIndex: num(998),
    backgroundColor: overlayBg,
    display: keyword("flex"),
    flexDirection: keyword("column"),
    overflowX: keyword("auto"),
    overflowY: keyword("auto"),
    // Inset padding so the panel sits with a visual gap from the overlay's inner edges (floating drawer).
    ...(options.panelInset && {
      paddingTop: inset.top ?? num(0),
      paddingRight: inset.right ?? num(0),
      paddingBottom: inset.bottom ?? num(0),
      paddingLeft: inset.left ?? num(0),
    }),
  } as Record<string, StyleValue>);

  // 6. Panel (DialogContent)
  const panelId = b.addInstance("DialogContent", { id: `${p}-panel`, parentId: overlayId, label: "Sheet Content" });
  b.addProp(panelId, "data-role", "string", "menu-content");
  const panelStyles: Record<string, StyleValue> = {
    position: keyword("relative"),
    [panelMargin]: keyword("auto"),
    width: { type: "unit", value: 100, unit: "%" },
    maxWidth: px(360),
    flexGrow: num(1),
    height: { type: "unit", value: 100, unit: "%" },
    backgroundColor: panelBg,
    display: keyword("flex"),
    flexDirection: keyword("column"),
    paddingTop: panelPadding, paddingRight: panelPadding, paddingBottom: panelPadding, paddingLeft: panelPadding,
    rowGap: panelRowGap,
    zIndex: num(999),
  };
  if (!options.noPanelShadow) {
    panelStyles.boxShadow = { type: "layers", value: [{ type: "shadow", position: "outset",
      offsetX: dir === "right" ? px(-8) : px(8),
      offsetY: num(0), blur: px(32), spread: num(0), color: shadow }] };
  }
  if (options.panelRadius) {
    panelStyles.borderTopLeftRadius = options.panelRadius;
    panelStyles.borderTopRightRadius = options.panelRadius;
    panelStyles.borderBottomLeftRadius = options.panelRadius;
    panelStyles.borderBottomRightRadius = options.panelRadius;
  }
  b.addStyles(panelId, panelStyles);

  // 6a. A11y — DialogTitle + DialogDescription as the FIRST children of the panel.
  // Radix Dialog requires both to silence its runtime warnings AND for screen-reader users to
  // hear what the dialog is. Both are rendered visually-hidden via sr-only styles.
  // Pass a11yTitle=null / a11yDescription=null in options to opt out (NOT recommended).
  const a11yTitleText = options.a11yTitle === null ? null : (options.a11yTitle ?? "Navigation menu");
  const a11yDescText  = options.a11yDescription === null ? null : (options.a11yDescription ?? "Links to the main sections of the site.");
  let a11yTitleId: InstanceId | undefined;
  let a11yDescId: InstanceId | undefined;
  if (a11yTitleText !== null) {
    a11yTitleId = b.addInstance("DialogTitle", { id: `${p}-a11y-title`, parentId: panelId, label: "Sheet Title (a11y)" });
    b.addText(a11yTitleId, a11yTitleText);
    b.addStyles(a11yTitleId, SR_ONLY_STYLES);
  }
  if (a11yDescText !== null) {
    a11yDescId = b.addInstance("DialogDescription", { id: `${p}-a11y-desc`, parentId: panelId, label: "Sheet Description (a11y)" });
    b.addText(a11yDescId, a11yDescText);
    b.addStyles(a11yDescId, SR_ONLY_STYLES);
  }

  // 6b. Optional top logo (rendered above the nav, centered, with bottom margin for breathing room)
  let logoId: InstanceId | undefined;
  if (options.topLogo) {
    logoId = b.addInstance("Image", { id: `${p}-logo`, parentId: panelId, label: "Sheet Logo" });
    b.addProp(logoId, "src", "asset", options.topLogo.assetId);
    if (options.topLogo.alt) b.addProp(logoId, "alt", "string", options.topLogo.alt);
    b.addStyles(logoId, {
      width: options.topLogo.width ?? px(120),
      height: keyword("auto"),
      alignSelf: keyword("center"),
      marginBottom: options.topLogo.marginBottom ?? px(16),
      objectFit: keyword("contain"),
    });
  }

  // 7. Nav
  const navId = b.addInstance("ws:element", { id: `${p}-nav`, parentId: panelId, label: "Nav", tag: "nav" });
  b.addStyles(navId, {
    display: keyword("flex"),
    flexDirection: keyword("column"),
    flexGrow: num(1),
  });

  // Webstudio UI quirk: the Border panel exposes a single unified "color" field that's only
  // editable when ALL 4 sides share the same color. Setting borderBottomColor alone breaks the
  // UI even though it renders correctly. So we write the same color to all 4 sides and use
  // borderBottomWidth/Style alone to make only the bottom visible.
  const singleSideBorderColor = {
    borderTopColor: linkBorder,
    borderRightColor: linkBorder,
    borderBottomColor: linkBorder,
    borderLeftColor: linkBorder,
  } as const;

  const leafLinkStyles: Record<string, StyleValue> = {
    display: keyword("block"),
    color: textColor,
    fontSize: linkFontSize,
    fontWeight: num(500),
    paddingTop: px(16),
    paddingBottom: px(16),
    textDecorationLine: keyword("none"),
    borderBottomWidth: px(1),
    borderBottomStyle: keyword("solid"),
    ...singleSideBorderColor,
    ...transitionLonghands("color", "0.2s", "ease"),
  };
  const subLinkStyles: Record<string, StyleValue> = {
    display: keyword("block"),
    color: textColor,
    fontSize: subLinkFontSize,
    fontWeight: num(400),
    paddingTop: px(10),
    paddingBottom: px(10),
    paddingLeft: px(8),
    textDecorationLine: keyword("none"),
    ...transitionLonghands("color", "0.2s", "ease"),
  };

  const linkIds: InstanceId[] = [];
  options.links.forEach((l, i) => {
    // Group → <details><summary>label + chevron</summary><a>...</a>×N</details>
    if (l.children && l.children.length > 0) {
      const detailsId = b.addInstance("ws:element", {
        id: `${p}-grp-${i + 1}`,
        parentId: navId,
        label: l.label,
        tag: "details",
      });
      b.addStyles(detailsId, {
        borderBottomWidth: px(1),
        borderBottomStyle: keyword("solid"),
        ...singleSideBorderColor,
      });
      const summaryId = b.addInstance("ws:element", {
        id: `${p}-grp-sum-${i + 1}`,
        parentId: detailsId,
        label: `${l.label} (summary)`,
        tag: "summary",
      });
      b.addStyles(summaryId, {
        display: keyword("flex"),
        alignItems: keyword("center"),
        justifyContent: keyword("space-between"),
        color: textColor,
        fontSize: linkFontSize,
        fontWeight: num(500),
        paddingTop: px(16),
        paddingBottom: px(16),
        ...transitionLonghands("color", "0.2s", "ease"),
      });
      b.addStyle(summaryId, "color", hoverColor, "base", ":hover");
      b.addText(summaryId, l.label);
      // chevron
      const chevId = b.addInstance("HtmlEmbed", {
        id: `${p}-grp-chev-${i + 1}`,
        parentId: summaryId,
        label: `${l.label} chevron`,
      });
      b.addProp(chevId, "code", "string", `<span class="ws-mcp-details-chevron">${DETAILS_CHEVRON_SVG}</span>`);
      b.addProp(chevId, "executeScriptOnCanvas", "boolean", false);
      // sub-links
      l.children.forEach((c, j) => {
        const cid = b.addInstance("ws:element", {
          id: `${p}-grp-${i + 1}-sub-${j + 1}`,
          parentId: detailsId,
          label: c.label,
          tag: "a",
        });
        b.addText(cid, c.label);
        b.addProp(cid, "href", "string", c.href);
        b.addStyles(cid, subLinkStyles);
        b.addStyle(cid, "color", hoverColor, "base", ":hover");
        linkIds.push(cid);
      });
      return;
    }
    // Leaf link
    if (!l.href) {
      throw new Error(`SheetLink "${l.label}" has no href and no children — at least one is required.`);
    }
    const lid = b.addInstance("ws:element", { id: `${p}-link-${i + 1}`, parentId: navId, label: l.label, tag: "a" });
    b.addText(lid, l.label);
    b.addProp(lid, "href", "string", l.href);
    b.addStyles(lid, leafLinkStyles);
    b.addStyle(lid, "color", hoverColor, "base", ":hover");
    linkIds.push(lid);
  });

  // 7b. Optional socials row at the bottom (after nav, pushed down by nav's flexGrow:1).
  let socialsBoxId: InstanceId | undefined;
  const socialLinkIds: InstanceId[] = [];
  if (options.socials && options.socials.length > 0) {
    socialsBoxId = b.addInstance("Box", { id: `${p}-socials`, parentId: panelId, label: "Sheet Socials" });
    b.addStyles(socialsBoxId, {
      display: keyword("flex"),
      justifyContent: keyword("center"),
      columnGap: px(24),
      paddingTop: px(24),
      marginTop: px(16),
      borderTopWidth: px(1),
      borderTopStyle: keyword("solid"),
      // 4-sides color (UI quirk: panel Border editable only if all 4 share the value)
      borderTopColor: linkBorder,
      borderRightColor: linkBorder,
      borderBottomColor: linkBorder,
      borderLeftColor: linkBorder,
    });
    options.socials.forEach((s, i) => {
      const sId = b.addInstance("Link", { id: `${p}-soc-${s.platform}`, parentId: socialsBoxId!, label: `${s.platform} link` });
      // href: static or expression binding
      if (s.hrefExpression) {
        b.addProp(sId, "href", "expression", s.hrefExpression);
      } else if (s.href) {
        b.addProp(sId, "href", "string", s.href);
      }
      b.addProp(sId, "target", "string", "_blank");
      b.addProp(sId, "rel", "string", "noopener noreferrer");
      b.addProp(sId, "aria-label", "string", s.ariaLabel ?? s.platform);
      b.addStyles(sId, {
        display: keyword("inline-flex"),
        alignItems: keyword("center"),
        color: textColor,
        paddingTop: px(4),
        paddingRight: px(4),
        paddingBottom: px(4),
        paddingLeft: px(4),
        textDecorationLine: keyword("none"),
        ...transitionLonghands("color", "200ms", "cubic-bezier(0.4, 0, 0.2, 1)"),
      });
      b.addStyle(sId, "color", hoverColor, "base", ":hover");
      const svgId = b.addInstance("HtmlEmbed", { id: `${p}-soc-${s.platform}-svg`, parentId: sId, label: `${s.platform} icon` });
      b.addProp(svgId, "code", "string", SOCIAL_SVG[s.platform]);
      b.addProp(svgId, "executeScriptOnCanvas", "boolean", false);
      socialLinkIds.push(sId);
    });
  }

  // 8. Sibling CSS embed (optional)
  let cssEmbedId: InstanceId | undefined;
  if (options.withCssEmbed !== false) {
    cssEmbedId = b.addInstance("HtmlEmbed", {
      id: `${p}-css`,
      parentId: options.parentId,
      label: options.cssLabel ?? "CSS animation menu",
    });
    b.addProp(cssEmbedId, "code", "string", sheetAnimationCss(fromOff));
    b.addProp(cssEmbedId, "executeScriptOnCanvas", "boolean", false);
  }

  return {
    dialogId,
    triggerId,
    buttonId,
    barIds: [barTop, barMid, barBot],
    overlayId,
    panelId,
    navId,
    linkIds,
    cssEmbedId,
    logoId,
    socialsBoxId,
    socialLinkIds: socialLinkIds.length ? socialLinkIds : undefined,
    a11yTitleId,
    a11yDescId,
  };
}
