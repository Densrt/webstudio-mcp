// HTML <details>/<summary> accordion.
// Lighter alternative — native HTML disclosure (smaller bundle, accessible by default).

import { FragmentBuilder, newId, color, px, num, keyword } from "../builder.js";
import type { InstanceId } from "../types.js";

export interface AccordionItem {
  summary: string;
  content: string;
  /** If true, the item starts open (`open` attribute). */
  open?: boolean;
}

export interface AccordionOptions {
  parentId?: InstanceId;
  id?: string;
  items: AccordionItem[];
  /** Border color between items (default: rgba(0,0,0,0.08)). */
  borderColor?: string;
  /** Summary text color (default: inherit). */
  summaryColor?: string;
}

export interface AccordionResult {
  containerId: InstanceId;
  itemIds: { detailsId: InstanceId; summaryId: InstanceId; contentId: InstanceId }[];
}

export function addAccordion(b: FragmentBuilder, options: AccordionOptions): AccordionResult {
  const p = options.id ?? newId();
  const border = options.borderColor ? color(options.borderColor) : color({ r: 0, g: 0, b: 0, a: 0.08 });

  const containerId = b.addInstance("ws:element", { id: `${p}-accordion`, parentId: options.parentId, tag: "div", label: "Accordion" });
  b.addStyles(containerId, {
    display: keyword("flex"),
    flexDirection: keyword("column"),
  });

  const itemIds: AccordionResult["itemIds"] = [];
  options.items.forEach((item, i) => {
    const detailsId = b.addInstance("ws:element", { id: `${p}-d-${i}`, parentId: containerId, tag: "details", label: item.summary });
    if (item.open) b.addProp(detailsId, "open", "boolean", true);
    b.addStyles(detailsId, {
      borderBottomWidth: px(1),
      borderBottomStyle: keyword("solid"),
      borderBottomColor: border,
    });

    const summaryId = b.addInstance("ws:element", { id: `${p}-s-${i}`, parentId: detailsId, tag: "summary" });
    b.addText(summaryId, item.summary);
    b.addStyles(summaryId, {
      paddingTop: px(16), paddingBottom: px(16),
      fontWeight: num(500),
      cursor: keyword("pointer"),
      listStyleType: keyword("none"),
      ...(options.summaryColor && { color: color(options.summaryColor) }),
    });

    const contentId = b.addInstance("ws:element", { id: `${p}-c-${i}`, parentId: detailsId, tag: "div" });
    b.addText(contentId, item.content);
    b.addStyles(contentId, {
      paddingTop: px(8), paddingBottom: px(16),
      lineHeight: num(1.6),
    });

    itemIds.push({ detailsId, summaryId, contentId });
  });

  return { containerId, itemIds };
}
