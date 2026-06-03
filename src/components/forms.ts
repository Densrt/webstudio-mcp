// Small form/feedback Radix helpers: Tooltip, Switch, Checkbox.

import { FragmentBuilder, newId } from "../builder.js";
import type { InstanceId } from "../types.js";

// ─── Tooltip ───────────────────────────────────────────────────────────────────
// Structure: Tooltip > [TooltipTrigger > Button] + [TooltipContent > Text]

export interface TooltipOptions {
  parentId?: InstanceId;
  id?: string;
  triggerLabel?: string;
  tooltipText?: string;
  delayDuration?: number;
}

export interface TooltipResult {
  tooltipId: InstanceId;
  triggerId: InstanceId;
  contentId: InstanceId;
}

export function addTooltip(b: FragmentBuilder, options: TooltipOptions = {}): TooltipResult {
  const p = options.id ?? newId();

  const tooltipId = b.addInstance("Tooltip", { id: `${p}-tooltip`, parentId: options.parentId });
  if (options.delayDuration !== undefined) {
    b.addProp(tooltipId, "delayDuration", "number", options.delayDuration);
  }

  const triggerId = b.addInstance("TooltipTrigger", { id: `${p}-trigger`, parentId: tooltipId });
  const triggerBtn = b.addInstance("Button", { id: `${p}-trigger-btn`, parentId: triggerId });
  b.addText(triggerBtn, options.triggerLabel ?? "?");

  const contentId = b.addInstance("TooltipContent", { id: `${p}-content`, parentId: tooltipId });
  const textId = b.addInstance("Text", { id: `${p}-text`, parentId: contentId });
  b.addText(textId, options.tooltipText ?? "");

  return { tooltipId, triggerId, contentId };
}

// ─── Switch ────────────────────────────────────────────────────────────────────
// Structure: Switch > SwitchThumb

export interface SwitchOptions {
  parentId?: InstanceId;
  id?: string;
  checked?: boolean;
  name?: string;
}

export interface SwitchResult {
  switchId: InstanceId;
  thumbId: InstanceId;
}

export function addSwitch(b: FragmentBuilder, options: SwitchOptions = {}): SwitchResult {
  const p = options.id ?? newId();

  const switchId = b.addInstance("Switch", { id: `${p}-switch`, parentId: options.parentId });
  if (options.checked !== undefined) b.addProp(switchId, "checked", "boolean", options.checked);
  if (options.name) b.addProp(switchId, "name", "string", options.name);

  const thumbId = b.addInstance("SwitchThumb", { id: `${p}-thumb`, parentId: switchId });

  return { switchId, thumbId };
}

// ─── Checkbox ─────────────────────────────────────────────────────────────────
// Structure: Label > [Checkbox > CheckboxIndicator > HtmlEmbed(svg)] + Text

export interface CheckboxOptions {
  parentId?: InstanceId;
  id?: string;
  labelText?: string;
  checked?: boolean;
}

export interface CheckboxResult {
  labelId: InstanceId;
  checkboxId: InstanceId;
  indicatorId: InstanceId;
}

export function addCheckbox(b: FragmentBuilder, options: CheckboxOptions = {}): CheckboxResult {
  const p = options.id ?? newId();

  const labelId = b.addInstance("Label", { id: `${p}-label`, parentId: options.parentId });

  const checkboxId = b.addInstance("Checkbox", { id: `${p}-checkbox`, parentId: labelId });
  if (options.checked !== undefined) b.addProp(checkboxId, "checked", "boolean", options.checked);

  const indicatorId = b.addInstance("CheckboxIndicator", { id: `${p}-indicator`, parentId: checkboxId });
  // SVG checkmark — single <path> only (HtmlEmbed rule: multi-element SVGs are silently dropped)
  const svgId = b.addInstance("HtmlEmbed", { id: `${p}-icon`, parentId: indicatorId });
  b.addProp(svgId, "code", "string",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l5 5L19 7"/></svg>`
  );

  if (options.labelText) {
    const textId = b.addInstance("Text", { id: `${p}-text`, parentId: labelId });
    b.addText(textId, options.labelText);
  }

  return { labelId, checkboxId, indicatorId };
}
