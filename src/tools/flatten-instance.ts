// Tool: webstudio_flatten_instance
//
// Replace one or more wrapper instances by their children, in their parents'
// children list. Optionally drop some of the wrapper's children (e.g.
// decoratives) instead of lifting them. Cleanup includes wrapper props,
// styles, and the dropped subtrees.

import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import { buildFlattenChanges } from "./flatten-instance/build-patches.js";

const txId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

export const flattenInstanceInputSchema = z.object({
  projectSlug: z.string(),
  instanceIds: z.array(z.string()).min(1),
  dropChildLabels: z.array(z.string()).optional(),
  dropChildTags: z.array(z.string()).optional(),
  dropChildComponents: z.array(z.string()).optional(),
  dryRun: z.boolean().default(true),
}).strict();

export const flattenInstanceTool: ToolModule = {
  definition: {
    name: "webstudio_flatten_instance",
    description: `Use when: REMOVE a wrapper instance and lift its children into the wrapper's parent (the opposite of wrap_instance).
Do NOT use when: you want to INSERT a wrapper around an instance — use webstudio_wrap_instance. To delete the wrapper AND its children together, use webstudio_delete_instance (full subtree). To remove just decorative children but keep the wrapper, use webstudio_delete_instance on those children.
Returns: dry-run plan per wrapper (children lifted, children dropped, deletedCount) + patch counts across instances/props/selections/styleSources/styles, OR push result with version.
Cleanup includes wrapper's props, styles, selections, and local sources. Drop selected wrapper children via dropChildLabels / dropChildTags / dropChildComponents — these + their descendants are removed (not lifted). Refuses to flatten a root instance.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "acme", instanceIds: ["unused_wrapper"], dropChildLabels: ["Decorative bg"] }
Example: { projectSlug: "my-site", instanceIds: ["wrap1", "wrap2"], dropChildTags: ["hr"] }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        instanceIds: { type: "array", items: { type: "string" } },
        dropChildLabels: { type: "array", items: { type: "string" } },
        dropChildTags: { type: "array", items: { type: "string" } },
        dropChildComponents: { type: "array", items: { type: "string" } },
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
    const parsed = flattenInstanceInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let r;
    try { r = buildFlattenChanges(build, data); }
    catch (err) {
      const msg = (err as Error).message;
      if (/Wrapper instance .* not found/.test(msg)) return errorResult("INSTANCE_NOT_FOUND", msg);
      if (/is a root instance/.test(msg)) return errorResult("VALIDATION_FAILED", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const lines: string[] = [];
    lines.push(`Wrappers to flatten: ${r.plans.length}`);
    lines.push(`Total instances deleted (wrappers + dropped subtrees): ${r.deletedCount}`);
    lines.push("");
    for (const p of r.plans) {
      lines.push(`  • [${p.wrapperId}] "${p.wrapperLabel}" — lift ${p.childrenLifted.length} child(ren), drop ${p.childrenDropped.length}`);
    }
    lines.push("");
    lines.push(`Patches:`);
    lines.push(`  instances: ${r.instancePatches.length}`);
    lines.push(`  props: ${r.propPatches.length}`);
    lines.push(`  styleSourceSelections: ${r.selectionPatches.length}`);
    lines.push(`  styleSources: ${r.styleSourcePatches.length}`);
    lines.push(`  styles: ${r.stylePatches.length}`);
    const summary = lines.join("\n");

    if (data.dryRun) return textResult(`DRY-RUN flatten_instance\n\n${summary}\n\nIf OK, re-run with dryRun=false.`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildFlattenChanges(cur, data);
        const payload = [];
        if (re.instancePatches.length) payload.push({ namespace: "instances" as const, patches: re.instancePatches });
        if (re.propPatches.length) payload.push({ namespace: "props" as const, patches: re.propPatches });
        if (re.selectionPatches.length) payload.push({ namespace: "styleSourceSelections" as const, patches: re.selectionPatches });
        if (re.styleSourcePatches.length) payload.push({ namespace: "styleSources" as const, patches: re.styleSourcePatches });
        if (re.stylePatches.length) payload.push({ namespace: "styles" as const, patches: re.stylePatches });
        return { id: `mcp-flatten-${txId()}`, payload };
      });
      return textResult(`Flatten pushed — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Flatten failed");
    }
  },
};
