// Tool: webstudio_update_instance_label — rename one or more instance labels.
// The "label" is the developer-facing name shown in Webstudio's design panel
// (e.g. "Hero", "Header", "Card title"). Doesn't impact rendered HTML.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation, BuildPatchTransaction } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

const RenameSchema = z.object({
  instanceId: z.string(),
  label: z.string(),
}).strict();

export const updateInstanceLabelInputSchema = z.object({
  projectSlug: z.string(),
  updates: z.array(RenameSchema).min(1),
  dryRun: z.boolean().default(true),
}).strict();

function buildPatches(build: WebstudioBuild, updates: z.infer<typeof RenameSchema>[]): { patches: BuildPatchOperation[]; details: string[] } {
  const patches: BuildPatchOperation[] = [];
  const details: string[] = [];
  for (const u of updates) {
    const inst = build.instances.find((i) => i.id === u.instanceId);
    if (!inst) {
      details.push(`! ${u.instanceId}: not found (skip)`);
      continue;
    }
    if (inst.label === u.label) {
      details.push(`= ${u.instanceId}: already "${u.label}" (skip)`);
      continue;
    }
    const newInst = { ...inst, label: u.label };
    patches.push({ op: "replace", path: [u.instanceId], value: newInst });
    details.push(`✓ ${u.instanceId}: "${inst.label ?? "(empty)"}" → "${u.label}"`);
  }
  return { patches, details };
}

export const updateInstanceLabelTool: ToolModule = {
  definition: {
    name: "webstudio_update_instance_label",
    description: `Use when: rename instances' DESIGN-PANEL labels (shown in Webstudio's Navigator: "Hero", "Card title", "Mobile menu").
Do NOT use when: you want to edit the rendered text content — use webstudio_update_instance_text. To change an HTML attribute, use webstudio_instance_prop.
Returns: per-update diff (✓ renamed, = already matches, ! not found) OR push result. Idempotent.
Labels are developer-facing metadata only — they don't impact rendered HTML.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "acme", updates: [{ instanceId: "abc", label: "Hero" }, { instanceId: "xyz", label: "Mobile menu" }] }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              instanceId: { type: "string" },
              label: { type: "string" },
            },
            required: ["instanceId", "label"],
          },
          minItems: 1,
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "updates"],
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
    const parsed = updateInstanceLabelInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, updates, dryRun } = parsed.data;

    let auth;
    try { auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const { patches, details } = buildPatches(build, updates);
    if (patches.length === 0) return textResult(`No changes:\n${details.join("\n")}`);

    if (dryRun) return textResult(`DRY-RUN update_instance_label\n\n${patches.length} update(s):\n${details.join("\n")}\n\nIf OK, re-run with dryRun=false.`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildPatches(cur, updates);
        const tx: BuildPatchTransaction = {
          id: `mcp-update-label-${txId()}`,
          payload: [{ namespace: "instances", patches: re.patches }],
        };
        return tx;
      });
      return textResult(`${patches.length} label(s) updated — version → ${finalVersion}\nstatus: ${result.status}\n\n${details.join("\n")}`);
    } catch (err) {
      return runtimeErrorResult(err, "Update failed");
    }
  },
};
