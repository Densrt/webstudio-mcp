// Carousel — native CSS scroll-snap horizontal carousel with prev/next arrows
// driven by a tiny inline JS (scoped via [data-carousel-root]).
//
// No external dependency, no Webstudio "Carousel" component (which doesn't
// exist). For autoplay / advanced effects / pagination, prefer addSwiper.
//
// Architecture (per pattern_carousel_scroll_snap.md, MVP-7 validated):
//   wrapper (data-carousel-root) — position:relative, width:100%, min-width:0
//     ├── track (data-carousel-track) — grid + auto-columns + scroll-snap
//     │     └── N card placeholders (or 1 collection slot)
//     ├── prev button (data-carousel-prev) — position:absolute left
//     ├── next button (data-carousel-next) — position:absolute right
//     └── HtmlEmbed — <script> binds prev/next to track.scrollBy
//
// CRUCIAL: track uses `display:grid + gridAutoColumns: calc((100% - …) / N)`
// instead of flex so card widths are derived from the parent and cannot bust
// the viewport.

import { FragmentBuilder, newId, px, num, keyword, raw } from "../builder.js";
import type { InstanceId, StyleValue } from "../types.js";

export interface CarouselSlide {
  /** Label shown in the navigator. Default "Slide N". */
  label?: string;
  /** Optional plain text rendered inside the slide. */
  text?: string;
}

export interface CarouselOptions {
  parentId?: InstanceId;
  id?: string;
  /** Slides rendered as siblings of the track. Provide either `slides` or `slotCount`. */
  slides?: CarouselSlide[];
  /** If you plan to bind a ws:collection later, pass slotCount=1 to get a single placeholder you can replace with the collection. */
  slotCount?: number;
  /** Visible label of the wrapper. Default "Carousel". */
  label?: string;
  /** Cards visible per breakpoint. Defaults: { desktop: 3, tablet: 2, mobile: 1 }. */
  cardsPerView?: { desktop?: number; tablet?: number; mobile?: number };
  /** Gap between cards. Default "16px". Accepts any CSS length (e.g. "var(--gap-2)"). */
  gap?: string;
  /** Show prev/next arrows. Default true. */
  arrows?: boolean;
  /** Hide arrows below this breakpoint label. Default "Mobile portrait". */
  hideArrowsBelow?: string | null;
  /** Breakpoint labels — override if your project uses non-standard names. */
  breakpointLabels?: { tablet?: string; mobile?: string };
  /** ARIA label on the wrapper. Default "Carousel". */
  ariaLabel?: string;
  /** Arrow button colors. Defaults: white bg, dark text. */
  arrowBg?: string;
  arrowColor?: string;
}

export interface CarouselResult {
  wrapperId: InstanceId;
  trackId: InstanceId;
  slideIds: InstanceId[];
  prevId?: InstanceId;
  nextId?: InstanceId;
  embedId: InstanceId;
}

function autoColumnsExpr(cardsPerView: number, gap: string): string {
  // gridAutoColumns = (100% - total gaps) / N
  // Total gaps = (N - 1) × gap
  if (cardsPerView <= 0) return "100%";
  if (cardsPerView === 1) return "100%";
  return `calc((100% - ${cardsPerView - 1} * ${gap}) / ${cardsPerView})`;
}

export function carouselScript(): string {
  return `<script>
(function() {
  document.querySelectorAll('[data-carousel-root]').forEach(function(root) {
    var track = root.querySelector('[data-carousel-track]');
    var prev = root.querySelector('[data-carousel-prev]');
    var next = root.querySelector('[data-carousel-next]');
    if (!track || !prev || !next) return;
    function step() {
      var card = track.firstElementChild;
      if (!card) return track.clientWidth;
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return card.offsetWidth + gap;
    }
    prev.addEventListener('click', function() { track.scrollBy({ left: -step(), behavior: 'smooth' }); });
    next.addEventListener('click', function() { track.scrollBy({ left: step(), behavior: 'smooth' }); });
  });
})();
</script>
<style>[data-carousel-track]::-webkit-scrollbar { display: none; }</style>`;
}

