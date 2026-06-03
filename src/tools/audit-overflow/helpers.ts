// Small helpers shared by the overflow detector scanner.

import type { WebstudioBuild } from "../../webstudio-client.js";
import type { StyleEntry } from "./types.js";

export function isInPageScope(build: WebstudioBuild, rootInstanceId: string): Set<string> {
  const ids = new Set<string>();
  const visit = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    const inst = build.instances.find((i) => i.id === id);
    if (!inst) return;
    for (const c of inst.children ?? []) {
      if (c.type === "id") visit(c.value);
    }
  };
  visit(rootInstanceId);
  return ids;
}

export function instLabel(inst: { component: string; tag?: string; label?: string }): string {
  const compShort = inst.component.split(":").pop() || inst.component;
  const tagPart = inst.tag ? `<${inst.tag}>` : "";
  const labelPart = inst.label ? ` "${inst.label}"` : "";
  return `${compShort}${tagPart}${labelPart}`;
}

export function isInsecure(text: string): boolean {
  // Detect long unbreakable strings (emails, URLs, slugs, hyphenated paths)
  if (text.length < 20) return false;
  const longestUnbroken = text.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
  return longestUnbroken >= 20;
}

export function buildStylesByInstance(
  build: WebstudioBuild,
  scope: Set<string>,
): Map<string, StyleEntry[]> {
  const stylesByInstance = new Map<string, StyleEntry[]>();
  for (const sel of build.styleSourceSelections) {
    if (!scope.has(sel.instanceId)) continue;
    const arr = stylesByInstance.get(sel.instanceId) ?? [];
    for (const ssId of sel.values) {
      const styles = build.styles.filter((s) => s.styleSourceId === ssId);
      for (const s of styles) {
        arr.push({ property: s.property, value: s.value, bpId: s.breakpointId, state: s.state ?? "", ssId });
      }
    }
    stylesByInstance.set(sel.instanceId, arr);
  }
  return stylesByInstance;
}

export function hasMobileOverride(
  stylesByInstance: Map<string, StyleEntry[]>,
  bpById: Map<string, { label?: string }>,
  instId: string,
  property: string,
  targetBpLabel: string,
): boolean {
  const arr = stylesByInstance.get(instId) ?? [];
  return arr.some((s) => s.property === property && s.state === "" && bpById.get(s.bpId)?.label === targetBpLabel);
}

export function hasWrapStyle(
  stylesByInstance: Map<string, StyleEntry[]>,
  instId: string,
): boolean {
  const arr = stylesByInstance.get(instId) ?? [];
  for (const s of arr) {
    if (s.property === "overflowWrap" || s.property === "wordBreak" || s.property === "wordWrap") {
      return true;
    }
  }
  return false;
}
