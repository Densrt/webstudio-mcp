// Bento — multi-cell CSS grid layout.
// Each item declares its column and row spans; the helper produces the
// grid container + the N card instances with the right grid-column/grid-row
// applied on each. By default, the layout collapses to a single-column stack
// on mobile (configurable).
//
// Scope: lays down structure + grid positioning only. Visual styling
// (backgrounds, padding, typography) is left to the caller — apply via
// `bg` per item, or your own tokens via `webstudio_apply_token`.

import { FragmentBuilder, newId, color, px, num, keyword, raw } from "../builder.js";
import type { InstanceId, StyleValue } from "../types.js";

export interface BentoItem {
  /** Visible label in the navigator (default "Bento card N"). */
  label?: string;
  /** Optional plain-text content rendered inside the card. */
  text?: string;
  /** CSS grid-column value. E.g. 1 (single column) or "1 / 3" (span). Default "auto". */
  col?: string | number;
  /** CSS grid-row value. E.g. 2 or "1 / 4" (span). Default "auto". */
  row?: string | number;
  /** Background hex color (optional). */
  bg?: string;
  /** Text color hex (optional). */
  textColor?: string;
}

export interface BentoOptions {
  parentId?: InstanceId;
  id?: string;
  /** Visible label of the grid container in the navigator. Default "Bento grid". */
  label?: string;
  /** Cards. */
  items: BentoItem[];
  /** grid-template-columns CSS value (e.g. "1fr 1fr", "repeat(3, 1fr)"). Default "1fr 1fr". */
  columns?: string;
  /** grid-template-rows CSS value (e.g. "repeat(6, 1fr)", "auto"). Default "repeat(6, 1fr)". */
  rows?: string;
  /** Gap between cards in px. Default 16. */
  gapPx?: number;
  /** Minimum container height in px (needed when rows are equal-height with no intrinsic content). Default 540. Pass 0 to skip. */
  minHeightPx?: number;
  /** Card padding in px. Default 24. */
  paddingPx?: number;
  /** Card border-radius in px. Default 12. */
  radiusPx?: number;
  /** Breakpoint label to reset to 1-column stack on (if found). Default "Mobile portrait". Pass null to skip the responsive override. */
  mobileBreakpointLabel?: string | null;
}

export interface BentoResult {
  gridId: InstanceId;
  cardIds: InstanceId[];
}

function gridValue(v: string | number | undefined): StyleValue {
  if (v === undefined || v === "auto") return keyword("auto");
  if (typeof v === "number") return num(v);
  return raw(v);
}

export function addBento(b: FragmentBuilder, options: BentoOptions): BentoResult {
  if (!options.items || options.items.length === 0) {
    throw new Error("Bento requires at least one item.");
  }
  const p = options.id ?? newId();
  const columns = options.columns ?? "1fr 1fr";
  const rows = options.rows ?? "repeat(6, 1fr)";
  const gap = options.gapPx ?? 16;
  const minH = options.minHeightPx ?? 540;
  const padding = options.paddingPx ?? 24;
  const radius = options.radiusPx ?? 12;
  const mobileLabel = options.mobileBreakpointLabel === undefined ? "Mobile portrait" : options.mobileBreakpointLabel;

  // Grid container
  const gridId = b.addInstance("ws:element", {
    id: `${p}-grid`,
    parentId: options.parentId,
    tag: "div",
    label: options.label ?? "Bento grid",
  });
  const gridStyles: Record<string, StyleValue> = {
    display: keyword("grid"),
    gridTemplateColumns: raw(columns),
    gridTemplateRows: raw(rows),
    columnGap: px(gap),
    rowGap: px(gap),
    width: { type: "unit", value: 100, unit: "%" } as StyleValue,
  };
  if (minH > 0) gridStyles.minHeight = px(minH);
  b.addStyles(gridId, gridStyles);

  // Mobile responsive override on the grid: 1 column, auto rows
  if (mobileLabel) {
    b.addStyles(gridId, {
      gridTemplateColumns: raw("1fr"),
      gridTemplateRows: keyword("auto"),
      ...(minH > 0 ? { minHeight: keyword("auto") } : {}),
    }, mobileLabel);
  }

  // Cards
  const cardIds: InstanceId[] = [];
  options.items.forEach((it, i) => {
    const cardId = b.addInstance("ws:element", {
      id: `${p}-card-${i}`,
      parentId: gridId,
      tag: "div",
      label: it.label ?? `Bento card ${i + 1}`,
    });
    cardIds.push(cardId);

    const cardStyles: Record<string, StyleValue> = {
      display: keyword("flex"),
      alignItems: keyword("center"),
      justifyContent: keyword("center"),
      paddingTop: px(padding), paddingRight: px(padding),
      paddingBottom: px(padding), paddingLeft: px(padding),
      borderTopLeftRadius: px(radius), borderTopRightRadius: px(radius),
      borderBottomRightRadius: px(radius), borderBottomLeftRadius: px(radius),
      boxSizing: keyword("border-box"),
      minWidth: px(0), minHeight: px(0),
      gridColumn: gridValue(it.col),
      gridRow: gridValue(it.row),
    };
    if (it.bg) cardStyles.backgroundColor = color(it.bg);
    if (it.textColor) cardStyles.color = color(it.textColor);
    b.addStyles(cardId, cardStyles);

    // Mobile reset: clear grid placement so cards stack
    if (mobileLabel) {
      b.addStyles(cardId, {
        gridColumn: keyword("auto"),
        gridRow: keyword("auto"),
        minHeight: px(140),
      }, mobileLabel);
    }

    if (it.text) {
      b.addText(cardId, it.text);
    }
  });

  return { gridId, cardIds };
}
