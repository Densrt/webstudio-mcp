// Radix Dialog helper.
// Structure: Dialog > [DialogTrigger > Button] + [DialogOverlay > DialogContent]

import { FragmentBuilder, newId } from "../builder.js";
import type { InstanceId } from "../types.js";

export interface DialogOptions {
  parentId?: InstanceId;
  id?: string;
  triggerLabel?: string;
  title?: string;
  description?: string;
}

export interface DialogResult {
  dialogId: InstanceId;
  triggerId: InstanceId;
  overlayId: InstanceId;
  contentId: InstanceId;
  closeId: InstanceId;
}

export function addDialog(b: FragmentBuilder, options: DialogOptions = {}): DialogResult {
  const p = options.id ?? newId();

  const dialogId = b.addInstance("Dialog", { id: `${p}-dialog`, parentId: options.parentId });

  // Trigger
  const triggerId = b.addInstance("DialogTrigger", { id: `${p}-trigger`, parentId: dialogId });
  const triggerBtn = b.addInstance("Button", { id: `${p}-trigger-btn`, parentId: triggerId });
  b.addText(triggerBtn, options.triggerLabel ?? "Open");

  // Overlay → Content
  const overlayId = b.addInstance("DialogOverlay", { id: `${p}-overlay`, parentId: dialogId });
  const contentId = b.addInstance("DialogContent", { id: `${p}-content`, parentId: overlayId });

  if (options.title) {
    const titleId = b.addInstance("DialogTitle", { id: `${p}-title`, parentId: contentId });
    b.addText(titleId, options.title);
  }
  if (options.description) {
    const descId = b.addInstance("DialogDescription", { id: `${p}-desc`, parentId: contentId });
    b.addText(descId, options.description);
  }

  // Close button
  const closeId = b.addInstance("DialogClose", { id: `${p}-close`, parentId: contentId });
  const closeBtn = b.addInstance("Button", { id: `${p}-close-btn`, parentId: closeId });
  b.addText(closeBtn, "×");

  return { dialogId, triggerId, overlayId, contentId, closeId };
}
