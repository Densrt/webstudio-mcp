// Compute the styleSource + style + selection patches for
// webstudio_extract_variant_token. Handles both explicit and "auto-detect
// unanimous shared local decls" override modes.

import { customAlphabet } from "nanoid";
import type { WebstudioBuild, BuildPatchOperation } from "../../webstudio-client.js";

const stableId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

type Style = WebstudioBuild["styles"][number];

export type ExtractVariantInput = {
  sourceTokenName?: string;
  sourceTokenId?: string;
  instanceIds: string[];
  newTokenName: string;
  overrides?: Record<string, unknown>;
  breakpoint: string;
  state: string;
};

export type ExtractVariantResult = {
  sourceTokenName: string;
  sourceTokenId: string;
  newTokenId: string;
  newTokenName: string;
  extracted: Array<{ property: string; value: unknown; state: string }>;
  targetCount: number;
  styleSourcePatches: BuildPatchOperation[];
  stylePatches: BuildPatchOperation[];
  selectionPatches: BuildPatchOperation[];
};

function autoDetectOverrides(
  build: WebstudioBuild,
  args: ExtractVariantInput,
  bp: { id: string },
  sourceTokenId: string,
  localDeclsByInstance: Map<string, Style[]>,
): Array<{ property: string; value: unknown; state: string }> {
  const sourceTokenDeclsByKey = new Map<string, Style>();
  for (const s of build.styles) {
    if (s.styleSourceId === sourceTokenId) {
      sourceTokenDeclsByKey.set(`${s.breakpointId}:${s.property}:${s.state ?? ""}`, s);
    }
  }

  if (args.instanceIds.length === 0) throw new Error("No target instances");
  const propAgreement = new Map<string, { value: unknown; count: number }>();
  for (const iid of args.instanceIds) {
    const decls = localDeclsByInstance.get(iid) ?? [];
    for (const d of decls) {
      const key = d.property;
      const existing = propAgreement.get(key);
      if (!existing) {
        propAgreement.set(key, { value: d.value, count: 1 });
      } else if (JSON.stringify(existing.value) === JSON.stringify(d.value)) {
        existing.count += 1;
      } else {
        // Conflict between instances → drop this property
        propAgreement.set(key, { value: null, count: -1 });
      }
    }
  }
  const extracted: Array<{ property: string; value: unknown; state: string }> = [];
  for (const [property, info] of propAgreement.entries()) {
    if (info.count !== args.instanceIds.length) continue; // not unanimous
    const sourceDecl = sourceTokenDeclsByKey.get(`${bp.id}:${property}:${args.state}`);
    if (sourceDecl && JSON.stringify(sourceDecl.value) === JSON.stringify(info.value)) continue;
    extracted.push({ property, value: info.value, state: args.state });
  }
  if (extracted.length === 0) {
    throw new Error(
      `Auto-detect found no shared overrides across the ${args.instanceIds.length} instance(s) on breakpoint "${args.breakpoint}" state "${args.state}". Pass overrides explicitly or pick instances that share the same overrides.`,
    );
  }
  return extracted;
}

