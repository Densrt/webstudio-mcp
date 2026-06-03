// Radix NavigationMenu helper (flat links).
// Structure: NavigationMenu > NavigationMenuList > NavigationMenuItem×N > NavigationMenuLink > Link

import { FragmentBuilder, newId } from "../builder.js";
import type { InstanceId } from "../types.js";

export interface NavItem {
  label: string;
  href: string;
  active?: boolean;
}

export interface NavigationMenuOptions {
  parentId?: InstanceId;
  id?: string;
  items: NavItem[];
}

export interface NavigationMenuResult {
  navId: InstanceId;
  listId: InstanceId;
  itemIds: InstanceId[];
}

export function addNavigationMenu(b: FragmentBuilder, options: NavigationMenuOptions): NavigationMenuResult {
  const p = options.id ?? newId();

  const navId = b.addInstance("NavigationMenu", { id: `${p}-nav`, parentId: options.parentId });
  const listId = b.addInstance("NavigationMenuList", { id: `${p}-list`, parentId: navId });

  const itemIds: InstanceId[] = [];
  options.items.forEach((item, i) => {
    const itemId = b.addInstance("NavigationMenuItem", { id: `${p}-item-${i}`, parentId: listId });
    const wrapperId = b.addInstance("NavigationMenuLink", { id: `${p}-link-w-${i}`, parentId: itemId });
    if (item.active) b.addProp(wrapperId, "active", "boolean", true);
    const linkId = b.addInstance("Link", { id: `${p}-link-${i}`, parentId: wrapperId });
    b.addProp(linkId, "href", "string", item.href);
    b.addText(linkId, item.label);
    itemIds.push(itemId);
  });

  return { navId, listId, itemIds };
}
