// Tool: webstudio_extract_variant_token
//
// Workflow: take N instances that use `sourceToken` plus a few local overrides,
// create a new variant token (`sourceToken` decls + overrides), migrate the N
// instances onto the new token, and clean up the now-redundant local decls.
//
// Two modes for the override set:
//   - explicit: caller passes `overrides: { property → value }`
//   - auto: detect local decls SHARED across all targeted instances on the same
//     prop+bp+state (= only those that all instances agree on become overrides).

import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import { buildExtractVariantChanges } from "./extract-variant-token/build-patches.js";
import { resolveStateForWrite } from "../lib/state-whitelist.js";
import { logCoerce } from "../lib/telemetry.js";

const txId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

const StyleValueSchema = z.record(z.unknown());

export const extractVariantTokenInputSchema = z.object({
  projectSlug: z.string(),
  sourceTokenName: z.string().optional(),
  sourceTokenId: z.string().optional(),
  instanceIds: z.array(z.string()).min(1),
  newTokenName: z.string(),
  overrides: z.record(StyleValueSchema).optional(),
  breakpoint: z.string().default("Base"),
  state: z.string().default(""),
  dryRun: z.boolean().default(true),
}).strict().refine((d) => !!d.sourceTokenName || !!d.sourceTokenId, {
  message: "Provide sourceTokenName or sourceTokenId",
});

function mapBuildError(msg: string) {
  if (msg.startsWith("Source token not found") || msg.startsWith("Source style source is not a token")) return errorResult("TOKEN_NOT_FOUND", msg);
  if (msg.startsWith("Breakpoint not found")) return errorResult("VALIDATION_FAILED", msg);
  if (/Instance .* does not use source token/.test(msg)) return errorResult("INSTANCE_NOT_FOUND", msg);
  if (msg.startsWith("Token ") && msg.includes("already exists")) return errorResult("VALIDATION_FAILED", msg);
  if (msg.startsWith("Auto-detect found no shared overrides")) return errorResult("VALIDATION_FAILED", msg);
  return errorResult("INTERNAL_ERROR", msg);
}

export const extractVariantTokenTool: ToolModule = {
  definition: {
    name: "webstudio_extract_variant_token",
    description: `Use when: N instances share a SOURCE token + identical local overrides → fork into a new variant token (sourceToken decls + overrides) and migrate the instances.
Do NOT use when: no source token yet (use webstudio_extract_token — extracts from raw locals), tweaking a single instance's styles (use webstudio_styles), or editing an existing token's decls (use webstudio_update_token_styles).
Returns: dry-run with new token id + extracted overrides list (property:state = value) + patch counts (styleSources/styles/selections), or push result.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

overrides: pass explicitly { property: value } OR omit to auto-detect unanimous shared local decls across the N instances on the same (breakpoint, state). breakpoint defaults to "Base", state defaults to "" (no pseudo).

Example: { projectSlug: "acme", sourceTokenName: "Card Base", instanceIds: ["a","b"], newTokenName: "Card Dark", overrides: { backgroundColor: { type: "keyword", value: "black" } }, dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        sourceTokenName: { type: "string" },
        sourceTokenId: { type: "string" },
        instanceIds: { type: "array", items: { type: "string" } },
        newTokenName: { type: "string" },
        overrides: { type: "object" },
        breakpoint: { type: "string" },
        state: { type: "string" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "instanceIds", "newTokenName"],
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
    const parsed = extractVariantTokenInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    // Normalize `state` to its canonical selector form before matching/writing decls — a bare
    // "hover" would target (and store) a dead state. Keep the "" convention this path uses for
    // base. Recoverable forms coerced (hint + telemetry), unrecoverable rejected.
    // See lib/state-whitelist.ts + pattern state-selector-format.
    const sr = resolveStateForWrite(data.state);
    if (!sr.ok) return errorResult("VALIDATION_FAILED", `Invalid state: ${sr.error}`);
    const vdata = { ...data, state: sr.state ?? "" };
    if (sr.hint) {
      void logCoerce(sr.telemetryKey, { source: "tokens.extract_variant", projectSlug: data.projectSlug, from: sr.from, to: vdata.state, reason: sr.reason });
    }
    const hintLine = sr.hint ? `\n\n[hints]\n- ${sr.hint}` : "";

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let r;
    try { r = buildExtractVariantChanges(build, vdata); }
    catch (err) { return mapBuildError((err as Error).message); }

    const overridesList = r.extracted.map((o) => `    - ${o.property}${o.state ?? ""} = ${JSON.stringify(o.value)}`).join("\n");
    const summary = `Extracted variant "${r.newTokenName}" from "${r.sourceTokenName}":
  Source token  : "${r.sourceTokenName}" [${r.sourceTokenId}]
  New token id  : ${r.newTokenId}
  Instances     : ${r.targetCount}
  Overrides     : ${r.extracted.length}
${overridesList}

  StyleSources patches : ${r.styleSourcePatches.length}
  Styles patches       : ${r.stylePatches.length}
  Selections patches   : ${r.selectionPatches.length}`;

    if (data.dryRun) return textResult(`DRY-RUN extract_variant_token\n\n${summary}\n\nIf OK, re-run with dryRun=false.${hintLine}`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildExtractVariantChanges(cur, vdata);
        const payload = [
          { namespace: "styleSources" as const, patches: re.styleSourcePatches },
          { namespace: "styles" as const, patches: re.stylePatches },
          { namespace: "styleSourceSelections" as const, patches: re.selectionPatches },
        ];
        return { id: `mcp-extract-variant-${txId()}`, payload };
      });
      return textResult(`Variant token extracted — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}${hintLine}`);
    } catch (err) {
      return runtimeErrorResult(err, "Extract failed");
    }
  },
};
