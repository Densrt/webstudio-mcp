// Card pattern: Image / Heading / Paragraph / Link CTA — sensible defaults.

import { FragmentBuilder, newId, color, px, rem, num, keyword, raw, transitionLonghands } from "../builder.js";
import type { InstanceId } from "../types.js";

export interface CardOptions {
  parentId?: InstanceId;
  id?: string;
  imageSrc?: string;        // Image URL (asset id or external URL)
  imageAlt?: string;
  title: string;
  titleTag?: "h2" | "h3" | "h4";
  text?: string;
  ctaLabel?: string;
  ctaHref?: string;
  /** Colors (defaults: white card, black text, orange accent). */
  bg?: string;
  textColor?: string;
  ctaBg?: string;
  ctaTextColor?: string;
}

export interface CardResult {
  cardId: InstanceId;
  imageId?: InstanceId;
  titleId: InstanceId;
  textId?: InstanceId;
  ctaId?: InstanceId;
}

export function addCard(b: FragmentBuilder, options: CardOptions): CardResult {
  const p = options.id ?? newId();
  const bg = color(options.bg ?? "#FFFFFF");
  const textColor = color(options.textColor ?? "#111111");
  const ctaBg = color(options.ctaBg ?? "#E07B1A");
  const ctaTextColor = color(options.ctaTextColor ?? "#FFFFFF");

  const cardId = b.addInstance("ws:element", { id: `${p}-card`, parentId: options.parentId, tag: "article", label: "Card" });
  b.addStyles(cardId, {
    display: keyword("flex"),
    flexDirection: keyword("column"),
    backgroundColor: bg,
    color: textColor,
    borderTopLeftRadius: px(12), borderTopRightRadius: px(12),
    borderBottomRightRadius: px(12), borderBottomLeftRadius: px(12),
    overflowX: keyword("hidden"),
    overflowY: keyword("hidden"),
    boxShadow: { type: "layers", value: [{ type: "shadow", position: "outset",
      offsetX: num(0), offsetY: px(2), blur: px(8), spread: num(0),
      color: color({ r: 0, g: 0, b: 0, a: 0.08 }) }] },
  });

  let imageId: InstanceId | undefined;
  if (options.imageSrc) {
    const isAsset = !options.imageSrc.startsWith("http");
    // Native Image component always — src accepts asset | URL string |
    // expression (pattern image-component; the "asset-only" myth is debunked).
    // Asset ids get the full optimization pipeline (srcset, lazy, dims).
    imageId = b.addInstance("Image", { id: `${p}-img`, parentId: cardId });
    b.addProp(imageId, "src", isAsset ? "asset" : "string", options.imageSrc);
    if (options.imageAlt) b.addProp(imageId, "alt", "string", options.imageAlt);
    b.addStyles(imageId, {
      width: { type: "unit", value: 100, unit: "%" },
      height: keyword("auto"),
      objectFit: keyword("cover"),
    });
  }

  const tag = options.titleTag ?? "h3";
  const titleId = b.addInstance("ws:element", { id: `${p}-title`, parentId: cardId, tag });
  b.addText(titleId, options.title);
  b.addStyles(titleId, {
    paddingTop: px(20), paddingRight: px(20), paddingLeft: px(20),
    paddingBottom: px(8),
    fontSize: rem(1.25),
    fontWeight: num(600),
    lineHeight: num(1.3),
    marginTop: num(0), marginRight: num(0), marginBottom: num(0), marginLeft: num(0),
  });

  let textId: InstanceId | undefined;
  if (options.text) {
    textId = b.addInstance("Paragraph", { id: `${p}-text`, parentId: cardId });
    b.addText(textId, options.text);
    b.addStyles(textId, {
      paddingLeft: px(20), paddingRight: px(20),
      paddingBottom: options.ctaLabel ? px(16) : px(20),
      fontSize: rem(0.9375),
      lineHeight: num(1.5),
      opacity: num(0.85),
      marginTop: num(0), marginRight: num(0), marginBottom: num(0), marginLeft: num(0),
    });
  }

  let ctaId: InstanceId | undefined;
  if (options.ctaLabel && options.ctaHref) {
    ctaId = b.addInstance("ws:element", { id: `${p}-cta`, parentId: cardId, tag: "a", label: "CTA" });
    b.addText(ctaId, options.ctaLabel);
    b.addProp(ctaId, "href", "string", options.ctaHref);
    b.addStyles(ctaId, {
      display: keyword("inline-flex"),
      alignItems: keyword("center"),
      justifyContent: keyword("center"),
      marginTop: keyword("auto"),
      marginRight: px(20), marginBottom: px(20), marginLeft: px(20),
      paddingTop: px(10), paddingBottom: px(10),
      paddingLeft: px(16), paddingRight: px(16),
      backgroundColor: ctaBg,
      color: ctaTextColor,
      borderTopLeftRadius: px(6), borderTopRightRadius: px(6),
      borderBottomRightRadius: px(6), borderBottomLeftRadius: px(6),
      fontWeight: num(600),
      fontSize: rem(0.9375),
      textDecorationLine: keyword("none"),
      ...transitionLonghands("opacity", "0.2s", "ease"),
    });
    b.addStyle(ctaId, "opacity", num(0.9), "base", ":hover");
  }

  return { cardId, imageId, titleId, textId, ctaId };
}
