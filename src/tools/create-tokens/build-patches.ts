// Plan + render logic for webstudio_create_tokens.
// Kept separate so the tool entry-point stays under 150 lines.

import type {
  WebstudioBuild,
  BuildPatchOperation,
} from "../../webstudio-client.js";
import type { StyleValue } from "../../types.js";
import {
  buildTokenPatches,
  collectKnownCssVars,
  findMissingVarRefs,
} from "../create-token/shared.js";

export type TokenInput = { name: string; styles: Record<string, StyleValue> };

export type PlanArgs = {
  tokens: TokenInput[];
  breakpoint: string;
  overwrite: boolean;
  continueOnError: boolean;
  strict: boolean;
};

export type Succeeded = {
  name: string;
  tokenId: string;
  isNew: boolean;
  addedDecls: number;
  skippedDecls: number;
};
export type Failed = { name: string; reason: string };
export type Skipped = { name: string; reason: string };

export type Plan = {
  styleSourcePatches: BuildPatchOperation[];
  stylePatches: BuildPatchOperation[];
  succeeded: Succeeded[];
  failed: Failed[];
  skipped: Skipped[];
  abort?: { code: "VALIDATION_FAILED" | "INTERNAL_ERROR"; message: string };
};

export function planCreateTokens(build: WebstudioBuild, args: PlanArgs): Plan {
  const styleSourcePatches: BuildPatchOperation[] = [];
  const stylePatches: BuildPatchOperation[] = [];
  const succeeded: Succeeded[] = [];
  const failed: Failed[] = [];
  const skipped: Skipped[] = [];

  const bp = build.breakpoints.find(
    (b) => b.label.toLowerCase() === args.breakpoint.toLowerCase() || b.id === args.breakpoint,
  );
  if (!bp) {
    const available = build.breakpoints.map((b) => `"${b.label}"`).join(", ");
    return {
      styleSourcePatches,
      stylePatches,
      succeeded,
      failed,
      skipped,
      abort: {
        code: "VALIDATION_FAILED",
        message: `Breakpoint "${args.breakpoint}" not found (available: ${available})`,
      },
    };
  }

  const knownVars = collectKnownCssVars(build);
  const namesInBatch = new Set<string>();

  for (const t of args.tokens) {
    if (!t.name || t.name.trim() === "") {
      failed.push({ name: t.name, reason: "empty name" });
      continue;
    }
    if (Object.keys(t.styles).length === 0) {
      failed.push({ name: t.name, reason: "styles must contain at least one property" });
      continue;
    }
    if (namesInBatch.has(t.name)) {
      failed.push({ name: t.name, reason: "duplicate name in batch (already processed earlier)" });
      continue;
    }

    const missing = findMissingVarRefs(t.styles, knownVars);
    if (missing.length > 0 && args.strict) {
      failed.push({
        name: t.name,
        reason: `strict=true and ${missing.length} undefined var ref(s): ${missing.map((m) => `--${m}`).join(", ")}`,
      });
      continue;
    }

    const res = buildTokenPatches(build, {
      name: t.name,
      styles: t.styles,
      breakpointId: bp.id,
      overwrite: args.overwrite,
    });

    if ("shorthandError" in res) {
      failed.push({ name: t.name, reason: `shorthand rejected: ${res.shorthandError}` });
      continue;
    }

    if ("conflict" in res) {
      const reason = `token already exists (id=${res.existingId}); pass overwrite=true to extend it`;
      if (args.continueOnError) skipped.push({ name: t.name, reason });
      else failed.push({ name: t.name, reason });
      continue;
    }

    if (res.styleSourcePatches.length === 0 && res.stylePatches.length === 0) {
      skipped.push({ name: t.name, reason: "all decls already set on existing token (no-op)" });
      continue;
    }

    namesInBatch.add(t.name);
    styleSourcePatches.push(...res.styleSourcePatches);
    stylePatches.push(...res.stylePatches);
    succeeded.push({
      name: t.name,
      tokenId: res.tokenId,
      isNew: res.isNew,
      addedDecls: res.addedDecls.length,
      skippedDecls: res.skippedDecls.length,
    });

    if (missing.length > 0) {
      skipped.push({
        name: t.name,
        reason: `(warning, token still created) undefined var refs: ${missing.map((m) => `--${m}`).join(", ")}`,
      });
    }
  }

  // continueOnError=false: if anything failed, drop ALL patches.
  if (!args.continueOnError && failed.length > 0) {
    return { styleSourcePatches: [], stylePatches: [], succeeded: [], failed, skipped };
  }

  return { styleSourcePatches, stylePatches, succeeded, failed, skipped };
}

export function renderReport(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`✅ Succeeded (${plan.succeeded.length})`);
  for (const s of plan.succeeded) {
    const tag = s.isNew ? "new" : "extended";
    const skip = s.skippedDecls > 0 ? `, ${s.skippedDecls} skipped` : "";
    lines.push(`  ✓ "${s.name}" [${tag}] id=${s.tokenId} (${s.addedDecls} decls${skip})`);
  }
  lines.push("");
  lines.push(`❌ Failed (${plan.failed.length})`);
  for (const f of plan.failed) lines.push(`  ✗ "${f.name}" — ${f.reason}`);
  lines.push("");
  lines.push(`⏭ Skipped (${plan.skipped.length})`);
  for (const s of plan.skipped) lines.push(`  • "${s.name}" — ${s.reason}`);
  return lines.join("\n");
}
