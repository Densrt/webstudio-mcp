// Coverage for the popup helper: pure buildPopupScript (12+ variations of trigger
// mode × frequency) + addPopup orchestrator (structure, a11y, replace target,
// optional link wrapping, hidden trigger props).

import { test } from "node:test";
import assert from "node:assert/strict";
import { FragmentBuilder } from "../dist/builder.js";
import { addPopup, buildPopupScript } from "../dist/components/popup.js";

const RADIX_NS_PREFIX = "@webstudio-is/sdk-components-react-radix:";
const HTML_NS_PREFIX = "@webstudio-is/sdk-components-react:";

function buildPopup(opts = {}) {
  const b = new FragmentBuilder();
  const result = addPopup(b, {
    content: { kind: "image", assetId: "asset-sha256", alt: "Promo" },
    trigger: { mode: "auto-delay" },
    frequency: "once-per-session",
    ...opts,
  });
  const fragment = b.build();
  const payload = fragment["@webstudio/instance/v0.1"];
  return { result, payload };
}

// ────────────────────────────────────────────────────────────────────────────
// buildPopupScript — pure function
// ────────────────────────────────────────────────────────────────────────────

test("buildPopupScript: auto-delay + once-per-session uses sessionStorage and default 2000ms", () => {
  const s = buildPopupScript({
    trigger: { mode: "auto-delay" },
    frequency: "once-per-session",
    storageKey: "popup_seen",
    triggerBtnHtmlId: "p-trig",
  });
  assert.match(s, /<script>\(function\(\)\{/);
  assert.match(s, /if\(sessionStorage\.getItem\('popup_seen'\)\)return;/);
  assert.match(s, /setTimeout\(function\(\)\{[\s\S]*?\},2000\)/);
  assert.match(s, /document\.getElementById\('p-trig'\)/);
  assert.match(s, /t\.click\(\)/);
  assert.match(s, /sessionStorage\.setItem\('popup_seen','1'\)/);
});

test("buildPopupScript: auto-delay honors custom delayMs", () => {
  const s = buildPopupScript({
    trigger: { mode: "auto-delay", delayMs: 5000 },
    frequency: "once-per-session",
    storageKey: "k",
    triggerBtnHtmlId: "t",
  });
  assert.match(s, /\},5000\)/);
});

test("buildPopupScript: exit-intent gates on hover:hover with mouseleave + clientY<=0 + fallback delay", () => {
  const s = buildPopupScript({
    trigger: { mode: "exit-intent" },
    frequency: "once-per-session",
    storageKey: "k",
    triggerBtnHtmlId: "t",
  });
  assert.match(s, /matchMedia\('\(hover: hover\)'\)\.matches/);
  assert.match(s, /mouseleave/);
  assert.match(s, /clientY<=0/);
  // fallback delay default 5000
  assert.match(s, /setTimeout\(function\(\)\{[\s\S]*?\},5000\)/);
});

test("buildPopupScript: scroll-depth honors custom scrollPercent and uses passive listener", () => {
  const s = buildPopupScript({
    trigger: { mode: "scroll-depth", scrollPercent: 75 },
    frequency: "once-per-session",
    storageKey: "k",
    triggerBtnHtmlId: "t",
  });
  assert.match(s, /scroll/);
  assert.match(s, />=75/);
  assert.match(s, /\{passive:true\}/);
});

test("buildPopupScript: scroll-depth default percent is 50", () => {
  const s = buildPopupScript({
    trigger: { mode: "scroll-depth" },
    frequency: "once-per-session",
    storageKey: "k",
    triggerBtnHtmlId: "t",
  });
  assert.match(s, />=50/);
});