export function addCarousel(b: FragmentBuilder, options: CarouselOptions): CarouselResult {
  const p = options.id ?? newId();
  const slides = options.slides ?? Array.from({ length: options.slotCount ?? 3 }, () => ({} as CarouselSlide));
  if (slides.length === 0) throw new Error("Carousel requires at least one slide or slotCount ≥ 1.");

  const cpv = {
    desktop: options.cardsPerView?.desktop ?? 3,
    tablet: options.cardsPerView?.tablet ?? 2,
    mobile: options.cardsPerView?.mobile ?? 1,
  };
  const gap = options.gap ?? "16px";
  const arrows = options.arrows !== false;
  const hideArrowsBelow = options.hideArrowsBelow === undefined ? "Mobile portrait" : options.hideArrowsBelow;
  const tabletLabel = options.breakpointLabels?.tablet ?? "Tablet";
  const mobileLabel = options.breakpointLabels?.mobile ?? "Mobile portrait";

  // Wrapper
  const wrapperId = b.addInstance("ws:element", {
    id: `${p}-wrap`,
    parentId: options.parentId,
    tag: "div",
    label: options.label ?? "Carousel",
  });
  b.addProp(wrapperId, "data-carousel-root", "string", "true");
  if (options.ariaLabel) b.addProp(wrapperId, "aria-label", "string", options.ariaLabel);
  b.addStyles(wrapperId, {
    position: keyword("relative"),
    width: { type: "unit", value: 100, unit: "%" } as StyleValue,
    minWidth: px(0),
  });

  // Track
  const trackId = b.addInstance("ws:element", {
    id: `${p}-track`,
    parentId: wrapperId,
    tag: "div",
    label: "Carousel track",
  });
  b.addProp(trackId, "data-carousel-track", "string", "true");
  b.addStyles(trackId, {
    display: keyword("grid"),
    gridAutoFlow: keyword("column"),
    gridAutoColumns: raw(autoColumnsExpr(cpv.desktop, gap)),
    columnGap: raw(gap),
    overflowX: keyword("auto"),
    overflowY: keyword("hidden"),
    scrollSnapType: raw("x mandatory"),
    scrollBehavior: keyword("smooth"),
    width: { type: "unit", value: 100, unit: "%" } as StyleValue,
    minWidth: px(0),
    maxWidth: { type: "unit", value: 100, unit: "%" } as StyleValue,
    scrollbarWidth: keyword("none"),
  });
  // Responsive overrides
  if (cpv.tablet !== cpv.desktop) {
    b.addStyles(trackId, { gridAutoColumns: raw(autoColumnsExpr(cpv.tablet, gap)) }, tabletLabel);
  }
  if (cpv.mobile !== cpv.tablet) {
    b.addStyles(trackId, { gridAutoColumns: raw(autoColumnsExpr(cpv.mobile, gap)) }, mobileLabel);
  }

  // Slides
  const slideIds: InstanceId[] = [];
  slides.forEach((s, i) => {
    const sid = b.addInstance("ws:element", {
      id: `${p}-slide-${i}`,
      parentId: trackId,
      tag: "div",
      label: s.label ?? `Slide ${i + 1}`,
    });
    slideIds.push(sid);
    b.addStyles(sid, {
      width: { type: "unit", value: 100, unit: "%" } as StyleValue,
      minWidth: px(0),
      boxSizing: keyword("border-box"),
      scrollSnapAlign: keyword("start"),
      scrollSnapStop: keyword("always"),
    });
    if (s.text) b.addText(sid, s.text);
  });

  // Arrows
  let prevId: InstanceId | undefined;
  let nextId: InstanceId | undefined;
  if (arrows) {
    const arrowBg = options.arrowBg ?? "#FFFFFF";
    const arrowColor = options.arrowColor ?? "#111111";
    for (const which of ["prev", "next"] as const) {
      const id = b.addInstance("ws:element", {
        id: `${p}-${which}`,
        parentId: wrapperId,
        tag: "button",
        label: which === "prev" ? "Prev" : "Next",
      });
      b.addProp(id, `data-carousel-${which}`, "string", "true");
      b.addProp(id, "aria-label", "string", which === "prev" ? "Previous" : "Next");
      b.addProp(id, "type", "string", "button");
      b.addText(id, which === "prev" ? "‹" : "›");
      b.addStyles(id, {
        position: keyword("absolute"),
        top: { type: "unit", value: 50, unit: "%" } as StyleValue,
        transform: raw("translateY(-50%)"),
        width: px(40), height: px(40),
        display: keyword("flex"),
        alignItems: keyword("center"),
        justifyContent: keyword("center"),
        borderTopLeftRadius: { type: "unit", value: 50, unit: "%" } as StyleValue,
        borderTopRightRadius: { type: "unit", value: 50, unit: "%" } as StyleValue,
        borderBottomLeftRadius: { type: "unit", value: 50, unit: "%" } as StyleValue,
        borderBottomRightRadius: { type: "unit", value: 50, unit: "%" } as StyleValue,
        backgroundColor: { type: "color", colorSpace: "hex", components: hexToRgb(arrowBg), alpha: 1 } as StyleValue,
        color: { type: "color", colorSpace: "hex", components: hexToRgb(arrowColor), alpha: 1 } as StyleValue,
        cursor: keyword("pointer"),
        zIndex: num(2),
        [which === "prev" ? "left" : "right"]: px(8),
        fontSize: px(20),
        lineHeight: num(1),
      });
      if (hideArrowsBelow) {
        b.addStyles(id, { display: keyword("none") }, hideArrowsBelow);
      }
      if (which === "prev") prevId = id;
      else nextId = id;
    }
  }

  // HtmlEmbed with script + scrollbar hide style
  const embedId = b.addInstance("HtmlEmbed", {
    id: `${p}-script`,
    parentId: wrapperId,
    label: "Carousel script",
  });
  b.addProp(embedId, "code", "string", carouselScript());

  return { wrapperId, trackId, slideIds, prevId, nextId, embedId };
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
