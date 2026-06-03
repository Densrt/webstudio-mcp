// Shared helpers for audit-page detectors.

import type { WebstudioBuild } from "../../webstudio-client.js";

export function collectIds(rootId: string, build: WebstudioBuild): Set<string> {
  const ids = new Set<string>();
  const visit = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    const inst = build.instances.find((i) => i.id === id);
    if (!inst) return;
    for (const c of inst.children) if (c.type === "id") visit(c.value);
  };
  visit(rootId);
  return ids;
}

export function findVarsInValue(value: unknown, out: string[]): void {
  if (value === null || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (v.type === "var" && typeof v.value === "string") {
    out.push(v.value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) findVarsInValue(item, out);
    return;
  }
  for (const val of Object.values(v)) findVarsInValue(val, out);
}
