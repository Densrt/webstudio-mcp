// Unit tests for components/swiper.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FragmentBuilder } from "../dist/builder.js";
import { addSwiper, buildSwiperEmbedHtml } from "../dist/components/swiper.js";

function build(opts) {
  const b = new FragmentBuilder();
  const r = addSwiper(b, opts);
  return { fragment: b.build()["@webstudio/instance/v0.1"], result: r };
}

test("creates root + .swiper + .swiper-wrapper + slides + pagination + embed (defaults)", () => {
  const { fragment, result } = build({
    slides: [
      { imgSrc: "/a.jpg", alt: "A" },
      { imgSrc: "/b.jpg", alt: "B" },
    ],
  });
  // root + .swiper + .swiper-wrapper + 2 slides + 2 imgs + pagination + embed = 9
  assert.equal(fragment.instances.length, 9);
  assert.equal(result.slideIds.length, 2);
  assert.ok(result.paginationEl);
  assert.ok(result.embedId);
});

test("root carries data-swiper-root prop (scope anchor)", () => {
  const { fragment } = build({ slides: [{ imgSrc: "/a.jpg" }] });
  assert.ok(fragment.props.find((p) => p.name === "data-swiper-root" && p.value === "true"));
});

test("Swiper.js mandatory classes are set on .swiper / .swiper-wrapper / .swiper-slide", () => {
  const { fragment } = build({ slides: [{ imgSrc: "/a.jpg" }] });
  const classes = fragment.props.filter((p) => p.name === "class").map((p) => p.value);
  assert.ok(classes.includes("swiper"));
  assert.ok(classes.includes("swiper-wrapper"));
  assert.ok(classes.includes("swiper-slide"));
  assert.ok(classes.includes("swiper-pagination"));
});

test("pagination=false omits the pagination div + clue in script", () => {
  const { fragment, result } = build({
    slides: [{ imgSrc: "/a.jpg" }],
    config: { pagination: false },
  });
  assert.equal(result.paginationEl, undefined);
  const classes = fragment.props.filter((p) => p.name === "class").map((p) => p.value);
  assert.ok(!classes.includes("swiper-pagination"));
});

test("navigation=true adds .swiper-button-prev/.swiper-button-next", () => {
  const { fragment } = build({
    slides: [{ imgSrc: "/a.jpg" }],
    config: { navigation: true },
  });
  const classes = fragment.props.filter((p) => p.name === "class").map((p) => p.value);
  assert.ok(classes.includes("swiper-button-prev"));
  assert.ok(classes.includes("swiper-button-next"));
});

test("no slides → just structure (caller will attach a collection later)", () => {
  const { fragment, result } = build({ slides: [] });
  // root + .swiper + .swiper-wrapper + pagination + embed = 5
  assert.equal(fragment.instances.length, 5);
  assert.equal(result.slideIds.length, 0);
});

test("empty slides means no Image instance and no img src prop", () => {
  const { fragment } = build({ slides: [] });
  assert.equal(fragment.instances.filter((i) => i.component === "Image").length, 0);
});

test("buildSwiperEmbedHtml pins the Swiper version in the CDN URLs", () => {
  const html = buildSwiperEmbedHtml({}, "12");
  assert.match(html, /swiper@12/);
});

test("buildSwiperEmbedHtml emits autoplay block when autoplay is enabled (default)", () => {
  const html = buildSwiperEmbedHtml({}, "11");
  assert.match(html, /autoplay: \{ delay: 3500/);
});

test("buildSwiperEmbedHtml omits autoplay when autoplay=false", () => {
  const html = buildSwiperEmbedHtml({ autoplay: false }, "11");
  assert.doesNotMatch(html, /autoplay: \{/);
});

test("buildSwiperEmbedHtml emits navigation block only when enabled", () => {
  const off = buildSwiperEmbedHtml({}, "11");
  const on = buildSwiperEmbedHtml({ navigation: true }, "11");
  assert.doesNotMatch(off, /navigation: \{/);
  assert.match(on, /navigation: \{/);
});

test("buildSwiperEmbedHtml respects effect / slidesPerView / speed config", () => {
  const html = buildSwiperEmbedHtml({ effect: "fade", slidesPerView: 3, speed: 1200 }, "11");
  assert.match(html, /effect: 'fade'/);
  assert.match(html, /slidesPerView: 3/);
  assert.match(html, /speed: 1200/);
});

test("id prefix is respected on all instances", () => {
  const { result } = build({ id: "myw", slides: [{ imgSrc: "/a.jpg" }] });
  assert.equal(result.rootId, "myw-root");
  assert.equal(result.swiperEl, "myw-swiper");
  assert.equal(result.wrapperEl, "myw-wrap");
  assert.equal(result.slideIds[0], "myw-slide-0");
  assert.equal(result.paginationEl, "myw-pag");
  assert.equal(result.embedId, "myw-embed");
});

test("aspectRatio=null omits the aspect-ratio style on root", () => {
  const { fragment } = build({ slides: [{ imgSrc: "/a.jpg" }], aspectRatio: null });
  const json = JSON.stringify(fragment);
  assert.doesNotMatch(json, /aspectRatio/);
});