test("buildPopupScript: manual binds click on external trigger via getElementById", () => {
  const s = buildPopupScript({
    trigger: { mode: "manual", triggerId: "my-external-btn" },
    frequency: "once-per-session",
    storageKey: "k",
    triggerBtnHtmlId: "t",
  });
  assert.match(s, /document\.getElementById\('my-external-btn'\)/);
  assert.match(s, /addEventListener\('click'/);
  assert.match(s, /e\.preventDefault\(\)/);
});

test('buildPopupScript: manual without triggerId throws', () => {
  assert.throws(
    () =>
      buildPopupScript({
        trigger: { mode: "manual" },
        frequency: "once-per-session",
        storageKey: "k",
        triggerBtnHtmlId: "t",
      }),
    /requires trigger\.triggerId/,
  );
});

test('buildPopupScript: frequency="always" has no skip-if-seen and no setItem', () => {
  const s = buildPopupScript({
    trigger: { mode: "auto-delay" },
    frequency: "always",
    storageKey: "k",
    triggerBtnHtmlId: "t",
  });
  assert.equal(/getItem/.test(s), false, "no skip-if-seen");
  assert.equal(/setItem/.test(s), false, "no mark-as-seen");
});

test('buildPopupScript: frequency="once-per-user" uses localStorage + ts-based TTL (default 30 days)', () => {
  const s = buildPopupScript({
    trigger: { mode: "auto-delay" },
    frequency: "once-per-user",
    storageKey: "k",
    triggerBtnHtmlId: "t",
  });
  assert.match(s, /localStorage\.getItem\('k'\)/);
  assert.match(s, /JSON\.parse/);
  assert.match(s, /Date\.now\(\)/);
  // 30 days in ms = 2592000000
  assert.match(s, /2592000000/);
  assert.match(s, /localStorage\.setItem\('k',JSON\.stringify\(\{ts:Date\.now\(\)\}\)\)/);
});

test('buildPopupScript: frequency="once-per-user" with custom expiryDays', () => {
  const s = buildPopupScript({
    trigger: { mode: "auto-delay" },
    frequency: "once-per-user",
    storageKey: "k",
    triggerBtnHtmlId: "t",
    expiryDays: 7,
  });
  // 7 days = 604800000 ms
  assert.match(s, /604800000/);
});

test('buildPopupScript: custom storageKey is used in all storage calls', () => {
  const s = buildPopupScript({
    trigger: { mode: "auto-delay" },
    frequency: "once-per-session",
    storageKey: "my-popup-key-2026",
    triggerBtnHtmlId: "t",
  });
  assert.match(s, /sessionStorage\.getItem\('my-popup-key-2026'\)/);
  assert.match(s, /sessionStorage\.setItem\('my-popup-key-2026','1'\)/);
});

// ────────────────────────────────────────────────────────────────────────────
// addPopup orchestrator
// ────────────────────────────────────────────────────────────────────────────

test("addPopup: returns the full set of IDs (wrapper, dialog, trigger, content, image, close, script)", () => {
  const { result } = buildPopup();
  assert.ok(result.wrapperId);
  assert.ok(result.dialogId);
  assert.ok(result.triggerId);
  assert.ok(result.triggerBtnId);
  assert.ok(result.overlayId);
  assert.ok(result.contentId);
  assert.ok(result.imageId);
  assert.ok(result.closeId);
  assert.ok(result.closeBtnId);
  assert.ok(result.scriptId);
  assert.ok(result.triggerBtnHtmlId);
});

test("addPopup: wrapper Box label defaults to 'Popup' (replace target)", () => {
  const { result, payload } = buildPopup();
  const wrapper = payload.instances.find((i) => i.id === result.wrapperId);
  assert.equal(wrapper.label, "Popup");
});

test("addPopup: wrapper Box label is overridable", () => {
  const { result, payload } = buildPopup({ label: "Newsletter Popup" });
  const wrapper = payload.instances.find((i) => i.id === result.wrapperId);
  assert.equal(wrapper.label, "Newsletter Popup");
});

test("addPopup: hidden trigger button carries id + aria-hidden + tabIndex=-1", () => {
  const { result, payload } = buildPopup();
  const btnProps = payload.props.filter((p) => p.instanceId === result.triggerBtnId);
  const idProp = btnProps.find((p) => p.name === "id");
  const ariaHidden = btnProps.find((p) => p.name === "aria-hidden");
  const tabIndex = btnProps.find((p) => p.name === "tabIndex");
  assert.ok(idProp, "id prop must be present");
  assert.equal(idProp.value, result.triggerBtnHtmlId);
  assert.equal(ariaHidden.value, "true");
  assert.equal(tabIndex.value, -1);
});

test("addPopup: triggerBtnHtmlId is the same id targeted by the script", () => {
  const { result, payload } = buildPopup();
  const scriptProp = payload.props.find(
    (p) => p.instanceId === result.scriptId && p.name === "code",
  );
  assert.ok(scriptProp, "script code prop must exist");
  assert.match(scriptProp.value, new RegExp(`getElementById\\('${result.triggerBtnHtmlId}'\\)`));
});

test("addPopup: DialogTitle + DialogDescription default a11y copy", () => {
  const { result, payload } = buildPopup();
  const title = payload.instances.find((i) => i.id === result.titleId);
  const desc = payload.instances.find((i) => i.id === result.descId);
  assert.equal(title.component, `${RADIX_NS_PREFIX}DialogTitle`);
  assert.equal(desc.component, `${RADIX_NS_PREFIX}DialogDescription`);
  assert.equal(
    title.children.find((c) => c.type === "text")?.value,
    "Promotional offer",
  );
  assert.equal(
    desc.children.find((c) => c.type === "text")?.value,
    "Discover our latest offer",
  );
});

test("addPopup: a11y title/description are overridable", () => {
  const { result, payload } = buildPopup({
    a11yTitle: "Black Friday Sale",
    a11yDescription: "Up to 50% off",
  });
  const title = payload.instances.find((i) => i.id === result.titleId);
  const desc = payload.instances.find((i) => i.id === result.descId);
  assert.equal(title.children.find((c) => c.type === "text")?.value, "Black Friday Sale");
  assert.equal(desc.children.find((c) => c.type === "text")?.value, "Up to 50% off");
});

test("addPopup: a11yTitle=null AND a11yDescription=null opts out", () => {
  const { result, payload } = buildPopup({ a11yTitle: null, a11yDescription: null });
  assert.equal(result.titleId, undefined);
  assert.equal(result.descId, undefined);
  assert.equal(
    payload.instances.some((i) => i.component === `${RADIX_NS_PREFIX}DialogTitle`),
    false,
  );
  assert.equal(
    payload.instances.some((i) => i.component === `${RADIX_NS_PREFIX}DialogDescription`),
    false,
  );
});

test("addPopup: content.href wraps the Image in a Link, no href → bare Image under content", () => {
  // With href
  const withHref = buildPopup({
    content: { kind: "image", assetId: "a", alt: "x", href: "/promo" },
  });
  assert.ok(withHref.result.imageLinkId, "Link wrapper expected when href provided");
  const link = withHref.payload.instances.find((i) => i.id === withHref.result.imageLinkId);
  assert.ok(link, "Link instance must exist");
  // Image must be a child of the Link, not directly of contentId
  const linkChildIds = link.children.filter((c) => c.type === "id").map((c) => c.value);
  assert.ok(linkChildIds.includes(withHref.result.imageId), "Image must be a child of the Link");

  // Without href
  const noHref = buildPopup();
  assert.equal(noHref.result.imageLinkId, undefined);
  const content = noHref.payload.instances.find((i) => i.id === noHref.result.contentId);
  const contentChildIds = content.children
    .filter((c) => c.type === "id")
    .map((c) => c.value);
  assert.ok(contentChildIds.includes(noHref.result.imageId), "Image must be a direct child of content when no href");
});

test("addPopup: Image carries assetId + alt + optional width/height props", () => {
  const { result, payload } = buildPopup({
    content: { kind: "image", assetId: "sha256abc", alt: "My alt", width: 800, height: 600 },
  });
  const props = payload.props.filter((p) => p.instanceId === result.imageId);
  const src = props.find((p) => p.name === "src");
  const alt = props.find((p) => p.name === "alt");
  const width = props.find((p) => p.name === "width");
  const height = props.find((p) => p.name === "height");
  assert.equal(src.type, "asset");
  assert.equal(src.value, "sha256abc");
  assert.equal(alt.value, "My alt");
  assert.equal(width.value, 800);
  assert.equal(height.value, 600);
});

test("addPopup: HtmlEmbed carries the generated script + executeScriptOnCanvas=false", () => {
  const { result, payload } = buildPopup({
    trigger: { mode: "auto-delay", delayMs: 1500 },
    frequency: "once-per-session",
  });
  const props = payload.props.filter((p) => p.instanceId === result.scriptId);
  const code = props.find((p) => p.name === "code");
  const exec = props.find((p) => p.name === "executeScriptOnCanvas");
  assert.ok(code, "code prop expected");
  assert.match(code.value, /<script>/);
  assert.match(code.value, /1500/);
  assert.equal(exec.value, false);
});

test("addPopup: idPrefix produces deterministic IDs", () => {
  const { result } = buildPopup({ id: "my-popup" });
  assert.equal(result.wrapperId, "my-popup-box");
  assert.equal(result.dialogId, "my-popup-dialog");
  assert.equal(result.triggerBtnId, "my-popup-trigger-btn");
  assert.equal(result.triggerBtnHtmlId, "my-popup-trigger-html");
  assert.equal(result.scriptId, "my-popup-script");
});

test("addPopup: structure — wrapper has 2 id-children (Dialog + script HtmlEmbed)", () => {
  const { result, payload } = buildPopup();
  const wrapper = payload.instances.find((i) => i.id === result.wrapperId);
  const idChildren = wrapper.children.filter((c) => c.type === "id").map((c) => c.value);
  assert.equal(idChildren.length, 2);
  assert.ok(idChildren.includes(result.dialogId));
  assert.ok(idChildren.includes(result.scriptId));
});

test("addPopup: structure — DialogClose wraps the close button (Radix-native)", () => {
  const { result, payload } = buildPopup();
  const close = payload.instances.find((i) => i.id === result.closeId);
  assert.equal(close.component, `${RADIX_NS_PREFIX}DialogClose`);
  const idChildren = close.children.filter((c) => c.type === "id").map((c) => c.value);
  assert.deepEqual(idChildren, [result.closeBtnId]);
});

test("addPopup: hidden trigger button styles include opacity:0 and pointer-events:none", () => {
  const { result, payload } = buildPopup();
  const sel = payload.styleSourceSelections.find((s) => s.instanceId === result.triggerBtnId);
  assert.ok(sel, "styleSourceSelection for trigger button must exist");
  const sources = new Set(sel.values);
  const styles = payload.styles.filter((s) => sources.has(s.styleSourceId));
  const opacity = styles.find((s) => s.property === "opacity");
  const pointerEvents = styles.find((s) => s.property === "pointerEvents");
  assert.ok(opacity, "opacity style must be present");
  assert.equal(opacity.value.value, 0);
  assert.ok(pointerEvents, "pointerEvents style must be present");
  assert.equal(pointerEvents.value.value, "none");
});

test("addPopup: closePosition top-center sets left:50% + translateX(-50%)", () => {
  const { result, payload } = buildPopup({ closePosition: "top-center" });
  const sel = payload.styleSourceSelections.find((s) => s.instanceId === result.closeBtnId);
  const sources = new Set(sel.values);
  const styles = payload.styles.filter((s) => sources.has(s.styleSourceId));
  const left = styles.find((s) => s.property === "left");
  const transform = styles.find((s) => s.property === "transform");
  assert.ok(left, "left must be set for top-center");
  assert.ok(transform, "transform must be set for top-center");
  assert.match(JSON.stringify(transform.value), /translateX/);
});

test("addPopup: closePosition top-left sets left (no right)", () => {
  const { result, payload } = buildPopup({ closePosition: "top-left" });
  const sel = payload.styleSourceSelections.find((s) => s.instanceId === result.closeBtnId);
  const sources = new Set(sel.values);
  const styles = payload.styles.filter((s) => sources.has(s.styleSourceId));
  const left = styles.find((s) => s.property === "left");
  const right = styles.find((s) => s.property === "right");
  assert.ok(left, "left must be set");
  assert.equal(right, undefined, "right must NOT be set");
});
