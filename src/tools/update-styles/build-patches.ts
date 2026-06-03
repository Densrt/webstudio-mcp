// Build the styles + styleSources + selections patches for
// webstudio_styles. Tracks newly-minted locals within a transaction so
// the same instance referenced twice reuses the same local source.

import { customAlphabet } from "nanoid";
import type {
  WebstudioBuild,
  BuildPatchTransaction,
  BuildPatchOperation,
} from "../../webstudio-client.js";
import type { StyleDecl, StyleValue } from "../../types.js";
import { completeTransitionAnimationLonghands } from "../../lib/style-coerce.js";
import { normalizeStyleValue } from "../../lib/style-normalize.js";
import { isNonRenderingWrapper } from "../../lib/radix-wrappers.js";

const txId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);
const localId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

// Source of truth promoted to src/lib/radix-wrappers.ts so the same set is
// reused by webstudio_instance_prop, webstudio_push_fragment, and the
// audit kind radix-trigger-pollution.
// Note: TabsTrigger and NavigationMenuTrigger are NOT in the set — they
// render their own <button> and styles work directly. Previous versions
// of this list incorrectly included TabsTrigger.

export type StyleUpdate = {
  instanceId: string;
  property: string;
  value: StyleValue;
  breakpoint: string;
  state?: string;
  listed?: boolean;
  createLocalIfMissing: boolean;
  ignoreWrapperWarning: boolean;
};

function styleKey(s: { styleSourceId: string; breakpointId: string; property: string; state?: string }): string {
  return `${s.styleSourceId}:${s.breakpointId}:${s.property}:${s.state ?? ""}`;
}