export function buildExtractVariantChanges(
  build: WebstudioBuild,
  args: ExtractVariantInput,
): ExtractVariantResult {
  const sourceTokenId = args.sourceTokenId
    ?? build.styleSources.find((s) => s.type === "token" && s.name === args.sourceTokenName)?.id;
  if (!sourceTokenId) throw new Error(`Source token not found: ${args.sourceTokenName ?? args.sourceTokenId}`);
  const sourceToken = build.styleSources.find((s) => s.id === sourceTokenId);
  if (sourceToken?.type !== "token") throw new Error(`Source style source is not a token: ${sourceTokenId}`);

  if (build.styleSources.some((s) => s.type === "token" && s.name === args.newTokenName)) {
    throw new Error(`Token "${args.newTokenName}" already exists. Pick a different newTokenName.`);
  }

  const bp = build.breakpoints.find((b) => b.label === args.breakpoint || b.id === args.breakpoint);
  if (!bp) throw new Error(`Breakpoint not found: ${args.breakpoint}`);

  // 1) Verify each target instance currently uses the source token.
  for (const iid of args.instanceIds) {
    const sel = build.styleSourceSelections.find((s) => s.instanceId === iid);
    if (!sel || !sel.values.includes(sourceTokenId)) {
      throw new Error(`Instance ${iid} does not use source token "${sourceToken.name}"`);
    }
  }

  // 2) Gather each instance's local decls at the target (bp,state).
  const localDeclsByInstance = new Map<string, Style[]>();
  const localIdByInstance = new Map<string, string>();
  for (const iid of args.instanceIds) {
    const sel = build.styleSourceSelections.find((s) => s.instanceId === iid)!;
    const localId = sel.values.find((v) => build.styleSources.find((s) => s.id === v)?.type === "local");
    if (localId) localIdByInstance.set(iid, localId);
    const decls = build.styles.filter(
      (s) => s.styleSourceId === localId && s.breakpointId === bp.id && (s.state ?? "") === args.state,
    );
    localDeclsByInstance.set(iid, decls);
  }

  // 3) Resolve the override set.
  let extracted: Array<{ property: string; value: unknown; state: string }> = [];
  if (args.overrides) {
    for (const [property, value] of Object.entries(args.overrides)) {
      extracted.push({ property, value, state: args.state });
    }
  } else {
    extracted = autoDetectOverrides(build, args, bp, sourceTokenId, localDeclsByInstance);
  }

  // 4) Create the new token + clone source decls + apply overrides.
  const newTokenId = `tok_${args.newTokenName.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20)}_${stableId().slice(0, 8)}`;
  const styleSourcePatches: BuildPatchOperation[] = [
    { op: "add", path: [newTokenId], value: { type: "token", id: newTokenId, name: args.newTokenName } },
  ];

  const stylePatches: BuildPatchOperation[] = [];
  for (const d of build.styles) {
    if (d.styleSourceId !== sourceTokenId) continue;
    const cloned = { ...d, styleSourceId: newTokenId };
    const override = extracted.find(
      (o) => d.breakpointId === bp.id && d.property === o.property && (d.state ?? "") === o.state,
    );
    if (override) cloned.value = override.value as Style["value"];
    const k = `${cloned.styleSourceId}:${cloned.breakpointId}:${cloned.property}:${cloned.state ?? ""}`;
    stylePatches.push({ op: "add", path: [k], value: cloned });
  }
  // Add overrides not present in source token.
  for (const o of extracted) {
    const present = build.styles.some(
      (d) => d.styleSourceId === sourceTokenId && d.property === o.property && d.breakpointId === bp.id && (d.state ?? "") === o.state,
    );
    if (present) continue;
    const newDecl = {
      breakpointId: bp.id,
      property: o.property,
      state: o.state || undefined,
      styleSourceId: newTokenId,
      value: o.value as Style["value"],
      listed: false,
    };
    const k = `${newTokenId}:${bp.id}:${o.property}:${o.state || ""}`;
    stylePatches.push({ op: "add", path: [k], value: newDecl });
  }

  // 5) Swap sourceToken → newToken in each instance's selection.
  const selectionPatches: BuildPatchOperation[] = [];
  for (const iid of args.instanceIds) {
    const sel = build.styleSourceSelections.find((s) => s.instanceId === iid)!;
    const newValues = sel.values.map((v) => (v === sourceTokenId ? newTokenId : v));
    selectionPatches.push({ op: "replace", path: [iid], value: { instanceId: iid, values: newValues } });
  }

  // 6) Remove local decls covered by the new token (only the override props).
  const overrideProps = new Set(extracted.map((o) => `${o.property}:${o.state}`));
  for (const iid of args.instanceIds) {
    const localId = localIdByInstance.get(iid);
    if (!localId) continue;
    const decls = build.styles.filter((s) => s.styleSourceId === localId && s.breakpointId === bp.id);
    for (const d of decls) {
      if (!overrideProps.has(`${d.property}:${d.state ?? ""}`)) continue;
      const k = `${d.styleSourceId}:${d.breakpointId}:${d.property}:${d.state ?? ""}`;
      stylePatches.push({ op: "remove", path: [k] });
    }
  }

  return {
    sourceTokenName: sourceToken.name!,
    sourceTokenId,
    newTokenId,
    newTokenName: args.newTokenName,
    extracted,
    targetCount: args.instanceIds.length,
    styleSourcePatches,
    stylePatches,
    selectionPatches,
  };
}
