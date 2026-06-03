// Shared types for the audit-orphans tool.

import { z } from "zod";

export const Category = z.enum([
  "variables",
  "resources",
  "assets",
  "styleSources",
  "tokens",
  "cssVars",
  "folders",
]);

export type CategoryT = z.infer<typeof Category>;

export const ALL_CATEGORIES: CategoryT[] = [
  "variables",
  "resources",
  "assets",
  "styleSources",
  "tokens",
  "cssVars",
  "folders",
];

export const CATEGORY_LABELS: Record<CategoryT, string> = {
  variables: "variables",
  resources: "resources",
  assets: "assets",
  styleSources: "local styleSources",
  tokens: "tokens",
  cssVars: "CSS vars",
  folders: "folders",
};

export type OrphanItem = { id: string; name: string; extra?: string };
export type CategoryResult = { total: number; orphans: OrphanItem[] };
