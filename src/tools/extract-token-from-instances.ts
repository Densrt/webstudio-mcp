// Tool: webstudio_extract_token — analyze N instances, find styles
// they share identically, extract them as a new (or existing) token, and apply it.

import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { BuildPatchTransaction } from "../webstudio-client.js";
import { buildExtractTokenChanges } from "./extract-token-from-instances/build-patches.js";

const txId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

export const extractTokenFromInstancesInputSchema = z.object({
  projectSlug: z.string(),
  instanceIds: z.array(z.string()).min(2),
  tokenName: z.string(),
  breakpoint: z.string().default("Base"),
  applyAndCleanup: z.boolean().default(true),
  dryRun: z.boolean().default(true),
}).strict();

export const extractTokenFromInstancesTool: ToolModule = {
  definition: {
    name: "webstudio_extract_token",
    description: `Use when: N similar instances have IDENTICAL local styles you want to consolidate into a shared NEW token (start from raw locals, no source token).
Do NOT use when: applying an EXISTING token to instances (use webstudio_apply_token), forking an existing token + adding overrides for N instances (use webstudio_extract_variant_token), or styling a single instance (use webstudio_styles — tokens are for ≥2 reuse).
Returns: dry-run report listing the common decls (property + value extract) and patch counts (styleSources/styles/selections), or push result.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. applyAndCleanup=true (default) also applies the new token to all input instances and removes the covered locals. applyAndCleanup=false + dryRun=true = diagnostic mode (see the diff before deciding).

Requires instanceIds.length ≥ 2.

Example: { projectSlug: "acme", instanceIds: ["a","b","c"], tokenName: "Card Base", breakpoint: "Base", dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        instanceIds: { type: "array", items: { type: "string" }, minItems: 2 },
        tokenName: { type: "string" },
        breakpoint: { type: "string" },
        applyAndCleanup: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "instanceIds", "tokenName"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = extractTokenFromInstancesInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let r;
    try { r = buildExtractTokenChanges(build, data); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Breakpoint not found")) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const detailsText = r.details.join("\n");
    const commonText = r.commonDecls.length > 0
      ? `Common declarations (${r.commonDecls.length}):\n${r.commonDecls.map((d) => `  - ${d.property}${d.state ? `[${d.state}]` : ""} = ${JSON.stringify(d.value).slice(0, 70)}`).join("\n")}`
      : "";

    if (r.changes.length === 0) {
      return textResult(`extract_token_from_instances\n\n${detailsText}\n\n(No changes generated.)`);
    }

    const summary = `${detailsText}\n\n${commonText}\n\nPatches:\n${r.changes.map((c) => `  - ${c.namespace}: ${c.patches.length}`).join("\n")}`;
    if (data.dryRun) return textResult(`DRY-RUN extract_token_from_instances\n\n${summary}\n\nIf OK, re-run with dryRun=false.`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildExtractTokenChanges(cur, data);
        const tx: BuildPatchTransaction = { id: `mcp-extract-token-${txId()}`, payload: re.changes };
        return tx;
      });
      return textResult(`Token extracted — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Extraction failed");
    }
  },
};
