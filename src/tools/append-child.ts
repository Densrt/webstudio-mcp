// Tool: webstudio_append_child — add simple new children to an existing instance.
// For complex children with style sources, layout, or nested structure, use webstudio_push_fragment.
// Single form (tag/text…) for one element; batch form (children[]) appends N simple
// elements in ONE transaction (v2.16.0 — was one MCP call per child).

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchOperation, BuildPatchChange, BuildPatchTransaction } from "../webstudio-client.js";
import { customAlphabet } from "nanoid";
import { logCoerce } from "../lib/telemetry.js";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);
const newId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

const AppendChildSpecSchema = z.object({
  /** HTML tag of this child. */
  tag: z.string(),
  /** Text content (single text node). */
  text: z.string().optional(),
  /** Webstudio component — defaults to the top-level `component` (ws:element). */
  component: z.string().optional(),
  /** Design-panel label. */
  label: z.string().optional(),
  /** Token to apply (by name). */
  tokenName: z.string().optional(),
}).strict();

export type AppendChildSpec = z.infer<typeof AppendChildSpecSchema>;

export const appendChildInputSchema = z.object({
  projectSlug: z.string(),
  parentInstanceId: z.string(),
  /** HTML tag of the new child (single form — use `children` for batch). */
  tag: z.string().optional(),
  /** Text content (single text node). For mixed content with bold etc., use push_fragment. */
  text: z.string().optional(),
  /** Webstudio component (default ws:element which mirrors the tag). With `children`, acts as the per-child default. */
  component: z.string().default("ws:element"),
  /** Optional design-panel label. */
  label: z.string().optional(),
  /** Optional token to apply (by name). */
  tokenName: z.string().optional(),
  /** Batch form (v2.16.0): append N simple children in ONE transaction, in order (list items, nav links…). Mutually exclusive with tag/text/label/tokenName. */
  children: z.array(AppendChildSpecSchema).min(1).max(50).optional(),
  /** Index where to insert (0 = first, undefined = end). Batch children are inserted consecutively from this index. */
  insertIndex: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().default(true),
}).strict()
  .refine((d) => !!d.tag !== !!d.children, { message: "Provide either tag (single child) or children (batch), not both" })
  .refine((d) => !d.children || (!d.text && !d.label && !d.tokenName), {
    message: "With children (batch form), per-child text/label/tokenName go inside each entry",
  });

/**
 * Build the patch changes appending N simple children under a parent — ONE
 * parent.children replace whatever the batch size (v2.16.0; the single-child
 * form normalises to a 1-entry batch). Pure — exported for direct tests.
 */
export function buildAppendChanges(
  build: WebstudioBuild,
  args: { parentInstanceId: string; children: AppendChildSpec[]; insertIndex?: number; defaultComponent?: string },
): { changes: BuildPatchChange[]; newInstanceIds: string[]; imgConversions: string[] } {
  const parent = build.instances.find((i) => i.id === args.parentInstanceId);
  if (!parent) throw new Error(`Parent instance not found: ${args.parentInstanceId}`);

  const instancePatches: BuildPatchOperation[] = [];
  const selectionPatches: BuildPatchOperation[] = [];
  const newRefs: Array<{ type: "id"; value: string }> = [];
  const newInstanceIds: string[] = [];
  const imgConversions: string[] = [];

  for (const spec of args.children) {
    let tokenId: string | null = null;
    if (spec.tokenName) {
      const tok = build.styleSources.find((s) => s.type === "token" && s.name === spec.tokenName);
      if (!tok) throw new Error(`Token not found: ${spec.tokenName}`);
      tokenId = tok.id;
    }

    const childId = newId();
    // tag:"img" + generic component -> native Image component (v2.18.0 — raw
    // ws:element imgs lose the builder image panel, asset optimization and
    // audit coverage; see pattern image-component).
    const component = spec.component ?? args.defaultComponent ?? "ws:element";
    const isRawImg = spec.tag === "img" && (component === "ws:element" || component === "Box");
    const newChild = {
      type: "instance" as const,
      id: childId,
      component: isRawImg ? "Image" : component,
      ...(isRawImg ? {} : { tag: spec.tag }),
      ...(spec.label && { label: spec.label }),
      children: spec.text ? [{ type: "text" as const, value: spec.text }] : [],
    };
    if (isRawImg) imgConversions.push(childId);
    instancePatches.push({ op: "add", path: [childId], value: newChild });
    if (tokenId) {
      selectionPatches.push({ op: "add", path: [childId], value: { instanceId: childId, values: [tokenId] } });
    }
    newRefs.push({ type: "id", value: childId });
    newInstanceIds.push(childId);
  }

  // Update parent.children — single replace, batch children inserted consecutively.
  const newParentChildren = [...parent.children];
  if (typeof args.insertIndex === "number" && args.insertIndex >= 0 && args.insertIndex <= newParentChildren.length) {
    newParentChildren.splice(args.insertIndex, 0, ...newRefs);
  } else {
    newParentChildren.push(...newRefs);
  }
  instancePatches.push({ op: "replace", path: [args.parentInstanceId, "children"], value: newParentChildren });

  const changes: BuildPatchChange[] = [{ namespace: "instances", patches: instancePatches }];
  if (selectionPatches.length > 0) {
    changes.push({ namespace: "styleSourceSelections", patches: selectionPatches });
  }

  return { changes, newInstanceIds, imgConversions };
}

