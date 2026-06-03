// Tool: webstudio_instance_prop — surgical removal of an instance prop.
// Counterpart to update_instance_prop, which can only set/overwrite but never remove
// the entry from build.props. Setting value="" leaves the prop in the DOM (empty string)
// and pollutes the panel — this tool actually drops the prop row.
//
// Each deletion is keyed by (instanceId, propName). Idempotent (no-op if missing).

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry, type WebstudioBuild, type BuildPatchOperation, type BuildPatchTransaction } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

const DeletionSchema = z.object({
  instanceId: z.string(),
  propName: z.string(),
}).strict();

export const deleteInstancePropInputSchema = z.object({
  projectSlug: z.string(),
  deletions: z.array(DeletionSchema).min(1),
  dryRun: z.boolean().default(true),
}).strict();

type Deletion = z.infer<typeof DeletionSchema>;

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function describe(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value === "string") return `"${truncate(value, 60)}"`;
  return truncate(JSON.stringify(value), 80);
}

export function buildDeleteInstancePropTransaction(
  build: WebstudioBuild,
  deletions: Deletion[],
): { transaction: BuildPatchTransaction; details: string[]; matchedCount: number } {
  const patches: BuildPatchOperation[] = [];
  const details: string[] = [];
  const seen = new Set<string>();

  for (const d of deletions) {
    const inst = build.instances.find((i) => i.id === d.instanceId);
    if (!inst) {
      details.push(`! ${d.instanceId}: instance not found`);
      continue;
    }

    const existing = build.props.find(
      (p) => p.instanceId === d.instanceId && p.name === d.propName,
    );

    if (!existing) {
      details.push(`· ${d.instanceId} (${inst.label ?? inst.component}): prop "${d.propName}" absent — nothing to delete`);
      continue;
    }

    if (seen.has(existing.id)) continue;
    seen.add(existing.id);

    patches.push({ op: "remove", path: [existing.id] });
    details.push(
      `- ${d.instanceId} (${inst.label ?? inst.component}): drop ${d.propName} (${existing.type}) = ${describe(existing.value)}`,
    );
  }

  const payload = patches.length > 0
    ? [{ namespace: "props" as const, patches }]
    : [];

  return {
    transaction: { id: `mcp-delete-instance-prop-${txId()}`, payload },
    details,
    matchedCount: patches.length,
  };
}

export const deleteInstancePropTool: ToolModule = {
  definition: {
    name: "webstudio_delete_instance_prop",
    description: `Use when: REMOVE a prop entry from an instance (drop the row from build.props entirely, not just blank its value).
Do NOT use when: you want to remove a style declaration (color, padding, backgroundImage) — that's webstudio_styles. To remove the whole instance, use webstudio_delete_instance. To overwrite a prop value, use webstudio_instance_prop (setting value="" leaves an empty-string row — use THIS tool to truly delete).
Returns: dry-run per-deletion plan ("- drop", "· absent", "! not found") OR push result with version. Idempotent (no-op if prop absent).
Keyed by (instanceId, propName).
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "acme", deletions: [{ instanceId: "abc", propName: "alt" }, { instanceId: "abc", propName: "ariaLabel" }] }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        deletions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              instanceId: { type: "string" },
              propName: { type: "string" },
            },
            required: ["instanceId", "propName"],
          },
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "deletions"],
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
    const parsed = deleteInstancePropInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, deletions, dryRun } = parsed.data;

    let auth;
    try { auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const tx = buildDeleteInstancePropTransaction(build, deletions);

    if (tx.matchedCount === 0) {
      return textResult(`No-op (nothing matched):\n${tx.details.join("\n")}`);
    }

    if (dryRun) {
      return textResult(`DRY-RUN delete_instance_prop\n\n${tx.matchedCount} prop(s) to remove:\n${tx.details.join("\n")}\n\nIf OK, re-run with dryRun=false.`);
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => buildDeleteInstancePropTransaction(cur, deletions).transaction);
      return textResult(`${tx.matchedCount} prop(s) removed — version → ${finalVersion}\nstatus: ${result.status}\n\n${tx.details.join("\n")}`);
    } catch (err) {
      return runtimeErrorResult(err, "Delete failed");
    }
  },
};
