// Tool: webstudio_import_figma_variables
//
// One-call import of a Figma variable dictionary (already extracted via Figma MCP
// `get_variable_defs`) into a Webstudio project. Maps:
//  - hex          → CSS var color (root scope)
//  - numbers      → CSS var unit rem (spacing/radius/typo-size) on the root scope
//  - Font(...)    → design token (styleSource type="token") with composite font styles
//
// Naming heuristic: "the project/color/primary" → "--<prefix>-color-primary".
// Tokens use a humanized name: "title/h1" → "Title H1", "text/m" → "Body M".
// Overrides supported per figmaKey: { kind:"cssVar"|"token"|"skip", name? }.

import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import { buildPlan, assembleTransaction } from "./import-figma-variables/build-patches.js";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

const OverrideSchema = z.object({
  kind: z.enum(["cssVar", "token", "skip"]),
  name: z.string().optional(),
}).strict();

export const importFigmaVariablesInputSchema = z.object({
  projectSlug: z.string(),
  variables: z.record(z.string(), z.string()).describe(
    "Figma variable dict, as returned by figma.get_variable_defs. Values may be hex, number-as-string, or composite Font(...).",
  ),
  prefix: z.string().default("brand").describe("Prefix segment for derived CSS vars (e.g. 'brand' → --brand-color-primary)."),
  overrides: z.record(z.string(), OverrideSchema).default({}),
  breakpoint: z.string().default("Base"),
  overwrite: z.boolean().default(false).describe("If true, replace existing CSS vars / tokens with same name."),
  dryRun: z.boolean().default(true),
}).strict();

function formatPlanText(
  plan: ReturnType<typeof buildPlan>,
  asm: ReturnType<typeof assembleTransaction>,
): string {
  const lines: string[] = [];
  lines.push(`Root styleSource: ${asm.rootStyleSourceId}${asm.createdRootSource ? " (newly created)" : ""}`);
  lines.push("");
  lines.push(`CSS vars  → created: ${asm.cssVarsCreated.length}, updated: ${asm.cssVarsUpdated.length}, skipped: ${asm.cssVarsSkipped.length}`);
  if (asm.cssVarsCreated.length) lines.push(`  created : ${asm.cssVarsCreated.join(", ")}`);
  if (asm.cssVarsUpdated.length) lines.push(`  updated : ${asm.cssVarsUpdated.join(", ")}`);
  if (asm.cssVarsSkipped.length) lines.push(`  skipped : ${asm.cssVarsSkipped.join(", ")}`);
  lines.push("");
  lines.push(`Tokens    → created: ${asm.tokensCreated.length}, updated: ${asm.tokensUpdated.length}, skipped: ${asm.tokensSkipped.length}`);
  for (const t of asm.tokensCreated) lines.push(`  + ${t.name}  [id=${t.id}]`);
  for (const t of asm.tokensUpdated) lines.push(`  ~ ${t.name}  [id=${t.id}]`);
  for (const s of asm.tokensSkipped) lines.push(`  - ${s}`);

  if (plan.cssVars.length) {
    lines.push("");
    lines.push("Mapping (figmaKey → cssVar):");
    for (const v of plan.cssVars) lines.push(`  ${v.figmaKey}  →  --${v.cssVarName}  [${v.category}]`);
  }
  if (plan.tokens.length) {
    lines.push("");
    lines.push("Mapping (figmaKey → token):");
    for (const t of plan.tokens) lines.push(`  ${t.figmaKey}  →  "${t.tokenName}"  (${Object.keys(t.styles).join(", ")})`);
  }
  if (plan.skipped.length) {
    lines.push("");
    lines.push("Skipped inputs:");
    for (const s of plan.skipped) lines.push(`  ! ${s.figmaKey} — ${s.reason}`);
  }
  if (plan.warnings.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of plan.warnings) lines.push(`  ⚠ ${w}`);
  }
  return lines.join("\n");
}

export const importFigmaVariablesTool: ToolModule = {
  definition: {
    name: "webstudio_import_figma_variables",
    description: `Use when: import a Figma variable dictionary (extracted via figma.get_variable_defs MCP) into Webstudio in ONE call — bootstraps a fresh project's design system from the maquette.
Do NOT use when: you only need ONE token — use webstudio_define_token (local) or webstudio_create_tokens (cloud). For raw CSS var without Figma mapping, use webstudio_css_var.
Returns: { cssVarsCreated/Updated/Skipped, tokensCreated/Updated/Skipped, mapping, warnings }.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. Mapping rules:
  - hex color → CSS var color (root scope), "the project/color/primary" → --brand-color-primary
  - number → CSS var unit rem (px÷16) for spacing/radius/typo-size keys
  - Font(...) → design token (styleSource type="token") with fontFamily/fontWeight/fontSize/lineHeight/letterSpacing
Overrides per figmaKey: { kind:"cssVar"|"token"|"skip", name? }. overwrite=false by default (identical values are no-op).

Example: { projectSlug: "my-site", variables: { "the project/color/primary": "#82BB25", "the project/space/m": "16", "the project/text/h1": "Font(Inter, Bold, 48px, 1.1)" }, prefix: "brand" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        variables: { type: "object", description: "Figma variable dict (key → string value)." },
        prefix: { type: "string", default: "brand" },
        overrides: { type: "object" },
        breakpoint: { type: "string", default: "Base" },
        overwrite: { type: "boolean", default: false },
        dryRun: { type: "boolean", default: true },
      },
      required: ["projectSlug", "variables"],
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
    const parsed = importFigmaVariablesInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    if (Object.keys(data.variables).length === 0) {
      return errorResult("VALIDATION_FAILED", "variables must contain at least one entry.");
    }

    let auth;
    try {
      auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const plan = buildPlan({
      variables: data.variables,
      prefix: data.prefix,
      overrides: data.overrides,
    });

    let asm;
    try {
      asm = assembleTransaction(build, plan, data.breakpoint, txId(), data.overwrite);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Breakpoint")) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const summary = formatPlanText(plan, asm);
    const totalPatches = asm.transaction.payload.reduce((n, p) => n + p.patches.length, 0);

    if (data.dryRun) {
      return textResult(
        `DRY-RUN import_figma_variables (${totalPatches} patch operations)\n\n${summary}\n\nRe-run with dryRun=false and allowPush=true to apply.`,
      );
    }

    if (totalPatches === 0) {
      return textResult(`No-op (everything already in sync):\n\n${summary}`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const p2 = buildPlan({ variables: data.variables, prefix: data.prefix, overrides: data.overrides });
        const a2 = assembleTransaction(cur, p2, data.breakpoint, txId(), data.overwrite);
        return a2.transaction;
      });
      return textResult(
        `Figma variables imported — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`,
      );
    } catch (err) {
      return runtimeErrorResult(err, "Import failed");
    }
  },
};
