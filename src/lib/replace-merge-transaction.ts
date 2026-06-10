// Idempotent replace-merge transaction engine (extracted v2.13.1 — was
// copy-pasted in create-popup.ts / create-sheet.ts, audit 2026-06-10).
//
// Builds ONE atomic transaction that pushes a fragment under `parentInstanceId`
// and, when previous pushes left siblings whose label matches `replaceLabels`,
// removes those old subtrees in the SAME transaction. Patch ordering is
// load-bearing: the parent-children patch must run BEFORE the per-instance
// removals (unshift), and cleanup patches must precede the fragment's patches
// within each shared namespace — otherwise the old tree leaks orphans.

import type { WebstudioBuild, BuildPatchChange, BuildPatchTransaction } from "../webstudio-client.js";
import type { WebstudioFragment } from "../types.js";
import { fragmentToTransaction } from "../fragment-to-patches.js";
import { buildInstanceRemovalChanges, buildParentChildrenPatch } from "../cleanup-helpers.js";
import { findReplaceTargets } from "./find-replace-targets.js";

export function buildReplaceMergeTransaction(
  fragment: WebstudioFragment,
  cur: WebstudioBuild,
  parentInstanceId: string,
  replaceLabels: string[],
): BuildPatchTransaction {
  const baseTx = fragmentToTransaction(fragment, cur, { parentInstanceId });
  const targets = findReplaceTargets(cur, parentInstanceId, replaceLabels);
  if (targets.length === 0) return baseTx;
  const cleanupChanges = buildInstanceRemovalChanges(cur, targets);
  const instCleanup = cleanupChanges.find((c) => c.namespace === "instances");
  if (instCleanup) instCleanup.patches.unshift(buildParentChildrenPatch(cur, parentInstanceId, targets));
  const merged: BuildPatchChange[] = [];
  const seen = new Set<string>();
  for (const c of cleanupChanges) {
    const fragChange = baseTx.payload.find((bc) => bc.namespace === c.namespace);
    if (fragChange) merged.push({ namespace: c.namespace, patches: [...c.patches, ...fragChange.patches] });
    else merged.push(c);
    seen.add(c.namespace);
  }
  for (const bc of baseTx.payload) {
    if (!seen.has(bc.namespace)) merged.push(bc);
  }
  return { id: baseTx.id, payload: merged };
}
