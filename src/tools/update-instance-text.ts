// Tool: webstudio_update_instance_text — surgical patch on an instance's text.
// Modifies the "text" child of an instance without touching styles, props, or structure.
// Use cases: edit titles (h1/h2/h3), paragraphs, button labels of existing instances.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction, BuildPatchOperation } from "../webstudio-client.js";
import type { InstanceChild } from "../types.js";
import { encodeExpressionRefs } from "../utils/expression-encoding.js";
import { customAlphabet } from "nanoid";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);

const TextUpdateSchema = z.object({
  instanceId: z.string(),
  text: z.string(),
  /** Index of the text|expression child to replace if the instance has more than one. Default = 0 (first). */
  childIndex: z.number().int().min(0).optional(),
  /** "text" (default): replace by static text. "expression": replace by a dynamic expression child. */
  mode: z.enum(["text", "expression"]).default("text"),
}).strict();

export const updateInstanceTextInputSchema = z.object({
  projectSlug: z.string(),
  updates: z.array(TextUpdateSchema).min(1),
  dryRun: z.boolean().default(true),
}).strict();

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function buildUpdateTextTransaction(
  build: WebstudioBuild,
  updates: z.infer<typeof TextUpdateSchema>[],
): { transaction: BuildPatchTransaction; details: string[]; patchCount: number } {
  const patches: BuildPatchOperation[] = [];
  const details: string[] = [];

  // Group updates by instanceId so multiple updates on the same instance
  // accumulate in a single "replace children" patch instead of clobbering each other.
  const grouped = new Map<string, z.infer<typeof TextUpdateSchema>[]>();
  for (const u of updates) {
    const arr = grouped.get(u.instanceId) ?? [];
    arr.push(u);
    grouped.set(u.instanceId, arr);
  }

  for (const [instanceId, group] of grouped) {
    const inst = build.instances.find((i) => i.id === instanceId);
    if (!inst) {
      for (const u of group) {
        details.push(`! ${u.instanceId}: instance not found`);
      }
      continue;
    }

    // Working copy of children — accumulates updates targeting this instance.
    let workingChildren: InstanceChild[] = [...inst.children];
    let anyChange = false;

    for (const u of group) {
      const mode = u.mode ?? "text";

      // Recompute eligible indices on the working copy. The mapping is stable
      // when we only replace nodes in place (no insert/remove), but recomputing
      // keeps the logic correct should the patch shape ever change.
      const eligibleIndices: number[] = [];
      workingChildren.forEach((c, idx) => {
        if (c.type === "text" || c.type === "expression") eligibleIndices.push(idx);
      });

      const targetSlot = u.childIndex ?? 0;
      // Auto-encode `-` → `__DASH__` in dataSourceId refs (idempotent).
      // See src/utils/expression-encoding.ts — without this, Webstudio renders empty / NaN.
      const newValue = mode === "expression" ? encodeExpressionRefs(u.text) : u.text;
      const newChild: InstanceChild = mode === "expression"
        ? { type: "expression", value: newValue }
        : { type: "text", value: newValue };

      // CREATE mode: instance has zero text/expression children at this slot.
      // Common cases:
      //   - <a>/<button>/<div> created empty via instances.append (children: [])
      //   - container with only id children (e.g. <a><svg/></a>) and user wants to add a label
      // Behavior: append a new text/expression child after the existing children (or wherever
      // childIndex points — but only at the end of the eligible sequence, since we cannot
      // insert in the middle of unrelated structure without context).
      // Idempotence: a second identical call still finds the just-created child and no-ops.
      if (targetSlot >= eligibleIndices.length) {
        if (eligibleIndices.length === 0) {
          // No text/expr child exists — append one. childIndex must be 0 (or unspecified).
          if (targetSlot !== 0) {
            details.push(
              `! ${u.instanceId}: childIndex ${targetSlot} out of range (instance has no text/expression children — only childIndex 0 is valid to create one)`,
            );
            continue;
          }
          workingChildren = [...workingChildren, newChild];
          anyChange = true;
          const arrow = mode === "expression" ? "🔗" : "📝";
          details.push(
            `+ ${u.instanceId} (${inst.label ?? inst.component}): created ${arrow}${mode}"${truncate(u.text, 40)}" (was empty)`,
          );
          continue;
        }
        // Some text/expr children exist but childIndex > last existing slot → out-of-range.
        details.push(
          `! ${u.instanceId}: childIndex ${targetSlot} out of range (${eligibleIndices.length} text/expression children)`,
        );
        continue;
      }

      const targetChildIdx = eligibleIndices[targetSlot];
      const existing = workingChildren[targetChildIdx] as { type: "text" | "expression"; value: string };
      const oldRepr = `${existing.type}:${existing.value}`;
      const newRepr = `${newChild.type}:${(newChild as { value: string }).value}`;

      // Skip if identical (idempotence): same type + same value.
      if (oldRepr === newRepr) {
        details.push(`= ${u.instanceId} (${inst.label ?? inst.component}): already ${mode}="${truncate(u.text, 40)}", skip`);
        continue;
      }

      workingChildren = workingChildren.map((c, idx) =>
        idx === targetChildIdx ? newChild : c,
      );
      anyChange = true;

      const arrow = mode === "expression" ? "🔗" : "📝";
      details.push(
        `> ${u.instanceId} (${inst.label ?? inst.component}): ${existing.type}"${truncate(existing.value, 40)}" → ${arrow}${mode}"${truncate(u.text, 40)}"`,
      );
    }

    if (anyChange) {
      patches.push({
        op: "replace",
        path: [instanceId, "children"],
        value: workingChildren,
      });
    }
  }

  return {
    transaction: {
      id: `mcp-update-text-${txId()}`,
      payload: patches.length > 0 ? [{ namespace: "instances", patches }] : [],
    },
    details,
    patchCount: patches.length,
  };
}

