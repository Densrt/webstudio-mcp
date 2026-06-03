// Tool: webstudio_create_tokens — batch version of webstudio_create_token.
//
// Friction solved: seeding a design system used to require N sequential create_token calls
// (one per token). This tool consolidates everything into ONE fetchBuild + ONE transaction
// + ONE push.
//
// Continue-on-error semantics: each token is validated independently. Failures (duplicate
// name without overwrite, empty styles, strict-mode unknown var refs) are recorded in the
// "failed" list and DO NOT appear in the final transaction. Only successful tokens contribute
// patches. Plan + report logic lives in ./create-tokens/build-patches.ts.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { StyleValueSchema } from "../build-from-args.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction } from "../webstudio-client.js";
import type { StyleValue } from "../types.js";
import { txId } from "./create-token/shared.js";
import { planCreateTokens, renderReport, type Plan } from "./create-tokens/build-patches.js";

const TokenInput = z.object({
  name: z.string(),
  styles: z.record(z.string(), StyleValueSchema),
}).strict();

export const createTokensInputSchema = z.object({
  projectSlug: z.string(),
  tokens: z.array(TokenInput).min(1),
  breakpoint: z.string().default("Base"),
  overwrite: z.boolean().default(false),
  continueOnError: z.boolean().default(true),
  strict: z.boolean().default(false),
  dryRun: z.boolean().default(true),
}).strict();

function planArgs(data: z.infer<typeof createTokensInputSchema>) {
  return {
    tokens: data.tokens.map((t) => ({ name: t.name, styles: t.styles as Record<string, StyleValue> })),
    breakpoint: data.breakpoint,
    overwrite: data.overwrite,
    continueOnError: data.continueOnError,
    strict: data.strict,
  };
}

function makeTx(plan: Plan): BuildPatchTransaction {
  return {
    id: `mcp-create-tokens-${txId()}`,
    payload: [
      ...(plan.styleSourcePatches.length > 0
        ? [{ namespace: "styleSources" as const, patches: plan.styleSourcePatches }]
        : []),
      ...(plan.stylePatches.length > 0
        ? [{ namespace: "styles" as const, patches: plan.stylePatches }]
        : []),
    ],
  };
}

export const createTokensTool: ToolModule = {
  definition: {
    name: "webstudio_create_tokens",
    description: `Use when: create one OR several design tokens DIRECTLY in Webstudio cloud (styleSource type="token") — seed a design system, import typography/spacing scales, or add a single token. Accepts 1 or N definitions in the tokens array — ONE fetchBuild + ONE transaction + ONE push (no single-variant tool in v0.3.0).
Do NOT use when: staging tokens LOCALLY first to chain into a fragment (use webstudio_define_token then webstudio_sync_local_tokens — define_token only writes tokens.json), bulk-renaming existing tokens (use webstudio_rename_tokens), or editing decls of an existing token (use webstudio_update_token_styles).
Returns: dry-run with per-token succeeded/failed/skipped report (continueOnError tags), or push result with finalVersion.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

continueOnError=true (default) validates each token independently and reports failures without aborting the rest. strict=true aborts tokens that reference undefined CSS vars (default false → warn only). overwrite=false (default) refuses to extend an existing token with the same name (goes to "skipped" when continueOnError).

Example: { projectSlug: "acme", tokens: [{ name: "Color Primary", styles: { color: { type: "rgb", r: 224, g: 123, b: 26, alpha: 1 } } }, { name: "Space MD", styles: { padding: { type: "unit", unit: "px", value: 16 } } }], dryRun: true }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        tokens: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, styles: { type: "object" } },
            required: ["name", "styles"],
          },
          description: "Array of {name, styles} — each becomes a styleSource type='token'.",
        },
        breakpoint: { type: "string" },
        overwrite: { type: "boolean" },
        continueOnError: { type: "boolean" },
        strict: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "tokens"],
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
    const parsed = createTokensInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try {
      auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build: WebstudioBuild;
    try { build = await fetchBuild(auth); } catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const pa = planArgs(data);
    const plan = planCreateTokens(build, pa);
    if (plan.abort) return errorResult(plan.abort.code, plan.abort.message);

    const hasPatches = plan.styleSourcePatches.length > 0 || plan.stylePatches.length > 0;
    if (!hasPatches) {
      const header = !data.continueOnError && plan.failed.length > 0
        ? `Aborted (continueOnError=false, ${plan.failed.length} failure(s)) — no patches produced.`
        : `Nothing to push.`;
      return textResult(`${header}\n\n${renderReport(plan)}`);
    }

    if (data.dryRun) {
      return textResult(
        `DRY-RUN create_tokens (${plan.succeeded.length} token(s) will be created/extended)\n\n${renderReport(plan)}\n\nRe-run with dryRun=false and allowPush=true to apply.`,
      );
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const fresh = planCreateTokens(cur, pa);
        return makeTx(fresh);
      });
      return textResult(
        `Batch create_tokens — version → ${finalVersion}  status: ${result.status}\n\n${renderReport(plan)}`,
      );
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
