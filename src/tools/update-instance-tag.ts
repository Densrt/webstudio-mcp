// Tool: webstudio_update_instance_tag — change the HTML tag of one or more instances
// (e.g. h1 → h2, div → section). Component stays the same (ws:element). Useful for
// fixing SEO mistakes like multiple H1s on a single page without losing the instance's
// children, props, styles or labels.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation, BuildPatchTransaction } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

const UpdateSchema = z.object({
  instanceId: z.string(),
  tag: z.string().min(1).describe("New HTML tag (lower-case, e.g. 'h2', 'section', 'aside')"),
}).strict();

export const updateInstanceTagInputSchema = z.object({
  projectSlug: z.string(),
  updates: z.array(UpdateSchema).min(1),
  dryRun: z.boolean().default(true),
}).strict();

function buildPatches(build: WebstudioBuild, updates: z.infer<typeof UpdateSchema>[]): { patches: BuildPatchOperation[]; details: string[] } {
  const patches: BuildPatchOperation[] = [];
  const details: string[] = [];
  for (const u of updates) {
    const inst = build.instances.find((i) => i.id === u.instanceId);
    if (!inst) {
      details.push(`! ${u.instanceId}: not found (skip)`);
      continue;
    }
    if (inst.tag === u.tag) {
      details.push(`= ${u.instanceId}: already <${u.tag}> (skip)`);
      continue;
    }
    const newInst = { ...inst, tag: u.tag };
    patches.push({ op: "replace", path: [u.instanceId], value: newInst });
    details.push(`✓ ${u.instanceId}: <${inst.tag ?? "(none)"}> → <${u.tag}>`);
  }
  return { patches, details };
}

export const updateInstanceTagTool: ToolModule = {
  definition: {
    name: "webstudio_update_instance_tag",
    description: `Use when: change an instance's HTML tag (e.g. demote duplicate H1 to H2, change a div to a section/aside, fix heading hierarchy). Preserves the component (ws:element), children, props, styles, and label.
Do NOT use when: changing rendered text (use webstudio_update_instance_text). To change a component, you cannot — delete + re-add.
Returns: per-update diff (✓ changed, = already matches, ! not found) OR push result. Idempotent.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "my-site", updates: [{ instanceId: "abc", tag: "h2" }] }`,
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
              tag: { type: "string" },
            },
            required: ["instanceId", "tag"],
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
    const parsed = updateInstanceTagInputSchema.safeParse(args);
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

    if (dryRun) return textResult(`DRY-RUN update_instance_tag\n\n${patches.length} update(s):\n${details.join("\n")}\n\nIf OK, re-run with dryRun=false.`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildPatches(cur, updates);
        const tx: BuildPatchTransaction = {
          id: `mcp-update-tag-${txId()}`,
          payload: [{ namespace: "instances", patches: re.patches }],
        };
        return tx;
      });
      return textResult(`${patches.length} tag(s) updated — version → ${finalVersion}\nstatus: ${result.status}\n\n${details.join("\n")}`);
    } catch (err) {
      return runtimeErrorResult(err, "Update failed");
    }
  },
};
