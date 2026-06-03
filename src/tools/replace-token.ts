// Tool: webstudio_replace_token — replace a token by another (existing or newly created),
// migrate all the styleSourceSelections that reference the old token, and delete the old token.
//
// Use case: cleanup a residual token from a forked template (e.g. "Foo Text XS Dark" → "MyBrand Text XS Dark").
// Modes:
//   - target by name/id: existing token, just migrate selections + delete old
//   - "rename": keep the old token's id and styles, just rename the token (no selection migration)

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation, BuildPatchChange, BuildPatchTransaction } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const replaceTokenInputSchema = z.object({
  projectSlug: z.string(),
  /** Source token to replace (by name or id). */
  fromTokenName: z.string().optional(),
  fromTokenId: z.string().optional(),
  /** Target token (existing). */
  toTokenName: z.string().optional(),
  toTokenId: z.string().optional(),
  /** Alternative mode: just rename the old token (no migration, no delete). */
  rename: z.string().optional(),
  /** When true, also delete the styles attached to the old token. Default true. */
  deleteOldStyles: z.boolean().default(true),
  dryRun: z.boolean().default(true),
}).strict().refine((d) => !!d.fromTokenName || !!d.fromTokenId, {
  message: "Provide fromTokenName or fromTokenId",
}).refine((d) => !!d.rename || !!d.toTokenName || !!d.toTokenId, {
  message: "Provide rename, toTokenName, or toTokenId",
});

function buildChanges(build: WebstudioBuild, args: z.infer<typeof replaceTokenInputSchema>): { changes: BuildPatchChange[]; details: string[] } {
  const fromToken = build.styleSources.find(
    (s): s is Extract<typeof s, { type: "token" }> =>
      s.type === "token" && (s.id === args.fromTokenId || s.name === args.fromTokenName),
  );
  if (!fromToken) throw new Error(`From-token not found: ${args.fromTokenName ?? args.fromTokenId}`);

  const details: string[] = [];

  // Mode RENAME: just update the styleSource's name
  if (args.rename) {
    const newToken = { ...fromToken, name: args.rename };
    return {
      changes: [{
        namespace: "styleSources",
        patches: [{ op: "replace", path: [fromToken.id], value: newToken }],
      }],
      details: [`Renamed "${fromToken.name}" → "${args.rename}" (id ${fromToken.id})`],
    };
  }

  // Mode REPLACE: migrate selections + delete old token + (optional) old styles
  const toToken = build.styleSources.find(
    (s): s is Extract<typeof s, { type: "token" }> =>
      s.type === "token" && (s.id === args.toTokenId || s.name === args.toTokenName),
  );
  if (!toToken) throw new Error(`To-token not found: ${args.toTokenName ?? args.toTokenId}`);
  if (toToken.id === fromToken.id) throw new Error("From and to tokens are the same");

  const selectionPatches: BuildPatchOperation[] = [];
  const stylePatches: BuildPatchOperation[] = [];
  const styleSourcePatches: BuildPatchOperation[] = [];

  // Migrate selections
  const selsUsingFrom = build.styleSourceSelections.filter((s) => s.values.includes(fromToken.id));
  for (const sel of selsUsingFrom) {
    const newValues = sel.values.map((v) => v === fromToken.id ? toToken.id : v);
    const deduped = Array.from(new Set(newValues));
    selectionPatches.push({
      op: "replace",
      path: [sel.instanceId],
      value: { instanceId: sel.instanceId, values: deduped },
    });
  }
  details.push(`${selsUsingFrom.length} styleSourceSelection(s) migrated from "${fromToken.name}" to "${toToken.name}"`);

  // Delete old styles
  if (args.deleteOldStyles) {
    const fromStyles = build.styles.filter((s) => s.styleSourceId === fromToken.id);
    for (const d of fromStyles) {
      const k = `${d.styleSourceId}:${d.breakpointId}:${d.property}:${d.state ?? ""}`;
      stylePatches.push({ op: "remove", path: [k] });
    }
    details.push(`${fromStyles.length} style declaration(s) of old token to be removed`);
  }

  // Delete old styleSource
  styleSourcePatches.push({ op: "remove", path: [fromToken.id] });
  details.push(`Old token "${fromToken.name}" [${fromToken.id}] removed`);

  const changes: BuildPatchChange[] = [];
  if (selectionPatches.length) changes.push({ namespace: "styleSourceSelections", patches: selectionPatches });
  if (stylePatches.length) changes.push({ namespace: "styles", patches: stylePatches });
  if (styleSourcePatches.length) changes.push({ namespace: "styleSources", patches: styleSourcePatches });

  return { changes, details };
}

export const replaceTokenTool: ToolModule = {
  definition: {
    name: "webstudio_replace_token",
    description: `Use when: migrate all SELECTIONS from token A to token B (rewrites every styleSourceSelections.values, then deletes A), OR rename a single token's display name keeping its id intact.
Do NOT use when: regex-renaming MANY tokens at once (use webstudio_rename_tokens), removing a token without migration (use webstudio_delete_token), editing a token's decls (use webstudio_update_token_styles), or removing a token from SPECIFIC instances only (use webstudio_detach_token).
Returns: dry-run with migration plan (selection count migrated, decls to remove on old token, styleSource patch), or push result.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Two modes — migrate: provide fromToken + toToken (both must exist); rewrites selections, then deletes fromToken styleSource + (if deleteOldStyles=true default) its decls. rename: provide fromToken + rename:"NewName"; keeps id and decls, just renames.

Example: { projectSlug: "acme", fromTokenName: "Old Primary", toTokenName: "Color Primary", deleteOldStyles: true, dryRun: true }
Example: { projectSlug: "acme", fromTokenName: "Card", rename: "Card Base", dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        fromTokenName: { type: "string" },
        fromTokenId: { type: "string" },
        toTokenName: { type: "string" },
        toTokenId: { type: "string" },
        rename: { type: "string" },
        deleteOldStyles: { type: "boolean" },
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
    const parsed = replaceTokenInputSchema.safeParse(args);
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
      if (msg.startsWith("From-token not found") || msg.startsWith("To-token not found")) return errorResult("TOKEN_NOT_FOUND", msg);
      if (msg.startsWith("From and to tokens are the same")) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const summary = `Plan:\n${r.details.map((d) => `  - ${d}`).join("\n")}\n\nPatches:\n${r.changes.map((c) => `  - ${c.namespace}: ${c.patches.length}`).join("\n")}`;

    if (data.dryRun) return textResult(`DRY-RUN replace_token\n\n${summary}\n\nIf OK, re-run with dryRun=false.`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildChanges(cur, data);
        return { id: `mcp-replace-token-${txId()}`, payload: re.changes };
      });
      return textResult(`Token replaced — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Replace failed");
    }
  },
};