export const updateInstanceTextTool: ToolModule = {
  definition: {
    name: "webstudio_update_instance_text",
    description: `Use when: edit the text node CHILD of an instance (h1/h2/p/button label) or convert a static text into a dynamic expression child.
Do NOT use when: you want to change an HTML attribute / Webstudio prop (alt, src, href, ariaLabel) — that's webstudio_instance_prop. For a dynamic-binding prop (not a text child), use webstudio_instance_prop. To rename the design-panel label, use webstudio_update_instance_label.
Returns: dry-run summary with per-update diff (old → new, "= already matches" for no-ops), OR push result with patch count + finalVersion. Idempotent (skips identical).
Replaces the first text|expression child by default; pass childIndex if the instance has multiple. mode="text" (default) sets a static text node; mode="expression" sets a dynamic-binding child where 'text' is the raw expression source.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "acme", updates: [{ instanceId: "abc", text: "New title" }] }
Example: { projectSlug: "acme", updates: [{ instanceId: "abc", mode: "expression", text: "$ws$dataSource$XYZ.data.title" }] }`,
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
              text: { type: "string" },
              childIndex: { type: "number" },
              mode: { type: "string", enum: ["text", "expression"] },
            },
            required: ["instanceId", "text"],
          },
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
    const parsed = updateInstanceTextInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, updates, dryRun } = parsed.data;

    let auth;
    try {
      auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build;
    try {
      build = await fetchBuild(auth);
    } catch (err) {
      return runtimeErrorResult(err, "fetch build failed");
    }

    const tx = buildUpdateTextTransaction(build, updates);

    if (tx.patchCount === 0) {
      const hasFailure = tx.details.some((d) => d.startsWith("!"));
      if (hasFailure) {
        const firstFail = tx.details.find((d) => d.startsWith("!")) ?? "";
        const code = firstFail.includes("instance not found") ? "INSTANCE_NOT_FOUND" : "VALIDATION_FAILED";
        return errorResult(code, `No patches generated:\n${tx.details.join("\n")}`);
      }
      return textResult(`No-op (all updates already match):\n${tx.details.join("\n")}`);
    }

    if (dryRun) {
      return textResult(
        `DRY-RUN update_instance_text\n\n${tx.patchCount} patch(es) over ${updates.length} update(s):\n${tx.details.join("\n")}\n\nIf OK, re-run with dryRun=false.`,
      );
    }

    try {
      const { result, finalVersion } = await pushWithRetry(
        auth,
        (cur) => buildUpdateTextTransaction(cur, updates).transaction,
      );
      return textResult(
        `${tx.patchCount} text(s) updated — version → ${finalVersion}\nstatus: ${result.status}\n\n${tx.details.join("\n")}`,
      );
    } catch (err) {
      return runtimeErrorResult(err, "Update failed");
    }
  },
};
