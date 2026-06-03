// Ticker / Marquee CSS — single HtmlEmbed with inline <style> + duplicated DOM.
// Pure CSS infinite horizontal scroll for partner logos / testimonials / news.
// Pause on hover, respects prefers-reduced-motion.
//
// Validated pattern: pattern_ticker.md (real-world case 2026-05-09).
// Architecture rules baked in (all from real-world friction):
//   - Track is position:absolute so it doesn't push the parent's width
//   - Wrapper has min-width:0 (flexbox intrinsic-width fix)
//   - Content duplicated 2x with aria-hidden+tabindex=-1 on the second half
//   - Scroll keyframes translate 0 → -50% (only valid with the 2x duplication)
//   - Optional gradient mask on the edges for nicer fade-in/out

import { FragmentBuilder, newId } from "../builder.js";
import type { InstanceId } from "../types.js";

export interface TickerItem {
  /** Anchor href. Required. */
  href: string;
  /** Accessible label, read on hover/focus. */
  ariaLabel: string;
  /** Inline SVG markup (preferred) OR image URL. One of the two required. */
  svg?: string;
  /** Image URL (used when svg is omitted). */
  imgSrc?: string;
  /** Image alt (mirrors ariaLabel by default). */
  imgAlt?: string;
}

export interface TickerOptions {
  parentId?: InstanceId;
  /** Prefix for deterministic IDs (default: nanoid). */
  id?: string;
  /** Visible name in the navigator. Default "Ticker". */
  label?: string;
  /** Items rendered once, then duplicated for seamless loop. */
  items: TickerItem[];
  /** CSS class prefix (avoids collisions when multiple tickers on a page). Default "tk". */
  classPrefix?: string;
  /** Animation duration (seconds, CSS). Default 30. */
  durationSec?: number;
  /** Wrapper height in px. Default 60. */
  heightPx?: number;
  /** Logo height in px. Default 40. */
  logoHeightPx?: number;
  /** Gap between logos in px. Default 80. */
  gapPx?: number;
  /** Fade mask width on each edge in px. Set 0 to disable. Default 64. */
  fadeMaskPx?: number;
  /** Direction. Default "left" (track moves leftward). */
  direction?: "left" | "right";
  /** Pause on hover. Default true. */
  pauseOnHover?: boolean;
  /** ARIA label on the wrapper region. Default "Partners". */
  ariaLabel?: string;
}

export interface TickerResult {
  embedId: InstanceId;
  /** Generated HTML string (also pushed as the embed's `code` prop). Exposed for tests/inspection. */
  html: string;
  /** CSS class root, e.g. "skl-tk" — handy if you want to add per-project overrides elsewhere. */
  className: string;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderItems(items: TickerItem[], cls: string, duplicate: boolean): string {
  return items
    .map((it) => {
      const inner = it.svg ?? `<img src="${escapeAttr(it.imgSrc ?? "")}" alt="${escapeAttr(it.imgAlt ?? it.ariaLabel)}">`;
      const ariaAttrs = duplicate ? `aria-hidden="true" tabindex="-1"` : `aria-label="${escapeAttr(it.ariaLabel)}"`;
      return `<a class="${cls}-logo" href="${escapeAttr(it.href)}" target="_blank" rel="noopener" ${ariaAttrs}>${inner}</a>`;
    })
    .join("");
}

export function buildTickerHtml(options: TickerOptions): { html: string; className: string } {
  if (!options.items || options.items.length === 0) {
    throw new Error("Ticker requires at least one item.");
  }
  for (const it of options.items) {
    if (!it.svg && !it.imgSrc) throw new Error(`Ticker item "${it.ariaLabel}" needs svg or imgSrc.`);
  }
  const cls = (options.classPrefix ?? "tk").replace(/[^a-z0-9-]/gi, "");
  const duration = options.durationSec ?? 30;
  const height = options.heightPx ?? 60;
  const logoHeight = options.logoHeightPx ?? 40;
  const gap = options.gapPx ?? 80;
  const fade = options.fadeMaskPx ?? 64;
  const direction = options.direction ?? "left";
  const pauseOnHover = options.pauseOnHover !== false;
  const ariaLabel = options.ariaLabel ?? "Partners";

  const maskCss = fade > 0
    ? `-webkit-mask-image: linear-gradient(to right, transparent 0, #000 ${fade}px, #000 calc(100% - ${fade}px), transparent 100%);
        mask-image: linear-gradient(to right, transparent 0, #000 ${fade}px, #000 calc(100% - ${fade}px), transparent 100%);`
    : "";
  const keyframesEnd = direction === "left" ? "translateX(-50%)" : "translateX(50%)";
  const animationDir = direction === "left" ? "" : "animation-direction: reverse;";
  const pauseRule = pauseOnHover ? `.${cls}-track:hover { animation-play-state: paused; }` : "";

  const itemsHtml = renderItems(options.items, cls, false) + renderItems(options.items, cls, true);

  const html = `<style>
.${cls} { position: relative; display: block; width: 100%; max-width: 100%; min-width: 0; height: ${height}px; overflow: hidden; ${maskCss}}
.${cls}-track { position: absolute; top: 0; left: 0; height: 100%; display: flex; align-items: center; gap: ${gap}px; width: max-content; animation: ${cls}-scroll ${duration}s linear infinite; ${animationDir}}
${pauseRule}
.${cls}-logo { flex-shrink: 0; display: flex; align-items: center; height: ${logoHeight}px; text-decoration: none; }
.${cls}-logo svg { height: ${logoHeight}px; width: auto; display: block; }
.${cls}-logo img { height: ${logoHeight}px; width: auto; object-fit: contain; display: block; }
@keyframes ${cls}-scroll { from { transform: translateX(0); } to { transform: ${keyframesEnd}; } }
@media (prefers-reduced-motion: reduce) { .${cls}-track { animation: none; } }
</style>
<div class="${cls}" role="region" aria-label="${escapeAttr(ariaLabel)}">
<div class="${cls}-track">${itemsHtml}</div>
</div>`;

  return { html, className: cls };
}

export function addTicker(b: FragmentBuilder, options: TickerOptions): TickerResult {
  const p = options.id ?? newId();
  const { html, className } = buildTickerHtml(options);

  const embedId = b.addInstance("HtmlEmbed", {
    id: `${p}-ticker`,
    parentId: options.parentId,
    label: options.label ?? "Ticker",
  });
  b.addProp(embedId, "code", "string", html);

  return { embedId, html, className };
}
