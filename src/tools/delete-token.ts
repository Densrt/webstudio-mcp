// Tool: webstudio_delete_token
//
// Safely delete a token from the project: removes the styleSource, all attached styles,
// and any selection that referenced it. Refuses by default if the token is still in use,
// unless force=true.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const deleteTokenInputSchema = z.object({
  projectSlug: z.string(),
  tokenName: z.string().optional(),
  tokenId: z.string().optional(),
  /** Force deletion even if the token is still referenced. The token is removed from each
   *  selection.values list (but the instance keeps its other style sources). Default false. */
  force: z.boolean().default(false),
  dryRun: z.boolean().default(true),
}).strict().refine((d) => !!d.tokenName || !!d.tokenId, { message: "Provide tokenName or tokenId" });

function buildChanges(build: WebstudioBuild, args: z.infer<typeof deleteTokenInputSchema>) {
  const tokenId = args.tokenId
    ?? build.styleSources.find((s) => s.type === "token" && s.name === args.tokenName)?.id;
  if (!tokenId) throw new Error(`Token not found: ${args.tokenName ?? args.tokenId}`);
  const token = build.styleSources.find((s) => s.id === tokenId);
  if (token?.type !== "token") throw new Error(`Style source ${tokenId} is not a token`);

  const usingSelections = build.styleSourceSelections.filter((sel) => sel.values?.includes(tokenId));
  const tokenStyles = build.styles.filter((s) => s.styleSourceId === tokenId);

  if (usingSelections.length > 0 && !args.force) {
    const sample = usingSelections.slice(0, 5).map((s) => s.instanceId).join(", ");
    throw new Error(
      `Token "${token.name}" still used by ${usingSelections.length} instance(s) (sample: ${sample}). ` +
      `Use replace_token to migrate them to another token first, or pass force=true to remove it from each selection.`,
    );
  }

  // Patches
  const styleSourcePatches: BuildPatchOperation[] = [{ op: "remove", path: [tokenId] }];
  const stylePatches: BuildPatchOperation[] = tokenStyles.map((d) => ({
    op: "remove",
    path: [`${d.styleSourceId}:${d.breakpointId}:${d.property}:${d.state ?? ""}`],
  }));
  const selectionPatches: BuildPatchOperation[] = [];
  if (args.force) {
    for (const sel of usingSelections) {
      const newValues = sel.values.filter((v) => v !== tokenId);
      selectionPatches.push({
        op: "replace",
        path: [sel.instanceId],
        value: { instanceId: sel.instanceId, values: newValues },
      });
    }
  }

  return {
    token,
    usingCount: usingSelections.length,
    declsCount: tokenStyles.length,
    styleSourcePatches,
    stylePatches,
    selectionPatches,
  };
}

export const deleteTokenTool: ToolModule = {
  definition: {
    name: "webstudio_delete_token",
    description: `Use when: remove a token from the project (styleSource + all attached style decls + selection refs if force=true).
Do NOT use when: detaching a token from SPECIFIC instances without deleting it (use webstudio_detach_token), migrating selections to another token first (use webstudio_replace_token — recommended before delete), renaming a token (use webstudio_rename_tokens or webstudio_replace_token with rename mode).
Returns: dry-run with decl/selection/styleSource patch counts and (if force=false + still used) a clear refusal error listing 5 sample instanceIds, or push result.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

If still used and force=false: REFUSES (recommended: run webstudio_replace_token first to migrate selections, then delete becomes a clean operation). force=true removes the token from each selection.values list (instance keeps other sources but loses this one — may change visuals).

Example: { projectSlug: "acme", tokenName: "Color Legacy", dryRun: true }
Example: { projectSlug: "acme", tokenName: "Color Legacy", force: true, dryRun: true }  // unsafe`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        tokenName: { type: "string" },
        tokenId: { type: "string" },
        force: { type: "boolean" },
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
    const parsed = deleteTokenInputSchema.safeParse(args);
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
      if (msg.startsWith("Style source") && msg.includes("is not a token")) return errorResult("TOKEN_NOT_FOUND", msg);
      if (msg.startsWith("Token ") && msg.includes("still used")) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const summary = `Delete "${r.token?.type === "token" ? r.token.name : ""}" [${r.token?.id}]
  Decls to remove        : ${r.declsCount}
  Selections to update   : ${r.selectionPatches.length}${data.force && r.usingCount > 0 ? ` (force: removed from ${r.usingCount} instance(s))` : ""}
  StyleSource patches    : ${r.styleSourcePatches.length}`;

    if (data.dryRun) return textResult(`DRY-RUN delete_token\n\n${summary}\n\nIf OK, re-run with dryRun=false.`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildChanges(cur, data);
        const payload = [];
        if (re.selectionPatches.length) payload.push({ namespace: "styleSourceSelections" as const, patches: re.selectionPatches });
        if (re.stylePatches.length) payload.push({ namespace: "styles" as const, patches: re.stylePatches });
        if (re.styleSourcePatches.length) payload.push({ namespace: "styleSources" as const, patches: re.styleSourcePatches });
        return { id: `mcp-delete-token-${txId()}`, payload };
      });
      return textResult(`Token deleted — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Delete failed");
    }
  },
};
