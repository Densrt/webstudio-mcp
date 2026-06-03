// Shared logic for detecting and cleaning local style declarations
// that are covered by a design token applied to the same instance.
//
// Used by:
//  - webstudio_apply_token (cleanup at apply time)
//  - webstudio_dedupe_token_locals (post-hoc cleanup)

import type { WebstudioBuild, BuildPatchOperation } from "../webstudio-client.js";
import { stateMatches } from "./state-whitelist.js";

export type CleanupMode = "none" | "manual" | "auto-dedupe" | "auto-force";

type Style = WebstudioBuild["styles"][number];

export interface CoverageReport {
  /** Local styleSource id (or null if instance has no local source). */
  localStyleSourceId: string | null;
  /** Local decls strictly identical to a token decl on the same prop+breakpoint+state. Safe to remove. */
  dupes: Style[];
  /** Local decls overriding a token decl (same prop+breakpoint+state, different value). Removing makes the token win. */
  overrides: Style[];
  /** Local decls on properties NOT covered by the token. Always preserved. */
  uniques: Style[];
}

/** Return the local style source id selected on this instance, or null. */
function findLocalSourceId(build: WebstudioBuild, instanceId: string): string | null {
  const sel = build.styleSourceSelections.find((s) => s.instanceId === instanceId);
  if (!sel) return null;
  for (const v of sel.values) {
    const ss = build.styleSources.find((s) => s.id === v);
    if (ss?.type === "local") return v;
  }
  return null;
}

/** Compute coverage of a token's decls vs an instance's local decls.
 *  Considers ALL breakpoints + states. */
export function analyzeCoverage(
  build: WebstudioBuild,
  tokenId: string,
  instanceId: string,
): CoverageReport {
  const localId = findLocalSourceId(build, instanceId);
  if (!localId) return { localStyleSourceId: null, dupes: [], overrides: [], uniques: [] };

  // Collect token decls (no key-indexing — we tolerate state corruption via stateMatches,
  // so we can't use a string-keyed map. Linear scan is fine at our scale: tokens have <100 decls.)
  const tokenDecls = build.styles.filter((d) => d.styleSourceId === tokenId);

  const dupes: Style[] = [];
  const overrides: Style[] = [];
  const uniques: Style[] = [];

  for (const d of build.styles) {
    if (d.styleSourceId !== localId) continue;
    const tokenDecl = tokenDecls.find(
      (t) =>
        t.breakpointId === d.breakpointId &&
        t.property === d.property &&
        stateMatches(t.state, d.state),
    );
    if (!tokenDecl) {
      uniques.push(d);
      continue;
    }
    if (JSON.stringify(tokenDecl.value) === JSON.stringify(d.value)) {
      dupes.push(d);
    } else {
      overrides.push(d);
    }
  }

  return { localStyleSourceId: localId, dupes, overrides, uniques };
}

/** Build remove patches for the styles that should be removed under the given cleanup mode. */
export function buildCleanupPatches(
  report: CoverageReport,
  mode: CleanupMode,
  manualProps?: { props: Set<string>; breakpointId?: string },
): BuildPatchOperation[] {
  const patches: BuildPatchOperation[] = [];
  let toRemove: Style[] = [];

  switch (mode) {
    case "none":
      return [];
    case "auto-dedupe":
      toRemove = report.dupes;
      break;
    case "auto-force":
      toRemove = [...report.dupes, ...report.overrides];
      break;
    case "manual":
      if (!manualProps) return [];
      toRemove = [...report.dupes, ...report.overrides, ...report.uniques].filter(
        (d) =>
          manualProps.props.has(d.property) &&
          (!manualProps.breakpointId || d.breakpointId === manualProps.breakpointId),
      );
      break;
  }

  for (const d of toRemove) {
    const key = `${d.styleSourceId}:${d.breakpointId}:${d.property}:${d.state ?? ""}`;
    patches.push({ op: "remove", path: [key] });
  }
  return patches;
}

/** Pretty-print a one-line summary of a coverage report. */
export function summarizeCoverage(report: CoverageReport): string {
  return `${report.dupes.length} dupes, ${report.overrides.length} overrides, ${report.uniques.length} uniques`;
}

/** Format a decl as a short readable label for logs. */
export function formatDecl(d: Style, breakpointLabels: Map<string, string>): string {
  const bp = breakpointLabels.get(d.breakpointId) ?? d.breakpointId;
  // `state` is stored WITH its leading colon (":hover", "::before") — concat as-is.
  const state = d.state ?? "";
  const v = d.value as { type?: string; value?: unknown; unit?: string };
  let valStr: string;
  if (v.type === "unit") valStr = `${String(v.value)}${v.unit ?? ""}`;
  else if (v.type === "var") valStr = `var(--${String(v.value)})`;
  else if (v.type === "keyword") valStr = String(v.value);
  else valStr = JSON.stringify(d.value).slice(0, 40);
  return `[${bp}] ${d.property}${state} = ${valStr}`;
}
