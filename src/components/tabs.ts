// Radix Tabs helper.
// Structure: Tabs > [TabsList > TabsTrigger×N] + TabsContent×N

import { FragmentBuilder, newId } from "../builder.js";
import type { InstanceId } from "../types.js";

export interface TabsOptions {
  parentId?: InstanceId;
  id?: string;
  items: Array<{ label: string }>;
  defaultValue?: string;
}

export interface TabsResult {
  tabsId: InstanceId;
  listId: InstanceId;
  triggerIds: InstanceId[];
  contentIds: InstanceId[];
}

export function addTabs(b: FragmentBuilder, options: TabsOptions): TabsResult {
  const p = options.id ?? newId();
  const defaultValue = options.defaultValue ?? "0";

  const tabsId = b.addInstance("Tabs", { id: `${p}-tabs`, parentId: options.parentId });
  b.addProp(tabsId, "defaultValue", "string", defaultValue);

  const listId = b.addInstance("TabsList", { id: `${p}-list`, parentId: tabsId });

  const triggerIds: InstanceId[] = [];
  const contentIds: InstanceId[] = [];

  options.items.forEach((item, i) => {
    const value = String(i);

    const triggerId = b.addInstance("TabsTrigger", { id: `${p}-trigger-${i}`, parentId: listId });
    b.addProp(triggerId, "value", "string", value);
    b.addText(triggerId, item.label);
    triggerIds.push(triggerId);

    const contentId = b.addInstance("TabsContent", { id: `${p}-content-${i}`, parentId: tabsId });
    b.addProp(contentId, "value", "string", value);
    contentIds.push(contentId);
  });

  return { tabsId, listId, triggerIds, contentIds };
}
