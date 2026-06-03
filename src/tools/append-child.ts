// Tool: webstudio_append_child — add a simple new child to an existing instance.
// For complex children with style sources, layout, or nested structure, use webstudio_push_fragment.
// This tool is for the common case: append a single text element (h2, p, span, etc.) with optional token.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation, BuildPatchChange, BuildPatchTransaction } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);
const newId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

export const appendChildInputSchema = z.object({
  projectSlug: z.string(),
  parentInstanceId: z.string(),
  /** HTML tag of the new child. */
  tag: z.string(),
  /** Text content (single text node). For mixed content with bold etc., use push_fragment. */
  text: z.string().optional(),
  /** Optional Webstudio component (default ws:element which mirrors the tag). */
  component: z.string().default("ws:element"),
  /** Optional design-panel label. */
  label: z.string().optional(),
  /** Optional token to apply (by name). */
  tokenName: z.string().optional(),
  /** Index where to insert (0 = first, undefined = end). */
  insertIndex: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(true),
}).strict();

function buildChanges(build: WebstudioBuild, args: z.infer<typeof appendChildInputSchema>): { changes: BuildPatchChange[]; newInstanceId: string } {
  const parent = build.instances.find((i) => i.id === args.parentInstanceId);
  if (!parent) throw new Error(`Parent instance not found: ${args.parentInstanceId}`);

  let tokenId: string | null = null;
  if (args.tokenName) {
    const tok = build.styleSources.find((s) => s.type === "token" && s.name === args.tokenName);
    if (!tok) throw new Error(`Token not found: ${args.tokenName}`);
    tokenId = tok.id;
  }

  const childId = newId();
  const childChildren = args.text ? [{ type: "text" as const, value: args.text }] : [];

  const newChild = {
    type: "instance" as const,
    id: childId,
    component: args.component,
    tag: args.tag,
    ...(args.label && { label: args.label }),
    children: childChildren,
  };

  const instancePatches: BuildPatchOperation[] = [];
  instancePatches.push({ op: "add", path: [childId], value: newChild });

  // Update parent.children
  const newParentChildren = [...parent.children];
  const newRef = { type: "id" as const, value: childId };
  if (typeof args.insertIndex === "number" && args.insertIndex >= 0 && args.insertIndex <= newParentChildren.length) {
    newParentChildren.splice(args.insertIndex, 0, newRef);
  } else {
    newParentChildren.push(newRef);
  }
  instancePatches.push({ op: "replace", path: [args.parentInstanceId, "children"], value: newParentChildren });

  const changes: BuildPatchChange[] = [{ namespace: "instances", patches: instancePatches }];

  if (tokenId) {
    changes.push({
      namespace: "styleSourceSelections",
      patches: [{ op: "add", path: [childId], value: { instanceId: childId, values: [tokenId] } }],
    });
  }

  return { changes, newInstanceId: childId };
}

export const appendChildTool: ToolModule = {
  definition: {
    name: "webstudio_append_child",
    description: `Use when: add ONE simple text element (h2, p, span, button) under an existing parent, optionally with a single token applied.
Do NOT use when: you need a nested subtree, mixed content, multiple style sources, or layout containers — use webstudio_push_fragment (proper fragment builder with addInstance/addCard/addAccordion helpers). To duplicate an existing subtree elsewhere, use webstudio_clone_subtree. To insert a wrapper around an existing instance, use webstudio_wrap_instance.
Returns: dry-run summary with the generated childId + parent + patches per namespace, OR push result with the new instanceId + version.
component defaults to ws:element. tokenName resolves to the token's id (must exist). insertIndex inserts at position (default = append at end).
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "acme", parentInstanceId: "hero", tag: "h2", text: "Subtitle", tokenName: "Heading 2" }
Example: { projectSlug: "my-site", parentInstanceId: "card", tag: "p", text: "Description", insertIndex: 0 }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        parentInstanceId: { type: "string" },
        tag: { type: "string" },
        text: { type: "string" },
        component: { type: "string" },
        label: { type: "string" },
        tokenName: { type: "string" },
        insertIndex: { type: "number" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "parentInstanceId", "tag"],
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
    const parsed = appendChildInputSchema.safeParse(args);
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
      if (msg.startsWith("Parent instance not found")) return errorResult("INSTANCE_NOT_FOUND", msg);
      if (msg.startsWith("Token not found")) return errorResult("TOKEN_NOT_FOUND", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    const summary = `New ${data.tag}${data.text ? ` "${data.text.slice(0, 40)}"` : ""} (id ${r.newInstanceId})\nattached under ${data.parentInstanceId}${data.tokenName ? ` with token "${data.tokenName}"` : ""}`;

    if (data.dryRun) return textResult(`DRY-RUN append_child\n\n${summary}\n\nPatches:\n${r.changes.map((c) => `  - ${c.namespace}: ${c.patches.length}`).join("\n")}\n\nIf OK, re-run with dryRun=false.`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildChanges(cur, data);
        const tx: BuildPatchTransaction = { id: `mcp-append-child-${txId()}`, payload: re.changes };
        return tx;
      });
      return textResult(`Child appended (id ${r.newInstanceId}) — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Append failed");
    }
  },
};
