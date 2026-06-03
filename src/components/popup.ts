// Popup (modal) — Radix Dialog promo overlay with configurable trigger + frequency.
//
// Architecture (validated production pattern):
//   wrapper Box
//   ├─ Dialog
//   │   ├─ DialogTrigger > <button hidden, id=triggerBtnHtmlId, aria-hidden, tabIndex=-1>
//   │   └─ DialogOverlay > DialogContent
//   │       ├─ DialogTitle (sr-only — a11y)
//   │       ├─ DialogDescription (sr-only — a11y)
//   │       ├─ [Link wrapper?] > Image
//   │       └─ DialogClose > <button>× (Radix-native close, handles Esc + outside click)
//   └─ HtmlEmbed <script> (auto-opens the dialog via .click() on the hidden trigger)
//
// The script reads/writes a storage flag according to `frequency` so each visitor only
// sees the popup once (per session / per user) — unless `frequency: "always"`.
//
// Pattern doc: docs/patterns/popup-modal-radix.md

import {
  FragmentBuilder,
  newId,
  color,
  px,
  num,
  keyword,
  raw,
} from "../builder.js";
import type { InstanceId, StyleValue } from "../types.js";

// ─── Types ────────────────────────────────────────────────────────────────

export type PopupTriggerMode =
  | "auto-delay"
  | "exit-intent"
  | "scroll-depth"
  | "manual";

export type PopupFrequency =
  | "once-per-session"
  | "once-per-user"
  | "always";

export type PopupClosePosition = "top-right" | "top-left" | "top-center";

export interface PopupTrigger {
  mode: PopupTriggerMode;
  /** mode="auto-delay" — ms before auto-open. Default 2000. Also used as desktop fallback for "exit-intent" timeouts. */
  delayMs?: number;
  /** mode="scroll-depth" — % of page scrolled before open. Default 50. */
  scrollPercent?: number;
  /** mode="manual" — HTML id of an external button. Required for "manual" mode. */
  triggerId?: string;
}

export interface PopupImageContent {
  kind: "image";
  /** Webstudio assetId (sha256). */
  assetId: string;
  alt: string;
  width?: number;
  height?: number;
  /** Wrap the image in a <Link> with this href. */
  href?: string;
}

export type PopupContent = PopupImageContent;

export interface PopupOptions {
  /** If provided, the wrapper Box becomes a child of this parent. Otherwise top-level. */
  parentId?: InstanceId;
  /** Prefix for deterministic IDs (default: nanoid). */
  id?: string;
  /** Wrapper Box label — used as replace target for idempotent re-runs. */
  label?: string;
  /** HtmlEmbed script label — used as replace target. */
  scriptLabel?: string;
  content: PopupContent;
  trigger: PopupTrigger;
  frequency: PopupFrequency;
  /** Storage flag key (default "popup_seen"). Use a project-unique key when multiple popups co-exist. */
  storageKey?: string;
  /** frequency="once-per-user" only — refresh window in days. Default 30. */
  expiryDays?: number;
  /** CSS value for the content max-width (default "500px"). */
  maxWidth?: string;
  /** Custom overlay background. Default rgba(0,0,0,0.7). */
  overlayBgRgba?: { r: number; g: number; b: number; a: number };
  /** CSS value for the content border-radius (default "8px"). */
  borderRadius?: string;
  /** Close button position. Default "top-right". */
  closePosition?: PopupClosePosition;
  /** Accessibility title injected as visually-hidden DialogTitle.
   *  Default: "Promotional offer". Pass null to opt out (NOT recommended). */
  a11yTitle?: string | null;
  /** Accessibility description injected as visually-hidden DialogDescription.
   *  Default: "Discover our latest offer". Pass null to opt out (NOT recommended). */
  a11yDescription?: string | null;
}

export interface PopupResult {
  wrapperId: InstanceId;
  dialogId: InstanceId;
  triggerId: InstanceId;
  triggerBtnId: InstanceId;
  overlayId: InstanceId;
  contentId: InstanceId;
  titleId?: InstanceId;
  descId?: InstanceId;
  imageId: InstanceId;
  imageLinkId?: InstanceId;
  closeId: InstanceId;
  closeBtnId: InstanceId;
  scriptId: InstanceId;
  /** HTML id of the hidden trigger button — also the target of document.getElementById in the script. */
  triggerBtnHtmlId: string;
}

// ─── sr-only styles (a11y) ────────────────────────────────────────────────

/** Visually-hidden style block — keeps a node in the a11y tree for screen readers
 *  but removes it from visual / layout flow. Used for DialogTitle + DialogDescription. */