export const appendChildTool: ToolModule = {
  definition: {
    name: "webstudio_append_child",
    description: `Use when: add simple text elements (h2, p, span, button) under an existing parent — ONE element via tag/text, or N elements in ONE transaction via children:[{tag,text,…},…] (batch, v2.16.0).
Do NOT use when: you need a nested subtree, mixed content, multiple style sources, or layout containers — use webstudio_push_fragment (proper fragment builder with addInstance/addCard/addAccordion helpers). To duplicate an existing subtree elsewhere, use webstudio_clone_subtree. To insert a wrapper around an existing instance, use webstudio_wrap_instance.
Returns: dry-run summary with the generated childId(s) + parent + patches per namespace, OR push result with the new instanceId(s) + version.
component defaults to ws:element (top-level value = per-child default in batch form). tokenName resolves to the token's id (must exist). insertIndex inserts at position (default = append at end; batch children land consecutively).
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "acme", parentInstanceId: "hero", tag: "h2", text: "Subtitle", tokenName: "Heading 2" }
Example (batch): { projectSlug: "my-site", parentInstanceId: "nav", children: [{ tag: "a", text: "Accueil" }, { tag: "a", text: "Occasions" }, { tag: "a", text: "Contact" }] }`,
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
        children: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              tag: { type: "string" },
              text: { type: "string" },
              component: { type: "string" },
              label: { type: "string" },
              tokenName: { type: "string" },
            },
            required: ["tag"],
            additionalProperties: false,
          },
          description: "Batch form: append N simple children in ONE transaction, in order. Mutually exclusive with tag/text/label/tokenName.",
        },
        insertIndex: { type: "number" },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "parentInstanceId"],
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

    // Single form normalises to a 1-entry batch.
    const specs: AppendChildSpec[] = data.children ?? [{
      tag: data.tag!,
      text: data.text,
      label: data.label,
      tokenName: data.tokenName,
    }];
    const buildArgs = {
      parentInstanceId: data.parentInstanceId,
      children: specs,
      insertIndex: data.insertIndex,
      defaultComponent: data.component,
    };

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    let r;
    try { r = buildAppendChanges(build, buildArgs); }
    catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("Parent instance not found")) return errorResult("INSTANCE_NOT_FOUND", msg);
      if (msg.startsWith("Token not found")) return errorResult("TOKEN_NOT_FOUND", msg);
      return errorResult("INTERNAL_ERROR", msg);
    }

    if (r.imgConversions.length > 0) {
      void logCoerce("coerce:image-component", {
        source: "instances.append",
        projectSlug: data.projectSlug,
        count: r.imgConversions.length,
      });
    }
    const imgHint = r.imgConversions.length > 0
      ? `\n\n⚠ ${r.imgConversions.length} tag:"img" child(ren) created as the native Image component (src accepts asset | URL string — pattern image-component). Pass component:"Image" directly next time.`
      : "";
    const lines = specs.map((s, i) =>
      `  - ${s.tag}${s.text ? ` "${s.text.slice(0, 40)}"` : ""} (id ${r.newInstanceIds[i]})${s.tokenName ? ` token "${s.tokenName}"` : ""}`,
    );
    const summary = `${specs.length} new child(ren) under ${data.parentInstanceId}:\n${lines.join("\n")}${imgHint}`;

    if (data.dryRun) return textResult(`DRY-RUN append_child\n\n${summary}\n\nPatches:\n${r.changes.map((c) => `  - ${c.namespace}: ${c.patches.length}`).join("\n")}\n\nIf OK, re-run with dryRun=false.`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildAppendChanges(cur, buildArgs);
        const tx: BuildPatchTransaction = { id: `mcp-append-child-${txId()}`, payload: re.changes };
        return tx;
      });
      return textResult(`${specs.length} child(ren) appended — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}`);
    } catch (err) {
      return runtimeErrorResult(err, "Append failed");
    }
  },
};
