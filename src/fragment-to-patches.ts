// Convert a WebstudioFragment into a BuildPatchTransaction ready to push.
// - Remap fragment breakpointIds to those of the target build (matching by label)
// - Generate one patch per container (Map-style: path = [id])
// - Insert the fragment's rootInstanceId into parentInstanceId.children

import type { WebstudioFragment, StyleDecl, Breakpoint } from "./types.js";
import type { WebstudioBuild, BuildPatchTransaction, BuildPatchChange, BuildPatchOperation } from "./webstudio-client.js";
import { newId } from "./builder.js";
import { normalizeStyleValue } from "./lib/style-normalize.js";

export interface FragmentPushOptions {
  /** Instance ID where the fragment will be inserted. */
  parentInstanceId: string;
  /** Position inside parent.children. Default = end (append). */
  insertIndex?: number;
}

/**
 * Turn a fragment into a Webstudio transaction ready to push.
 * The fragment must be a WebstudioFragment built via FragmentBuilder.
 */
export function fragmentToTransaction(
  fragment: WebstudioFragment,
  build: WebstudioBuild,
  options: FragmentPushOptions,
): BuildPatchTransaction {
  const payload = fragment["@webstudio/instance/v0.1"];

  // 1. Identify the fragment's rootInstanceIds (ALL top-level children).
  // Allows pushing multiple sibling trees (e.g. Dialog + HtmlEmbed CSS).
  const rootIds = payload.children
    .filter((c) => c.type === "id")
    .map((c) => c.value);
  if (rootIds.length === 0) {
    throw new Error("Fragment has no root instance — children must contain at least one {type:'id'}");
  }

  // 2. Remap fragment breakpoints to the build's breakpoints (by label).
  const bpRemap = remapBreakpoints(payload.breakpoints, build.breakpoints);

  // 3. Build patches per container.
  const changes: BuildPatchChange[] = [];

  // ─── instances ───────────────────────────────────────────────────────────────
  const instancePatches: BuildPatchOperation[] = payload.instances.map((inst) => ({
    op: "add",
    path: [inst.id],
    value: inst,
  }));

  // Patch on parent.children to insert each fragment root.
  // JSON Patch "add" inserts at the given index, shifting subsequent elements → indices N, N+1, N+2, ...
  const parent = build.instances.find((i) => i.id === options.parentInstanceId);
  if (!parent) {
    throw new Error(`Parent instance "${options.parentInstanceId}" not found in build`);
  }
  const insertIndex = options.insertIndex ?? parent.children.length;
  rootIds.forEach((rootId, i) => {
    instancePatches.push({
      op: "add",
      path: [options.parentInstanceId, "children", insertIndex + i],
      value: { type: "id", value: rootId },
    });
  });

  changes.push({ namespace: "instances", patches: instancePatches });

  // ─── props ──────────────────────────────────────────────────────────────────
  if (payload.props.length > 0) {
    changes.push({
      namespace: "props",
      patches: payload.props.map((p) => ({
        op: "add",
        path: [p.id],
        value: p,
      })),
    });
  }

  // ─── styleSources (skip those already present in the build with the same ID) ──
  const existingStyleSourceIds = new Set(build.styleSources.map((s) => s.id));
  const newStyleSources = payload.styleSources.filter((s) => !existingStyleSourceIds.has(s.id));
  if (newStyleSources.length > 0) {
    changes.push({
      namespace: "styleSources",
      patches: newStyleSources.map((s) => ({
        op: "add",
        path: [s.id],
        value: s,
      })),
    });
  }

  // ─── styleSourceSelections ──────────────────────────────────────────────────
  if (payload.styleSourceSelections.length > 0) {
    changes.push({
      namespace: "styleSourceSelections",
      patches: payload.styleSourceSelections.map((sel) => ({
        op: "add",
        path: [sel.instanceId],
        value: sel,
      })),
    });
  }

  // ─── styles (with breakpoint remapping) ─────────────────────────────────────
  if (payload.styles.length > 0) {
    changes.push({
      namespace: "styles",
      patches: payload.styles.map((style) => {
        const remapped: StyleDecl = {
          ...style,
          breakpointId: bpRemap[style.breakpointId] ?? style.breakpointId,
          // Normalize color values to the wire-format the server expects (see lib/style-normalize.ts).
          value: normalizeStyleValue(style.value),
        };
        return {
          op: "add",
          path: [styleKey(remapped)],
          value: remapped,
        };
      }),
    });
  }

  // ─── breakpoints (only the new, unmapped ones) ──────────────────────────────
  const remappedIds = new Set(Object.keys(bpRemap));
  const newBreakpoints = payload.breakpoints.filter((bp) => !remappedIds.has(bp.id));
  if (newBreakpoints.length > 0) {
    changes.push({
      namespace: "breakpoints",
      patches: newBreakpoints.map((bp) => ({
        op: "add",
        path: [bp.id],
        value: bp,
      })),
    });
  }

  // ─── dataSources (variables + parameters) ────────────────────────────────────
  // Pushed alongside instances so a ws:collection's `item` parameter (and any
  // bound variable) lands in the SAME transaction as the elements that
  // reference it — no orphaned ID windows. Format: { id, type, scopeInstanceId,
  // name, value? } — see packages/sdk/src/schema/data-sources.ts upstream.
  if (payload.dataSources.length > 0) {
    changes.push({
      namespace: "dataSources",
      patches: payload.dataSources.map((ds) => ({
        op: "add",
        path: [ds.id],
        value: ds,
      })),
    });
  }

  return {
    id: `mcp-${newId()}`,
    payload: changes,
  };
}

/**
 * Remap fragment breakpoint IDs to the target build's IDs when labels match.
 * Returns a { fragmentId → buildId } map for the matched breakpoints.
 */
function remapBreakpoints(
  fragmentBreakpoints: Breakpoint[],
  buildBreakpoints: Breakpoint[],
): Record<string, string> {
  const remap: Record<string, string> = {};
  for (const fragBp of fragmentBreakpoints) {
    const match = buildBreakpoints.find((b) => b.label === fragBp.label);
    if (match && match.id !== fragBp.id) {
      remap[fragBp.id] = match.id;
    }
  }
  return remap;
}

/**
 * Webstudio's Map key for a style: composite (styleSourceId + breakpointId + property + state).
 * Official format (cf. packages/sdk/src/schema/styles.ts:getStyleDeclKey):
 *   `<styleSourceId>:<breakpointId>:<property>:<state || ''>`
 * Property BEFORE state, not the other way around. The wrong order makes op:add still pass
 * (Webstudio re-keys via the value) but op:remove silently fails.
 */
function styleKey(style: StyleDecl): string {
  return `${style.styleSourceId}:${style.breakpointId}:${style.property}:${style.state ?? ""}`;
}
