// Shared idempotent-replace helper (extracted v2.13.1 — was copy-pasted in
// push-complete.ts / create-popup.ts / create-sheet.ts, audit 2026-06-10).
//
// Finds the direct children of `parentId` whose label matches one of `labels`
// — the instances a re-push should replace instead of duplicating (idempotent
// section pushes). `componentMatch` optionally narrows by component name
// (exact, ":"-suffixed, or last segment of a namespaced component).

import type { WebstudioBuild } from "../webstudio-client.js";

export function findReplaceTargets(
  build: WebstudioBuild,
  parentId: string,
  labels: string[],
  componentMatch?: string,
): string[] {
  const parent = build.instances.find((i) => i.id === parentId);
  if (!parent) return [];
  const labelSet = new Set(labels);
  const found: string[] = [];
  for (const c of parent.children) {
    if (c.type !== "id") continue;
    const inst = build.instances.find((i) => i.id === c.value);
    if (!inst || !inst.label || !labelSet.has(inst.label)) continue;
    if (componentMatch) {
      const ok =
        inst.component === componentMatch ||
        inst.component.endsWith(`:${componentMatch}`) ||
        inst.component.split(":").pop() === componentMatch;
      if (!ok) continue;
    }
    found.push(inst.id);
  }
  return found;
}
