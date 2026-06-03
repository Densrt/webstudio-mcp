// Swiper — full-featured carousel powered by Swiper.js (loaded from CDN).
// Use when you need autoplay, loops, fancy transitions, pagination, navigation,
// or effects. For a no-dependency horizontal carousel, prefer addCarousel.
//
// Architecture (per pattern_swiper_carousel.md, MVP-8 validated):
//   root (data-swiper-root) — scoping anchor, hosts CSS overrides
//     ├── .swiper                         — Swiper.js container
//     │     └── .swiper-wrapper           — required by Swiper.js
//     │           └── .swiper-slide × N    — static or via ws:collection
//     ├── .swiper-pagination               — pagination dots (optional)
//     └── HtmlEmbed                        — Swiper CDN link + init script
//
// Self-contained: the HtmlEmbed pulls Swiper from a CDN, scopes all init by
// [data-swiper-root] so multiple swipers can co-exist on a page, and lazy-
// initialises each instance via IntersectionObserver.

import { FragmentBuilder, newId, color, px, num, keyword, raw } from "../builder.js";
import type { InstanceId, StyleValue } from "../types.js";

export interface SwiperSlide {
  /** Image URL. Required in static mode. */
  imgSrc: string;
  /** Alt text. */
  alt?: string;
  /** Optional caption shown over the slide. */
  caption?: string;
}

export interface SwiperConfig {
  loop?: boolean;            // default true
  slidesPerView?: number;    // default 1
  spaceBetween?: number;     // default 0
  speed?: number;            // default 800 (ms)
  autoplay?: false | { delay?: number; disableOnInteraction?: boolean };
  pagination?: boolean;      // default true (dots)
  navigation?: boolean;      // default false (Swiper.js arrows)
  effect?: "slide" | "fade" | "cube" | "coverflow" | "flip" | "creative" | "cards";
}

export interface SwiperOptions {
  parentId?: InstanceId;
  id?: string;
  label?: string;
  /** Static slides. Provide either `slides` or leave empty to attach a collection later. */
  slides?: SwiperSlide[];
  /** Maximum width in px (Swiper centers itself). Default 720. */
  maxWidthPx?: number;
  /** Aspect ratio CSS expression. Default "16 / 9". Pass null to skip. */
  aspectRatio?: string | null;
  /** Swiper.js runtime config. */
  config?: SwiperConfig;
  /** Swiper.js version pinned in the CDN URL. Default "11". */
  swiperVersion?: string;
}

