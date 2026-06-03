// Unit tests for components/ticker.ts.
// Tests the pure-HTML build function (buildTickerHtml) — the FragmentBuilder
// wiring is trivial (1 instance + 1 prop).

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTickerHtml } from "../dist/components/ticker.js";

const sampleItem = { href: "https://a.com", ariaLabel: "Acme", svg: "<svg></svg>" };

test("throws when items array is empty", () => {
  assert.throws(() => buildTickerHtml({ items: [] }), /at least one item/);
});

test("throws when an item lacks both svg and imgSrc", () => {
  assert.throws(() => buildTickerHtml({ items: [{ href: "/", ariaLabel: "X" }] }), /needs svg or imgSrc/);
});

test("renders items twice (once with aria-label, once with aria-hidden)", () => {
  const { html } = buildTickerHtml({ items: [sampleItem] });
  const ariaLabelHits = (html.match(/aria-label="Acme"/g) ?? []).length;
  const ariaHiddenHits = (html.match(/aria-hidden="true"/g) ?? []).length;
  assert.equal(ariaLabelHits, 1, "first half: aria-label visible");
  assert.equal(ariaHiddenHits, 1, "second half: aria-hidden duplicate");
});

test("duplicated anchors are clickable and non-focusable (tabindex=-1)", () => {
  const { html } = buildTickerHtml({ items: [sampleItem] });
  // The duplicate must keep the href (clickable) but have tabindex=-1 (not focusable)
  assert.match(html, /aria-hidden="true" tabindex="-1"/);
  assert.equal((html.match(/href="https:\/\/a.com"/g) ?? []).length, 2);
});

test("classPrefix scopes all CSS classes", () => {
  const { html, className } = buildTickerHtml({ items: [sampleItem], classPrefix: "myproj-tk" });
  assert.equal(className, "myproj-tk");
  assert.match(html, /\.myproj-tk \{/);
  assert.match(html, /\.myproj-tk-track \{/);
  assert.match(html, /@keyframes myproj-tk-scroll/);
});

test("durationSec, heightPx, logoHeightPx, gapPx are wired into CSS", () => {
  const { html } = buildTickerHtml({
    items: [sampleItem], durationSec: 60, heightPx: 100, logoHeightPx: 50, gapPx: 120,
  });
  assert.match(html, /height: 100px/);
  assert.match(html, /gap: 120px/);
  assert.match(html, /height: 50px/);
  assert.match(html, /60s linear infinite/);
});

test("fadeMaskPx=0 disables the gradient mask", () => {
  const withMask = buildTickerHtml({ items: [sampleItem] }).html;
  const noMask = buildTickerHtml({ items: [sampleItem], fadeMaskPx: 0 }).html;
  assert.match(withMask, /mask-image:/);
  assert.doesNotMatch(noMask, /mask-image:/);
});

test("direction=right reverses the keyframe end and adds animation-direction", () => {
  const right = buildTickerHtml({ items: [sampleItem], direction: "right" }).html;
  assert.match(right, /translateX\(50%\)/);
  assert.match(right, /animation-direction: reverse/);
});

test("pauseOnHover=false omits the hover rule", () => {
  const off = buildTickerHtml({ items: [sampleItem], pauseOnHover: false }).html;
  assert.doesNotMatch(off, /animation-play-state: paused/);
});

test("img-based items render as <img> with alt", () => {
  const { html } = buildTickerHtml({
    items: [{ href: "/", ariaLabel: "Foo", imgSrc: "/logo.png", imgAlt: "Foo logo" }],
  });
  assert.match(html, /<img src="\/logo.png" alt="Foo logo">/);
});

test("html-injection in href/ariaLabel is escaped", () => {
  const { html } = buildTickerHtml({
    items: [{ href: 'javascript:alert("xss")', ariaLabel: 'O"R<eilly>', svg: "<svg/>" }],
  });
  assert.doesNotMatch(html, /alert\("xss"\)/);
  assert.match(html, /&quot;/);
  assert.match(html, /&lt;/);
});

test("respects prefers-reduced-motion via @media block", () => {
  const { html } = buildTickerHtml({ items: [sampleItem] });
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
});
