// Tool: webstudio_css_var
//
// Remove one or more CSS custom properties from the project's :root scope.
// Pairs with webstudio_css_var (write side) and webstudio_css_var (read side).
//
// Safety: by default refuses if the var is still referenced via { type:"var", value:"<name>" }
// somewhere in the build. Use force=true to delete anyway (callers stay broken until manually fixed).

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);
const ROOT_INSTANCE_ID = ":root";

export const deleteCssVarInputSchema = z.object({
  projectSlug: z.string(),
  /** Names of CSS vars to delete. Names can be passed with or without leading "--". */
  names: z.array(z.string()).min(1),
  /** Restrict to a specific breakpoint label/id. Default: all breakpoints (Base + responsive overrides). */
  breakpoint: z.string().optional(),
  /** Force deletion even if the var is still referenced via var(...) somewhere. Default false. */
  force: z.boolean().default(false),
  dryRun: z.boolean().default(true),
}).strict();

function buildChanges(build: WebstudioBuild, args: z.infer<typeof deleteCssVarInputSchema>) {
  const allowedBpId = args.breakpoint
    ? build.breakpoints.find((b) => b.label === args.breakpoint || b.id === args.breakpoint)?.id
    : undefined;
  if (args.breakpoint && !allowedBpId) throw new Error(`Breakpoint not found: ${args.breakpoint}`);

  const rootSel = build.styleSourceSelections.find((s) => s.instanceId === ROOT_INSTANCE_ID);
  const rootSourceIds = new Set(
    (rootSel?.values ?? []).filter((v) => build.styleSources.find((s) => s.id === v)?.type === "local"),
  );
  if (rootSourceIds.size === 0) throw new Error(`No root-level styleSource found on ":root". Nothing to delete.`);

  const fullNames = args.names.map((n) => (n.startsWith("--") ? n : `--${n}`));

  // Find matching decls
  const targets = build.styles.filter((d) =>
    rootSourceIds.has(d.styleSourceId) &&
    fullNames.includes(d.property) &&
    (!allowedBpId || d.breakpointId === allowedBpId),
  );

  const foundNames = new Set(targets.map((t) => t.property));
  const missing = fullNames.filter((n) => !foundNames.has(n));

  // Detect lingering references — handles BOTH encodings:
  //   - structured `{type:"var", value:"name"}` decl values
  //   - raw `var(--name)` text inside `unparsed` decl values (linear-gradient, calc,
  //     complex shorthand). Bug 2026-05-20: previous code only checked structured
  //     refs → 4 active vars deleted (used in linear-gradient unparsed strings) →
  //     hero overlay broken across all Acme product pages.
  const referencingDecls: Array<{ name: string; refCount: number; refSamples: string[] }> = [];
  for (const fullName of foundNames) {
    const shortName = fullName.replace(/^--/, "");
    const refs = build.styles.filter((d) => {
      const v = d.value as { type?: string; value?: unknown };
      if (v?.type === "var" && v.value === shortName) return true;
      if (v?.type === "unparsed" && typeof v.value === "string") {
        // Use a fresh regex per call (no `g` flag state pollution).
        return new RegExp(`var\\(\\s*${fullName.replace(/[-]/g, "\\-")}\\b`).test(v.value);
      }
      return false;
    });
    if (refs.length > 0) {
      referencingDecls.push({
        name: fullName,
        refCount: refs.length,
        refSamples: refs.slice(0, 3).map((d) => `${d.property} on styleSource ${d.styleSourceId}`),
      });
    }
  }

  if (referencingDecls.length > 0 && !args.force) {
    const lines = referencingDecls.map(
      (r) => `  ${r.name} (${r.refCount} refs) — sample: ${r.refSamples.join(" | ")}`,
    );
    throw new Error(
      `Cannot delete vars still referenced (use force=true to override):\n${lines.join("\n")}`,
    );
  }

  // Build remove patches
  const stylePatches: BuildPatchOperation[] = targets.map((d) => ({
    op: "remove",
    path: [`${d.styleSourceId}:${d.breakpointId}:${d.property}:${d.state ?? ""}`],
  }));

  return { fullNames, foundNames: [...foundNames], missing, referencingDecls, stylePatches };
}

export const deleteCssVarTool: ToolModule = {
  definition: {
    name: "webstudio_delete_css_var",
    description: `Use when: remove CSS custom properties (--xxx) from :root scope.
Do NOT use when: replacing var REFERENCES (var(--legacy) → var(--new)) before deleting (use webstudio_css_var first — recommended), removing a design TOKEN (use webstudio_delete_token), or removing a local style decl on an instance (use webstudio_styles).
Returns: dry-run with foundNames + missing list + style-patch count, OR (if still referenced and force=false) a refusal error listing every dangling reference with samples.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. Refuses by default if a var is still referenced via var(--name) anywhere. force=true deletes anyway — callers will fall back to their CSS fallback or "unset" (broken until manually fixed).

Names accepted with or without leading "--". breakpoint restricts removal to one bp (default: all).

Example: { projectSlug: "acme", names: ["legacy-gap-m", "old-text-xs"], dryRun: true }
Example: { projectSlug: "acme", names: ["--old-radius"], force: true, dryRun: false }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        names: { type: "array", items: { type: "string" } },
        breakpoint: { type: "string" },
        force: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "names"],
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
    const parsed = deleteCssVarInputSchema.safeParse(args);
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
      if (msg.startsWith("Breakpoint not found")) return errorResult("VALIDATION_FAILED", msg);
      if (msg.startsWith("No root-level styleSource")) return errorResult("CSS_VAR_NOT_FOUND", msg);
      if (msg.startsWith("Cannot delete vars still referenced")) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const summary = `Vars to delete: ${r.foundNames.length}${r.foundNames.length ? "  (" + r.foundNames.join(", ") + ")" : ""}
Missing (not found): ${r.missing.length}${r.missing.length ? "  (" + r.missing.join(", ") + ")" : ""}
Style patches (remove): ${r.stylePatches.length}${data.force && r.referencingDecls.length ? `\n⚠ FORCE: ${r.referencingDecls.length} var(s) still referenced — callers will fall back.` : ""}`;

    if (data.dryRun) return textResult(`DRY-RUN delete_css_var\n\n${summary}\n\nIf OK, re-run with dryRun=false.`);
    if (r.stylePatches.length === 0) return textResult(`No-op (nothing to delete):\n\n${summary}`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildChanges(cur, data);
        const payload = [{ namespace: "styles" as const, patches: re.stylePatches }];
        return { id: `mcp-delete-css-var-${txId()}`, payload };
      });
      return textResult(`CSS vars deleted — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Delete failed");
    }
  },
};