export interface SwiperResult {
  rootId: InstanceId;
  swiperEl: InstanceId;
  wrapperEl: InstanceId;
  slideIds: InstanceId[];
  paginationEl?: InstanceId;
  embedId: InstanceId;
  /** The generated init script as a string (also pushed as embed prop). */
  embedHtml: string;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildSwiperEmbedHtml(config: SwiperConfig, version: string): string {
  const c = {
    loop: config.loop !== false,
    slidesPerView: config.slidesPerView ?? 1,
    spaceBetween: config.spaceBetween ?? 0,
    speed: config.speed ?? 800,
    autoplay: config.autoplay === false ? false : {
      delay: (config.autoplay as { delay?: number; disableOnInteraction?: boolean } | undefined)?.delay ?? 3500,
      disableOnInteraction: (config.autoplay as { delay?: number; disableOnInteraction?: boolean } | undefined)?.disableOnInteraction ?? false,
    },
    pagination: config.pagination !== false,
    navigation: config.navigation === true,
    effect: config.effect ?? "slide",
  };

  const paginationJs = c.pagination
    ? `pagination: { el: root.querySelector('.swiper-pagination'), clickable: true },`
    : "";
  const navigationJs = c.navigation
    ? `navigation: { nextEl: root.querySelector('.swiper-button-next'), prevEl: root.querySelector('.swiper-button-prev') },`
    : "";
  const autoplayJs = c.autoplay
    ? `autoplay: { delay: ${(c.autoplay as { delay: number }).delay}, disableOnInteraction: ${(c.autoplay as { disableOnInteraction: boolean }).disableOnInteraction} },`
    : "";

  return `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swiper@${version}/swiper-bundle.min.css">
<script src="https://cdn.jsdelivr.net/npm/swiper@${version}/swiper-bundle.min.js" defer></script>
<style>
[data-swiper-root] .swiper-pagination { position: absolute !important; bottom: 12px; left: 0; right: 0; text-align: center; z-index: 10; }
[data-swiper-root] .swiper-pagination-bullet { width: 8px; height: 8px; opacity: 1 !important; margin: 0 4px !important; transition: all 0.3s ease; }
[data-swiper-root] .swiper-pagination-bullet-active { transform: scale(1.3); }
[data-swiper-root] .swiper { width: 100%; height: 100%; }
[data-swiper-root] .swiper-slide { display: flex !important; align-items: center; justify-content: center; }
[data-swiper-root] .swiper-slide img { width: 100%; height: 100%; object-fit: contain; display: block; }
[data-swiper-root] .swiper:not(.swiper-initialized) { opacity: 0; }
[data-swiper-root] .swiper.swiper-initialized { opacity: 1; transition: opacity 0.3s ease; }
</style>
<script>
(function() {
  var MAX_WAIT_MS = 3000;
  var start = Date.now();
  function bootEach() {
    document.querySelectorAll('[data-swiper-root]:not([data-swiper-init])').forEach(function(root) {
      var el = root.querySelector('.swiper');
      if (!el) return;
      root.setAttribute('data-swiper-init', 'pending');
      var io = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) { io.disconnect(); initOne(root, el); }
        });
      }, { rootMargin: '100px' });
      io.observe(root);
    });
  }
  function initOne(root, el) {
    if (typeof Swiper === 'undefined') {
      if (Date.now() - start > MAX_WAIT_MS) {
        console.warn('Swiper.js not loaded after', MAX_WAIT_MS, 'ms.');
        root.setAttribute('data-swiper-init', 'failed');
        return;
      }
      return setTimeout(function() { initOne(root, el); }, 100);
    }
    new Swiper(el, {
      loop: ${c.loop},
      slidesPerView: ${c.slidesPerView},
      spaceBetween: ${c.spaceBetween},
      speed: ${c.speed},
      effect: '${c.effect}',
      ${autoplayJs}
      ${paginationJs}
      ${navigationJs}
    });
    root.setAttribute('data-swiper-init', 'done');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootEach);
  } else { bootEach(); }
})();
</script>`;
}

export function addSwiper(b: FragmentBuilder, options: SwiperOptions): SwiperResult {
  const p = options.id ?? newId();
  const slides = options.slides ?? [];
  const config = options.config ?? {};
  const version = options.swiperVersion ?? "11";
  const maxWidth = options.maxWidthPx ?? 720;
  const aspectRatio = options.aspectRatio === undefined ? "16 / 9" : options.aspectRatio;

  // Root (data-swiper-root)
  const rootId = b.addInstance("ws:element", {
    id: `${p}-root`, parentId: options.parentId, tag: "div",
    label: options.label ?? "Swiper",
  });
  b.addProp(rootId, "data-swiper-root", "string", "true");
  const rootStyles: Record<string, StyleValue> = {
    width: { type: "unit", value: 100, unit: "%" } as StyleValue,
    maxWidth: px(maxWidth),
    marginLeft: keyword("auto"),
    marginRight: keyword("auto"),
    position: keyword("relative"),
    overflowX: keyword("hidden"),
    overflowY: keyword("hidden"),
  };
  if (aspectRatio) rootStyles.aspectRatio = raw(aspectRatio);
  b.addStyles(rootId, rootStyles);

  // .swiper
  const swiperEl = b.addInstance("ws:element", {
    id: `${p}-swiper`, parentId: rootId, tag: "div", label: "Swiper container",
  });
  b.addProp(swiperEl, "class", "string", "swiper");

  // .swiper-wrapper
  const wrapperEl = b.addInstance("ws:element", {
    id: `${p}-wrap`, parentId: swiperEl, tag: "div", label: "Swiper wrapper",
  });
  b.addProp(wrapperEl, "class", "string", "swiper-wrapper");

  // Slides
  const slideIds: InstanceId[] = [];
  if (slides.length > 0) {
    slides.forEach((s, i) => {
      const slideId = b.addInstance("ws:element", {
        id: `${p}-slide-${i}`, parentId: wrapperEl, tag: "div",
        label: `Slide ${i + 1}`,
      });
      slideIds.push(slideId);
      b.addProp(slideId, "class", "string", "swiper-slide");

      // Slides accept URL strings; use ws:element + <img> rather than the native
      // Image component (which requires asset ids).
      const imgId = b.addInstance("ws:element", {
        id: `${p}-img-${i}`, parentId: slideId, tag: "img",
      });
      b.addProp(imgId, "src", "string", s.imgSrc);
      b.addProp(imgId, "alt", "string", s.alt ?? "");
      b.addProp(imgId, "loading", "string", "lazy");

      if (s.caption) {
        const capId = b.addInstance("ws:element", { id: `${p}-cap-${i}`, parentId: slideId, tag: "div", label: "Caption" });
        b.addText(capId, s.caption);
      }
    });
  }
  // (When slides is empty, the caller is expected to attach a ws:collection
  // child to wrapperEl manually, with class="swiper-slide" on its template.)

  // Pagination (optional)
  let paginationEl: InstanceId | undefined;
  if (config.pagination !== false) {
    paginationEl = b.addInstance("ws:element", {
      id: `${p}-pag`, parentId: rootId, tag: "div", label: "Swiper pagination",
    });
    b.addProp(paginationEl, "class", "string", "swiper-pagination");
  }

  // Navigation arrows (optional)
  if (config.navigation === true) {
    const prev = b.addInstance("ws:element", { id: `${p}-nav-prev`, parentId: rootId, tag: "div", label: "Swiper prev" });
    b.addProp(prev, "class", "string", "swiper-button-prev");
    const next = b.addInstance("ws:element", { id: `${p}-nav-next`, parentId: rootId, tag: "div", label: "Swiper next" });
    b.addProp(next, "class", "string", "swiper-button-next");
  }

  // HtmlEmbed
  const embedHtml = buildSwiperEmbedHtml(config, version);
  const embedId = b.addInstance("HtmlEmbed", { id: `${p}-embed`, parentId: rootId, label: "Swiper script" });
  b.addProp(embedId, "code", "string", embedHtml);
  b.addProp(embedId, "executeScriptOnCanvas", "boolean", true);

  return { rootId, swiperEl, wrapperEl, slideIds, paginationEl, embedId, embedHtml };
}