export const SR_ONLY_STYLES: Record<string, StyleValue> = {
  position: keyword("absolute"),
  width: px(1),
  height: px(1),
  paddingTop: num(0),
  paddingRight: num(0),
  paddingBottom: num(0),
  paddingLeft: num(0),
  marginTop: px(-1),
  marginRight: px(-1),
  marginBottom: px(-1),
  marginLeft: px(-1),
  overflowX: keyword("hidden"),
  overflowY: keyword("hidden"),
  clipPath: raw("inset(50%)"),
  whiteSpace: keyword("nowrap"),
  borderTopWidth: num(0),
  borderRightWidth: num(0),
  borderBottomWidth: num(0),
  borderLeftWidth: num(0),
};

// ─── Pure: build the auto-open script ─────────────────────────────────────

export interface BuildPopupScriptOptions {
  trigger: PopupTrigger;
  frequency: PopupFrequency;
  storageKey: string;
  triggerBtnHtmlId: string;
  expiryDays?: number;
}

/** Builds the JS snippet (as an HTML <script> string) that programmatically clicks the
 *  hidden Dialog trigger button according to the configured trigger mode and frequency
 *  rule. Pure function — exported for direct unit-testing.
 *
 *  Throws if `trigger.mode === "manual"` without `trigger.triggerId`.
 */
