// Diff local style decls across N instances, isolate the common subset, and
// build the styleSource + style + selection patches that materialize the
// extracted token.

import { customAlphabet } from "nanoid";
import type { WebstudioBuild, BuildPatchOperation, BuildPatchChange } from "../../webstudio-client.js";
import type { StyleDecl } from "../../types.js";

const newId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

type StyleKey = string; // property + state
function declKey(d: { property: string; state?: string }): StyleKey { return `${d.property}::${d.state ?? ""}`; }

function getLocalDecls(build: WebstudioBuild, instanceId: string, breakpointId: string): StyleDecl[] {
  const sel = build.styleSourceSelections.find((s) => s.instanceId === instanceId);
  if (!sel) return [];
  const localId = sel.values.find((v) => {
    const ss = build.styleSources.find((s) => s.id === v);
    return ss?.type === "local";
  });
  if (!localId) return [];
  return build.styles.filter((s) => s.styleSourceId === localId && s.breakpointId === breakpointId);
}

export type ExtractTokenInput = {
  instanceIds: string[];
  tokenName: string;
  breakpoint: string;
  applyAndCleanup: boolean;
};

export type ExtractTokenResult = {
  commonDecls: StyleDecl[];
  divergentKeys: string[];
  details: string[];
  changes: BuildPatchChange[];
  tokenIdResolved: string;
  isNewToken: boolean;
};

export function buildExtractTokenChanges(build: WebstudioBuild, args: ExtractTokenInput): ExtractTokenResult {
  const bp = build.breakpoints.find((b) => b.label === args.breakpoint || b.id === args.breakpoint);
  if (!bp) throw new Error(`Breakpoint not found: ${args.breakpoint}`);

  const perInstance = new Map<string, Map<StyleKey, StyleDecl>>();
  for (const id of args.instanceIds) {
    const decls = getLocalDecls(build, id, bp.id);
    const m = new Map<StyleKey, StyleDecl>();
    for (const d of decls) m.set(declKey(d), d);
    perInstance.set(id, m);
  }

  // Find common keys: present in every instance with identical value.
  const firstId = args.instanceIds[0];
  const firstMap = perInstance.get(firstId)!;
  const commonDecls: StyleDecl[] = [];
  const divergentKeys: string[] = [];
  for (const [k, decl] of firstMap) {
    let common = true;
    for (const id of args.instanceIds.slice(1)) {
      const otherMap = perInstance.get(id);
      const other = otherMap?.get(k);
      if (!other || JSON.stringify(other.value) !== JSON.stringify(decl.value)) {
        common = false;
        break;
      }
    }
    if (common) commonDecls.push(decl);
    else divergentKeys.push(k);
  }

  // Keys present in others but not in first (diagnostic only).
  const otherInstanceKeys = new Set<string>();
  for (const id of args.instanceIds.slice(1)) {
    for (const k of perInstance.get(id)!.keys()) otherInstanceKeys.add(k);
  }
  for (const k of otherInstanceKeys) {
    if (!firstMap.has(k) && !divergentKeys.includes(k)) divergentKeys.push(k);
  }

  if (commonDecls.length === 0) {
    return {
      commonDecls: [],
      divergentKeys,
      details: [`No common decls found across ${args.instanceIds.length} instances at @${args.breakpoint}.`],
      changes: [],
      tokenIdResolved: "",
      isNewToken: false,
    };
  }

  const existingToken = build.styleSources.find((s) => s.type === "token" && s.name === args.tokenName);
  const isNewToken = !existingToken;
  const tokenId = existingToken?.id ?? newId();

  const styleSourcePatches: BuildPatchOperation[] = [];
  const stylePatches: BuildPatchOperation[] = [];
  const selectionPatches: BuildPatchOperation[] = [];

  if (isNewToken) {
    styleSourcePatches.push({ op: "add", path: [tokenId], value: { id: tokenId, type: "token", name: args.tokenName } });
  }

  for (const d of commonDecls) {
    const newDecl: StyleDecl = { ...d, styleSourceId: tokenId };
    const k = `${tokenId}:${bp.id}:${d.property}:${d.state ?? ""}`;
    const exists = build.styles.some((s) =>
      s.styleSourceId === tokenId && s.breakpointId === bp.id && s.property === d.property && (s.state ?? "") === (d.state ?? ""),
    );
    stylePatches.push({ op: exists ? "replace" : "add", path: [k], value: newDecl });
  }

  const details: string[] = [
    `Token "${args.tokenName}" ${isNewToken ? "CREATED" : "UPDATED"} (id ${tokenId})`,
    `${commonDecls.length} common decl(s) extracted across ${args.instanceIds.length} instances`,
    divergentKeys.length > 0
      ? `${divergentKeys.length} divergent prop(s) kept on locals: ${divergentKeys.slice(0, 8).join(", ")}${divergentKeys.length > 8 ? "..." : ""}`
      : "All common — no divergent properties",
  ];

  if (args.applyAndCleanup) {
    for (const id of args.instanceIds) {
      const sel = build.styleSourceSelections.find((s) => s.instanceId === id);
      const localId = sel?.values.find((v) => build.styleSources.find((ss) => ss.id === v)?.type === "local");
      if (sel && !sel.values.includes(tokenId)) {
        const newValues = [tokenId, ...sel.values];
        selectionPatches.push({ op: "replace", path: [id], value: { instanceId: id, values: newValues } });
      } else if (!sel) {
        selectionPatches.push({ op: "add", path: [id], value: { instanceId: id, values: [tokenId] } });
      }
      if (localId) {
        const propsCovered = new Set(commonDecls.map((d) => declKey(d)));
        const localDecls = build.styles.filter((s) => s.styleSourceId === localId && s.breakpointId === bp.id);
        for (const d of localDecls) {
          if (propsCovered.has(declKey(d))) {
            const k = `${d.styleSourceId}:${d.breakpointId}:${d.property}:${d.state ?? ""}`;
            stylePatches.push({ op: "remove", path: [k] });
          }
        }
      }
    }
    details.push(`Applied to ${args.instanceIds.length} instance(s) + local decls covered by the token cleaned up`);
  }

  const changes: BuildPatchChange[] = [];
  if (styleSourcePatches.length) changes.push({ namespace: "styleSources", patches: styleSourcePatches });
  if (stylePatches.length) changes.push({ namespace: "styles", patches: stylePatches });
  if (selectionPatches.length) changes.push({ namespace: "styleSourceSelections", patches: selectionPatches });

  return { commonDecls, divergentKeys, details, changes, tokenIdResolved: tokenId, isNewToken };
}
