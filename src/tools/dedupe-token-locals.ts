// Tool: webstudio_dedupe_token_locals — post-hoc cleanup of local decls
// covered by a design token across all instances using that token.
//
// Use case: after a token was applied without cleanup (or after refactoring),
// scan every instance using the token and remove redundant local decls.
//
// Idempotent: safe to re-run.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";
import { analyzeCoverage, buildCleanupPatches, summarizeCoverage, formatDecl } from "../lib/token-coverage.js";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const dedupeTokenLocalsInputSchema = z.object({
  projectSlug: z.string(),
  /** Token to clean up (by name or id). If both omitted: all tokens (full project sweep). */
  tokenName: z.string().optional(),
  tokenId: z.string().optional(),
  /** Cleanup mode:
   *  - "auto-dedupe" (default): remove only locals strictly identical to the token. Zero visual change.
   *  - "auto-force"           : remove every local covered by the token (overrides too). May change visuals.
   */
  mode: z.enum(["auto-dedupe", "auto-force"]).default("auto-dedupe"),
  /** Restrict to a subset of instance ids (default: all instances using the token). */
  instanceIds: z.array(z.string()).optional(),
  /** Verbose detail (per-decl listing). Default: false (counts only). */
  verbose: z.boolean().default(false),
  dryRun: z.boolean().default(true),
}).strict();

interface PerTokenResult {
  tokenId: string;
  tokenName: string;
  instances: number;
  totalRemoved: number;
  details: string[];
  patches: BuildPatchOperation[];
}

function processToken(
  build: WebstudioBuild,
  tokenId: string,
  args: z.infer<typeof dedupeTokenLocalsInputSchema>,
  bpLabels: Map<string, string>,
): PerTokenResult {
  const tok = build.styleSources.find((s) => s.id === tokenId);
  const tokenName = (tok && tok.type === "token" ? tok.name : undefined) ?? tokenId;

  // All instances using this token
  let instanceIds = build.styleSourceSelections
    .filter((sel) => sel.values?.includes(tokenId))
    .map((sel) => sel.instanceId);
  if (args.instanceIds?.length) {
    const filter = new Set(args.instanceIds);
    instanceIds = instanceIds.filter((id) => filter.has(id));
  }

  const patches: BuildPatchOperation[] = [];
  const details: string[] = [];
  let totalRemoved = 0;
  let cleanCount = 0;

  for (const iid of instanceIds) {
    const report = analyzeCoverage(build, tokenId, iid);
    const inst = build.instances.find((i) => i.id === iid);
    const label = inst?.label ?? "";
    const cleanup = buildCleanupPatches(report, args.mode);
    if (cleanup.length === 0) {
      cleanCount++;
      continue;
    }
    patches.push(...cleanup);
    totalRemoved += cleanup.length;
    const summary = summarizeCoverage(report);
    const head = `  ⚠ [${iid}] ${label} → ${cleanup.length} removed (${summary})`;
    details.push(head);
    if (args.verbose) {
      for (const d of report.dupes) details.push(`      🟢 dupe ${formatDecl(d, bpLabels)}`);
      if (args.mode === "auto-force") {
        for (const d of report.overrides) details.push(`      🟡 override removed ${formatDecl(d, bpLabels)}`);
      } else if (report.overrides.length) {
        details.push(`      (kept ${report.overrides.length} override(s) — switch to auto-force to remove)`);
      }
    }
  }

  if (cleanCount) details.unshift(`  ✓ ${cleanCount} clean instance(s)`);

  return { tokenId, tokenName, instances: instanceIds.length, totalRemoved, details, patches };
}

function buildChanges(build: WebstudioBuild, args: z.infer<typeof dedupeTokenLocalsInputSchema>) {
  const bpLabels = new Map(build.breakpoints.map((b) => [b.id, b.label]));
  let tokenIds: string[];

  if (args.tokenId || args.tokenName) {
    const tokenId = args.tokenId
      ?? build.styleSources.find((s) => s.type === "token" && s.name === args.tokenName)?.id;
    if (!tokenId) throw new Error(`Token not found: ${args.tokenName ?? args.tokenId}`);
    tokenIds = [tokenId];
  } else {
    tokenIds = build.styleSources.filter((s) => s.type === "token").map((s) => s.id);
  }

  const results: PerTokenResult[] = [];
  for (const tid of tokenIds) results.push(processToken(build, tid, args, bpLabels));
  return results;
}

export const dedupeTokenLocalsTool: ToolModule = {
  definition: {
    name: "webstudio_dedupe_token_locals",
    description: `Use when: POST-HOC sweep — after a token was applied without cleanup (or after refactor), scan instances using the token and remove redundant local decls.
Do NOT use when: applying a token + cleaning in one shot (use webstudio_apply_token with coveredPropsCleanup="auto-dedupe"), removing orphan styleSources detached from any instance (use webstudio_cleanup_orphan_locals), or removing a specific local decl (use webstudio_styles).
Returns: dry-run with per-token report (instances scanned, decls to remove, per-decl detail in verbose mode), or push result.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. Idempotent.

tokenName/tokenId selects ONE token; omit BOTH to sweep ALL project tokens (audit mode). mode="auto-dedupe" (default) removes only locals strictly identical to the token = zero visual change. mode="auto-force" removes overrides too (may change visuals).

Example: { projectSlug: "acme", tokenName: "Color Primary", mode: "auto-dedupe", dryRun: true }
Example: { projectSlug: "acme", mode: "auto-dedupe", verbose: true, dryRun: true }  // full project sweep`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        tokenName: { type: "string" },
        tokenId: { type: "string" },
        mode: { type: "string", enum: ["auto-dedupe", "auto-force"] },
        instanceIds: { type: "array", items: { type: "string" } },
        verbose: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug"],
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
    const parsed = dedupeTokenLocalsInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let results;
    try { results = buildChanges(build, data); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Token not found")) return errorResult("TOKEN_NOT_FOUND", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const totalPatches = results.reduce((a, r) => a + r.patches.length, 0);
    const tokensWithDirt = results.filter((r) => r.totalRemoved > 0);
    const lines: string[] = [];
    lines.push(`Mode: ${data.mode} | Tokens scanned: ${results.length} | Tokens with dupes: ${tokensWithDirt.length} | Total decls to remove: ${totalPatches}`);
    lines.push("");
    for (const r of results) {
      if (r.totalRemoved === 0 && !data.verbose) continue;
      lines.push(`## ${r.tokenName} [${r.tokenId}] — ${r.instances} instances, ${r.totalRemoved} decls to remove`);
      for (const d of r.details) lines.push(d);
      lines.push("");
    }

    const summary = lines.join("\n").trim() || "All clean — nothing to remove.";

    if (data.dryRun) return textResult(`DRY-RUN dedupe_token_locals\n\n${summary}\n\nIf OK, re-run with dryRun=false.`);

    if (totalPatches === 0) return textResult(`No-op (clean):\n\n${summary}`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildChanges(cur, data);
        const allPatches = re.flatMap((r) => r.patches);
        const payload = allPatches.length
          ? [{ namespace: "styles" as const, patches: allPatches }]
          : [];
        return { id: `mcp-dedupe-token-${txId()}`, payload };
      });
      return textResult(`Cleanup pushed — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Cleanup failed");
    }
  },
};
