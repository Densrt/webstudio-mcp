// Tool: webstudio_apply_token — apply a design token to instances
// and (optionally) remove now-redundant local style declarations covered by the token.
//
// Use case: migrate from per-instance local styles to shared tokens.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";
import { analyzeCoverage, buildCleanupPatches, summarizeCoverage } from "../lib/token-coverage.js";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const applyTokenToInstancesInputSchema = z.object({
  projectSlug: z.string(),
  /** Identify the token by name (case-sensitive exact match) OR by id. */
  tokenName: z.string().optional(),
  tokenId: z.string().optional(),
  /** Instances to receive the token. */
  instanceIds: z.array(z.string()).min(1),
  /** Cleanup behavior for local decls already covered by the token.
   *  - "none"        : do nothing (legacy default kept for safety on pre-existing scripts)
   *  - "auto-dedupe" : remove local decls whose VALUE matches the token (zero visual change). RECOMMENDED.
   *  - "auto-force"  : remove ALL local decls whose property is covered (token wins, may change visuals)
   *  - "manual"      : use removeLocalProps + breakpoint (legacy mode)
   */
  coveredPropsCleanup: z.enum(["none", "auto-dedupe", "auto-force", "manual"]).default("auto-dedupe"),
  /** [manual mode only] explicit list of CSS properties to remove. */
  removeLocalProps: z.array(z.string()).default([]),
  /** [manual mode only] breakpoint label/id whose decls to clean (default "Base"). */
  breakpoint: z.string().default("Base"),
  /** Position of the token in the styleSourceSelections.values list. */
  position: z.enum(["before-local", "after-local"]).default("before-local"),
  dryRun: z.boolean().default(true),
}).strict().refine((d) => !!d.tokenName || !!d.tokenId, {
  message: "Provide tokenName or tokenId",
});

function buildChanges(
  build: WebstudioBuild,
  args: z.infer<typeof applyTokenToInstancesInputSchema>,
): { selections: BuildPatchOperation[]; styles: BuildPatchOperation[]; details: string[]; tokenIdResolved: string } {
  const tokenId = args.tokenId
    ?? build.styleSources.find((s) => s.type === "token" && s.name === args.tokenName)?.id;
  if (!tokenId) throw new Error(`Token not found: ${args.tokenName ?? args.tokenId}`);

  // For manual mode we need a specific breakpoint
  let manualBpId: string | undefined;
  if (args.coveredPropsCleanup === "manual") {
    const bp = build.breakpoints.find((b) => b.label === args.breakpoint || b.id === args.breakpoint);
    if (!bp) throw new Error(`Breakpoint not found: ${args.breakpoint}`);
    manualBpId = bp.id;
  }

  const selectionPatches: BuildPatchOperation[] = [];
  const stylePatches: BuildPatchOperation[] = [];
  const details: string[] = [];

  for (const id of args.instanceIds) {
    const sel = build.styleSourceSelections.find((s) => s.instanceId === id);
    if (!sel) {
      selectionPatches.push({
        op: "add",
        path: [id],
        value: { instanceId: id, values: [tokenId] },
      });
      details.push(`+ ${id}: created selection with token`);
      continue;
    }
    const alreadyApplied = sel.values.includes(tokenId);
    if (!alreadyApplied) {
      const newValues = args.position === "before-local"
        ? [tokenId, ...sel.values]
        : [...sel.values, tokenId];
      selectionPatches.push({
        op: "replace",
        path: [id],
        value: { instanceId: id, values: newValues },
      });
    }

    // Compute & apply cleanup (works whether token was already applied or just added)
    const report = analyzeCoverage(build, tokenId, id);
    const manualProps = args.coveredPropsCleanup === "manual"
      ? { props: new Set(args.removeLocalProps), breakpointId: manualBpId }
      : undefined;
    const cleanupPatches = buildCleanupPatches(report, args.coveredPropsCleanup, manualProps);
    stylePatches.push(...cleanupPatches);

    const status = alreadyApplied ? "= already applied" : "✓ token applied";
    const cleanupSuffix = cleanupPatches.length
      ? ` + ${cleanupPatches.length} local decl(s) removed (${summarizeCoverage(report)})`
      : (report.dupes.length || report.overrides.length)
        ? ` (coverage: ${summarizeCoverage(report)} — kept by mode "${args.coveredPropsCleanup}")`
        : "";
    details.push(`${status} ${id}${cleanupSuffix}`);
  }

  return { selections: selectionPatches, styles: stylePatches, details, tokenIdResolved: tokenId };
}

export const applyTokenToInstancesTool: ToolModule = {
  definition: {
    name: "webstudio_apply_token",
    description: `Use when: apply an EXISTING token to N instances and (optionally) clean redundant local decls covered by it.
Do NOT use when: creating a NEW token from N instances' shared overrides (use webstudio_extract_token or webstudio_extract_variant_token), removing a token from instances (use webstudio_detach_token), cleaning duplicates AFTER apply (use webstudio_dedupe_token_locals — same engine, post-hoc sweep).
Returns: dry-run with selection patches + style remove counts and per-instance status ("token applied", "already applied", "X local decl(s) removed"), or push result.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

coveredPropsCleanup modes: "auto-dedupe" (default, removes locals strictly identical to token = zero visual change), "auto-force" (removes overrides too, token wins, may change visuals), "manual" (use removeLocalProps + breakpoint), "none". position="before-local" → token applies first, locals override.

Example: { projectSlug: "acme", tokenName: "Color Primary", instanceIds: ["a","b","c"], coveredPropsCleanup: "auto-dedupe", dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        tokenName: { type: "string" },
        tokenId: { type: "string" },
        instanceIds: { type: "array", items: { type: "string" } },
        coveredPropsCleanup: { type: "string", enum: ["none", "auto-dedupe", "auto-force", "manual"] },
        removeLocalProps: { type: "array", items: { type: "string" } },
        breakpoint: { type: "string" },
        position: { type: "string", enum: ["before-local", "after-local"] },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "instanceIds"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = applyTokenToInstancesInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let r;
    try { r = buildChanges(build, data); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Token not found")) return errorResult("TOKEN_NOT_FOUND", msg);
      if (msg.startsWith("Breakpoint not found")) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const summary = `Token "${data.tokenName ?? r.tokenIdResolved}" applied (mode: ${data.coveredPropsCleanup}):
  Selection patches : ${r.selections.length}
  Style remove      : ${r.styles.length}

Details:
${r.details.join("\n")}`;

    if (data.dryRun) return textResult(`DRY-RUN apply_token_to_instances\n\n${summary}\n\nIf OK, re-run with dryRun=false.`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildChanges(cur, data);
        const payload = [];
        if (re.selections.length) payload.push({ namespace: "styleSourceSelections" as const, patches: re.selections });
        if (re.styles.length) payload.push({ namespace: "styles" as const, patches: re.styles });
        return { id: `mcp-apply-token-${txId()}`, payload };
      });
      return textResult(`Token applied — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Apply failed");
    }
  },
};
