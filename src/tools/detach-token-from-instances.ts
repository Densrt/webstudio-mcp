// Tool: webstudio_detach_token — remove a token from N instances'
// styleSourceSelections without touching the token itself or any local styles.
//
// Counterpart to apply_token_to_instances. Use case: swap one token for another on
// specific instances (detach old → apply new), or clean up a token that was attached
// by mistake. The token still exists project-wide and remains available on other
// instances that use it.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation, BuildPatchTransaction } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const detachTokenFromInstancesInputSchema = z.object({
  projectSlug: z.string(),
  /** Identify the token by name (case-sensitive exact match) OR by id. */
  tokenName: z.string().optional(),
  tokenId: z.string().optional(),
  /** Instances to detach the token from. */
  instanceIds: z.array(z.string()).min(1),
  dryRun: z.boolean().default(true),
}).strict().refine((d) => !!d.tokenName || !!d.tokenId, {
  message: "Provide tokenName or tokenId",
});

type Args = z.infer<typeof detachTokenFromInstancesInputSchema>;

function buildDetachTransaction(
  build: WebstudioBuild,
  args: Args,
): { transaction: BuildPatchTransaction; details: string[]; matchedCount: number; tokenIdResolved: string } {
  const tokenId = args.tokenId
    ?? build.styleSources.find((s) => s.type === "token" && s.name === args.tokenName)?.id;
  if (!tokenId) throw new Error(`Token not found: ${args.tokenName ?? args.tokenId}`);

  // Safety: refuse to detach a non-token styleSource (e.g. a local) via this tool.
  const src = build.styleSources.find((s) => s.id === tokenId);
  if (src && src.type !== "token") {
    throw new Error(`Resolved styleSource "${tokenId}" is type "${src.type}", not "token". Refusing — use cleanup_orphan_locals or delete_local_style_decl for locals.`);
  }

  const selectionPatches: BuildPatchOperation[] = [];
  const details: string[] = [];
  let matchedCount = 0;

  for (const id of args.instanceIds) {
    const sel = build.styleSourceSelections.find((s) => s.instanceId === id);
    if (!sel) {
      details.push(`· ${id}: no styleSourceSelection — nothing to detach`);
      continue;
    }
    if (!sel.values.includes(tokenId)) {
      details.push(`· ${id}: token not attached — nothing to detach`);
      continue;
    }
    const newValues = sel.values.filter((v) => v !== tokenId);
    selectionPatches.push({
      op: "replace",
      path: [id],
      value: { instanceId: id, values: newValues },
    });
    matchedCount += 1;
    details.push(`- ${id}: detached token (selection now has ${newValues.length} source(s))`);
  }

  const payload = selectionPatches.length > 0
    ? [{ namespace: "styleSourceSelections" as const, patches: selectionPatches }]
    : [];

  return {
    transaction: { id: `mcp-detach-token-${txId()}`, payload },
    details,
    matchedCount,
    tokenIdResolved: tokenId,
  };
}

export const detachTokenFromInstancesTool: ToolModule = {
  definition: {
    name: "webstudio_detach_token",
    description: `Use when: REMOVE a token from specific instances' styleSourceSelections without deleting the token or affecting other instances. Counterpart to webstudio_apply_token.
Do NOT use when: deleting the token entirely (use webstudio_delete_token), migrating selections from token A to token B globally (use webstudio_replace_token — much faster for project-wide swaps), or removing a local style decl (use webstudio_styles).
Returns: dry-run report listing each detachment with the remaining source count, or push result.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. Idempotent (no-op if the token isn't attached). Local styles on instances are NOT touched. Refuses to operate on non-token styleSources (safety guard).

Common pattern: detach old token → apply_token_to_instances new token (= per-instance swap, while replace_token swaps project-wide).

Example: { projectSlug: "acme", tokenName: "Color Legacy", instanceIds: ["a","b"], dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        tokenName: { type: "string", description: "Token display name (exact match). Provide tokenName OR tokenId." },
        tokenId: { type: "string", description: "StyleSource id of the token. Provide tokenName OR tokenId." },
        instanceIds: { type: "array", items: { type: "string" } },
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
    const parsed = detachTokenFromInstancesInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, dryRun } = parsed.data;

    let auth;
    try { auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let tx;
    try { tx = buildDetachTransaction(build, parsed.data); }
    catch (err) { return errorResult("VALIDATION_FAILED", (err as Error).message); }

    if (tx.matchedCount === 0) {
      return textResult(`No-op (token not attached to any of the given instances):\n${tx.details.join("\n")}`);
    }

    if (dryRun) {
      return textResult(`DRY-RUN detach_token_from_instances\n\nToken: ${tx.tokenIdResolved}\n${tx.matchedCount} detachment(s):\n${tx.details.join("\n")}\n\nIf OK, re-run with dryRun=false.`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) =>
        buildDetachTransaction(cur, parsed.data).transaction,
      );
      return textResult(`Token detached from ${tx.matchedCount} instance(s) — version → ${finalVersion}\nstatus: ${result.status}\n\n${tx.details.join("\n")}`);
    } catch (err) {
      return runtimeErrorResult(err, "Detach failed");
    }
  },
};