export function buildPopupScript(opts: BuildPopupScriptOptions): string {
  const { trigger, frequency, storageKey, triggerBtnHtmlId, expiryDays } = opts;
  const storage = frequency === "once-per-user" ? "localStorage" : "sessionStorage";

  // Frequency check + write-after-open
  let skipIfSeen = "";
  let markSeen = "";
  if (frequency === "once-per-user") {
    const days = expiryDays ?? 30;
    const expiryMs = days * 24 * 60 * 60 * 1000;
    skipIfSeen = `var __v=${storage}.getItem('${storageKey}');if(__v){try{var __d=JSON.parse(__v);if(Date.now()-__d.ts<${expiryMs})return;}catch(e){}}`;
    markSeen = `${storage}.setItem('${storageKey}',JSON.stringify({ts:Date.now()}));`;
  } else if (frequency === "once-per-session") {
    skipIfSeen = `if(${storage}.getItem('${storageKey}'))return;`;
    markSeen = `${storage}.setItem('${storageKey}','1');`;
  }
  // frequency === "always" → no skip, no mark

  const openCall = `var t=document.getElementById('${triggerBtnHtmlId}');if(t){t.click();${markSeen}}`;

  let triggerInstall: string;
  switch (trigger.mode) {
    case "auto-delay": {
      const delay = trigger.delayMs ?? 2000;
      triggerInstall = `setTimeout(function(){${openCall}},${delay});`;
      break;
    }
    case "exit-intent": {
      // Desktop only (hover-capable pointer). On touch devices fall back to a delayed open.
      const fallbackDelay = trigger.delayMs ?? 5000;
      triggerInstall =
        `if(window.matchMedia&&window.matchMedia('(hover: hover)').matches){` +
          `var f=function(e){if(e.clientY<=0){document.removeEventListener('mouseleave',f);${openCall}}};` +
          `document.addEventListener('mouseleave',f);` +
        `}else{` +
          `setTimeout(function(){${openCall}},${fallbackDelay});` +
        `}`;
      break;
    }
    case "scroll-depth": {
      const pct = trigger.scrollPercent ?? 50;
      triggerInstall =
        `var fired=false;` +
        `var s=function(){if(fired)return;var h=document.documentElement;var p=(h.scrollTop)/((h.scrollHeight-h.clientHeight)||1)*100;if(p>=${pct}){fired=true;window.removeEventListener('scroll',s);${openCall}}};` +
        `window.addEventListener('scroll',s,{passive:true});`;
      break;
    }
    case "manual": {
      if (!trigger.triggerId) {
        throw new Error(
          `popup trigger.mode="manual" requires trigger.triggerId (HTML id of an external button)`,
        );
      }
      triggerInstall =
        `var b=document.getElementById('${trigger.triggerId}');` +
        `if(b){b.addEventListener('click',function(e){e.preventDefault();${openCall}});}`;
      break;
    }
  }

  return `<script>(function(){${skipIfSeen}${triggerInstall}})();</script>`;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const radius = (cssValue: string): Record<string, StyleValue> => ({
  borderTopLeftRadius: raw(cssValue),
  borderTopRightRadius: raw(cssValue),
  borderBottomLeftRadius: raw(cssValue),
  borderBottomRightRadius: raw(cssValue),
});

const noBorderWidths: Record<string, StyleValue> = {
  borderTopWidth: num(0),
  borderRightWidth: num(0),
  borderBottomWidth: num(0),
  borderLeftWidth: num(0),
};

const noPadding: Record<string, StyleValue> = {
  paddingTop: num(0),
  paddingRight: num(0),
  paddingBottom: num(0),
  paddingLeft: num(0),
};

// ─── addPopup orchestrator ─────────────────────────────────────────────────

export function addPopup(b: FragmentBuilder, options: PopupOptions): PopupResult {
  const p = options.id ?? newId();
  const triggerBtnHtmlId = `${p}-trigger-html`;

  // Defaults — neutral, project-agnostic. Tweak per-project after creation.
  const maxWidth = options.maxWidth ?? "500px";
  const borderRadius = options.borderRadius ?? "8px";
  const overlayBg = color(options.overlayBgRgba ?? { r: 0, g: 0, b: 0, a: 0.7 });
  const closePosition = options.closePosition ?? "top-right";
  const storageKey = options.storageKey ?? "popup_seen";

  // 1. Wrapper Box (one root for the whole popup — replace target).
  const wrapperId = b.addInstance("Box", {
    id: `${p}-box`,
    parentId: options.parentId,
    label: options.label ?? "Popup",
  });

  // 2. Dialog (Radix root)
  const dialogId = b.addInstance("Dialog", {
    id: `${p}-dialog`,
    parentId: wrapperId,
    label: "Popup Dialog",
  });

  // 3. DialogTrigger + hidden <button> (programmatic open via .click() from the script).
  // The button is positioned off-screen and aria-hidden so screen readers/keyboard users
  // are not exposed to a phantom trigger.
  const triggerId = b.addInstance("DialogTrigger", {
    id: `${p}-trigger`,
    parentId: dialogId,
    label: "Popup Trigger (hidden)",
  });
  const triggerBtnId = b.addInstance("ws:element", {
    id: `${p}-trigger-btn`,
    parentId: triggerId,
    label: "Hidden trigger button",
    tag: "button",
  });
  b.addProp(triggerBtnId, "id", "string", triggerBtnHtmlId);
  b.addProp(triggerBtnId, "aria-hidden", "string", "true");
  b.addProp(triggerBtnId, "tabIndex", "number", -1);
  b.addStyles(triggerBtnId, {
    position: keyword("absolute"),
    width: px(1),
    height: px(1),
    overflowX: keyword("hidden"),
    overflowY: keyword("hidden"),
    opacity: num(0),
    pointerEvents: keyword("none"),
    backgroundColor: keyword("transparent"),
    ...noBorderWidths,
    ...noPadding,
  });

  // 4. DialogOverlay — full-viewport scrim that centers the content.
  const overlayId = b.addInstance("DialogOverlay", {
    id: `${p}-overlay`,
    parentId: dialogId,
    label: "Popup Overlay",
  });
  b.addStyles(overlayId, {
    position: keyword("fixed"),
    top: num(0),
    right: num(0),
    bottom: num(0),
    left: num(0),
    zIndex: num(9998),
    backgroundColor: overlayBg,
    display: keyword("flex"),
    alignItems: keyword("center"),
    justifyContent: keyword("center"),
    paddingTop: px(16),
    paddingRight: px(16),
    paddingBottom: px(16),
    paddingLeft: px(16),
    overflowX: keyword("auto"),
    overflowY: keyword("auto"),
  });

  // 5. DialogContent — the visible card.
  const contentId = b.addInstance("DialogContent", {
    id: `${p}-content`,
    parentId: overlayId,
    label: "Popup Content",
  });
  b.addStyles(contentId, {
    position: keyword("relative"),
    width: { type: "unit", value: 100, unit: "%" },
    maxWidth: raw(maxWidth),
    backgroundColor: color("#ffffff"),
    ...radius(borderRadius),
    overflowX: keyword("hidden"),
    overflowY: keyword("hidden"),
    boxShadow: {
      type: "layers",
      value: [
        {
          type: "shadow",
          position: "outset",
          offsetX: num(0),
          offsetY: px(20),
          blur: px(60),
          spread: num(0),
          color: color({ r: 0, g: 0, b: 0, a: 0.3 }),
        },
      ],
    },
    zIndex: num(9999),
  });

  // 6a. A11y — DialogTitle as the FIRST child of the content (Radix requires it).
  const a11yTitleText =
    options.a11yTitle === null
      ? null
      : options.a11yTitle ?? "Promotional offer";
  const a11yDescText =
    options.a11yDescription === null
      ? null
      : options.a11yDescription ?? "Discover our latest offer";

  let titleId: InstanceId | undefined;
  let descId: InstanceId | undefined;
  if (a11yTitleText !== null) {
    titleId = b.addInstance("DialogTitle", {
      id: `${p}-title`,
      parentId: contentId,
      label: "Popup Title (a11y)",
    });
    b.addText(titleId, a11yTitleText);
    b.addStyles(titleId, SR_ONLY_STYLES);
  }
  if (a11yDescText !== null) {
    descId = b.addInstance("DialogDescription", {
      id: `${p}-desc`,
      parentId: contentId,
      label: "Popup Description (a11y)",
    });
    b.addText(descId, a11yDescText);
    b.addStyles(descId, SR_ONLY_STYLES);
  }

  // 6b. Image — optionally wrapped in a Link when content.href is provided.
  let imageLinkId: InstanceId | undefined;
  let imageParent: InstanceId = contentId;
  if (options.content.href) {
    imageLinkId = b.addInstance("Link", {
      id: `${p}-img-link`,
      parentId: contentId,
      label: "Popup Image Link",
    });
    b.addProp(imageLinkId, "href", "string", options.content.href);
    b.addStyles(imageLinkId, {
      display: keyword("block"),
    });
    imageParent = imageLinkId;
  }
  const imageId = b.addInstance("Image", {
    id: `${p}-image`,
    parentId: imageParent,
    label: "Popup Image",
  });
  b.addProp(imageId, "src", "asset", options.content.assetId);
  b.addProp(imageId, "alt", "string", options.content.alt);
  if (options.content.width) {
    b.addProp(imageId, "width", "number", options.content.width);
  }
  if (options.content.height) {
    b.addProp(imageId, "height", "number", options.content.height);
  }
  b.addStyles(imageId, {
    display: keyword("block"),
    width: { type: "unit", value: 100, unit: "%" },
    height: keyword("auto"),
  });

  // 6c. DialogClose — Radix-native close (handles Esc + outside click for free).
  const closeId = b.addInstance("DialogClose", {
    id: `${p}-close`,
    parentId: contentId,
    label: "Popup Close",
  });
  const closeBtnId = b.addInstance("ws:element", {
    id: `${p}-close-btn`,
    parentId: closeId,
    label: "Close button",
    tag: "button",
  });
  b.addText(closeBtnId, "×");
  b.addProp(closeBtnId, "aria-label", "string", "Close");

  const closeBtnStyles: Record<string, StyleValue> = {
    position: keyword("absolute"),
    top: px(12),
    width: px(32),
    height: px(32),
    display: keyword("flex"),
    alignItems: keyword("center"),
    justifyContent: keyword("center"),
    backgroundColor: color({ r: 0, g: 0, b: 0, a: 0.6 }),
    color: color("#ffffff"),
    fontSize: px(20),
    lineHeight: num(1),
    cursor: keyword("pointer"),
    borderTopLeftRadius: { type: "unit", value: 50, unit: "%" },
    borderTopRightRadius: { type: "unit", value: 50, unit: "%" },
    borderBottomLeftRadius: { type: "unit", value: 50, unit: "%" },
    borderBottomRightRadius: { type: "unit", value: 50, unit: "%" },
    ...noBorderWidths,
    ...noPadding,
    zIndex: num(10),
  };
  if (closePosition === "top-right") {
    closeBtnStyles.right = px(12);
  } else if (closePosition === "top-left") {
    closeBtnStyles.left = px(12);
  } else {
    closeBtnStyles.left = { type: "unit", value: 50, unit: "%" };
    closeBtnStyles.transform = raw("translateX(-50%)");
  }
  b.addStyles(closeBtnId, closeBtnStyles);

  // 7. HtmlEmbed sibling carrying the auto-open <script>.
  const scriptCode = buildPopupScript({
    trigger: options.trigger,
    frequency: options.frequency,
    storageKey,
    triggerBtnHtmlId,
    expiryDays: options.expiryDays,
  });
  const scriptId = b.addInstance("HtmlEmbed", {
    id: `${p}-script`,
    parentId: wrapperId,
    label: options.scriptLabel ?? "Popup script",
  });
  b.addProp(scriptId, "code", "string", scriptCode);
  b.addProp(scriptId, "executeScriptOnCanvas", "boolean", false);

  return {
    wrapperId,
    dialogId,
    triggerId,
    triggerBtnId,
    overlayId,
    contentId,
    titleId,
    descId,
    imageId,
    imageLinkId,
    closeId,
    closeBtnId,
    scriptId,
    triggerBtnHtmlId,
  };
}