export function buildUpdateStylesTransaction(
  build: WebstudioBuild,
  updates: StyleUpdate[],
): { transaction: BuildPatchTransaction; details: string[] } {
  const stylePatches: BuildPatchOperation[] = [];
  const styleSourcePatches: BuildPatchOperation[] = [];
  const selectionPatches: BuildPatchOperation[] = [];
  const details: string[] = [];

  // Track newly-created locals within this transaction (an instance referenced
  // twice in `updates` should reuse the same local rather than creating two).
  const newlyCreatedLocalByInstance = new Map<string, string>();
  const newSelectionsAccumulator = new Map<string, string[]>();

  for (const u of updates) {
    const inst = build.instances.find((i) => i.id === u.instanceId);
    if (!inst) {
      details.push(`! ${u.instanceId}: instance not found`);
      continue;
    }

    if (isNonRenderingWrapper(inst.component) && !u.ignoreWrapperWarning) {
      details.push(
        `⚠ ${u.instanceId} (${inst.component} "${inst.label ?? "(?)"}"): non-rendering wrapper — styles set here will likely not affect the rendered DOM. Target the inner child instead, or pass ignoreWrapperWarning=true to proceed.`,
      );
      continue;
    }

    const selection = build.styleSourceSelections.find((s) => s.instanceId === u.instanceId);
    let localSourceId = selection?.values.find((sourceId) => {
      const src = build.styleSources.find((s) => s.id === sourceId);
      return src?.type === "local";
    });

    if (!localSourceId) {
      const accumulated = newlyCreatedLocalByInstance.get(u.instanceId);
      if (accumulated) {
        localSourceId = accumulated;
      } else if (u.createLocalIfMissing) {
        const newId = localId();
        styleSourcePatches.push({ op: "add", path: [newId], value: { id: newId, type: "local" } });

        const existingValues = newSelectionsAccumulator.get(u.instanceId)
          ?? selection?.values
          ?? [];
        const newValues = [...existingValues, newId];
        newSelectionsAccumulator.set(u.instanceId, newValues);

        selectionPatches.push({
          op: selection ? "replace" : "add",
          path: [u.instanceId],
          value: { instanceId: u.instanceId, values: newValues },
        });

        newlyCreatedLocalByInstance.set(u.instanceId, newId);
        localSourceId = newId;
        details.push(`+ ${u.instanceId} (${inst.label ?? inst.component}): created local styleSource ${newId}`);
      } else {
        details.push(
          `! ${u.instanceId} (${inst.label ?? inst.component}): no local styleSource (only tokens or no styles). Pass createLocalIfMissing=true to create one.`,
        );
        continue;
      }
    }

    const bpQuery = u.breakpoint.toLowerCase();
    const bp = build.breakpoints.find((b) => b.label.toLowerCase() === bpQuery || b.id === u.breakpoint);
    if (!bp) {
      const available = build.breakpoints.map((b) => `"${b.label}"`).join(", ");
      details.push(`! ${u.instanceId}: breakpoint "${u.breakpoint}" not found (available: ${available})`);
      continue;
    }

    const newDecl: StyleDecl = {
      styleSourceId: localSourceId,
      breakpointId: bp.id,
      property: u.property,
      // Normalize color values to the wire-format the server expects (see lib/style-normalize.ts).
      value: normalizeStyleValue(u.value),
      ...(u.state && { state: u.state }),
      ...(u.listed && { listed: true }),
    };

    const key = styleKey(newDecl);
    const exists = build.styles.some((s) =>
      s.styleSourceId === newDecl.styleSourceId &&
      s.breakpointId === newDecl.breakpointId &&
      s.property === newDecl.property &&
      (s.state ?? "") === (newDecl.state ?? ""),
    );

    stylePatches.push({ op: exists ? "replace" : "add", path: [key], value: newDecl });
    details.push(`${exists ? "replace" : "add"} ${u.instanceId}.${u.property}${u.state ? `[${u.state}]` : ""} (${u.breakpoint})`);
  }

  // Post-pass: complete missing transition/animation longhands per (styleSource, breakpoint, state) cohort.
  // Without this, setting only `transitionProperty` + `transitionDuration` leaves the UI panel showing
  // "all 0s ease 0s" because TimingFunction/Delay/Behavior are absent at the same layer index.
  type Cohort = { styleSourceId: string; breakpointId: string; state?: string };
  const cohortKey = (c: Cohort) => `${c.styleSourceId}::${c.breakpointId}::${c.state ?? ""}`;
  const cohorts = new Map<string, Cohort>();
  for (const p of stylePatches) {
    const decl = p.value as StyleDecl;
    cohorts.set(cohortKey(decl), { styleSourceId: decl.styleSourceId, breakpointId: decl.breakpointId, state: decl.state });
  }
  for (const cohort of cohorts.values()) {
    const incoming = stylePatches
      .map((p) => p.value as StyleDecl)
      .filter((d) =>
        d.styleSourceId === cohort.styleSourceId &&
        d.breakpointId === cohort.breakpointId &&
        (d.state ?? "") === (cohort.state ?? ""),
      )
      .map((d) => ({ property: d.property, value: d.value }));
    const existing = build.styles
      .filter((s) =>
        s.styleSourceId === cohort.styleSourceId &&
        s.breakpointId === cohort.breakpointId &&
        (s.state ?? "") === (cohort.state ?? ""),
      )
      .map((s) => ({ property: s.property, value: s.value as StyleValue }));
    const completed = completeTransitionAnimationLonghands(existing, incoming);
    const incomingProps = new Set(incoming.map((d) => d.property));
    for (const c of completed) {
      if (incomingProps.has(c.property)) continue; // already in stylePatches
      const newDecl: StyleDecl = {
        styleSourceId: cohort.styleSourceId,
        breakpointId: cohort.breakpointId,
        property: c.property,
        value: c.value,
        ...(cohort.state && { state: cohort.state }),
      };
      const exists = build.styles.some((s) =>
        s.styleSourceId === newDecl.styleSourceId &&
        s.breakpointId === newDecl.breakpointId &&
        s.property === newDecl.property &&
        (s.state ?? "") === (newDecl.state ?? ""),
      );
      stylePatches.push({ op: exists ? "replace" : "add", path: [styleKey(newDecl)], value: newDecl });
      details.push(`${exists ? "replace" : "add"} ${cohort.styleSourceId}.${c.property}${cohort.state ? `[${cohort.state}]` : ""} (auto-completed)`);
    }
  }

  const payload = [];
  if (styleSourcePatches.length > 0) payload.push({ namespace: "styleSources" as const, patches: styleSourcePatches });
  if (selectionPatches.length > 0) payload.push({ namespace: "styleSourceSelections" as const, patches: selectionPatches });
  if (stylePatches.length > 0) payload.push({ namespace: "styles" as const, patches: stylePatches });

  return {
    transaction: { id: `mcp-update-styles-${txId()}`, payload },
    details,
  };
}
