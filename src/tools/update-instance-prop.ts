// Tool: webstudio_instance_prop — surgical patch on an instance prop.
// Updates the value of an existing prop (href, src, alt, ariaLabel, etc.) without
// touching other props, text, styles, or structure.
//
// For internal page links, two formats are supported:
//   - {type:"string", value:"/contact"}      (direct URL path, simple)
//   - {type:"page", value:"<pageId>"}        (typed reference, rename-safe — value is the raw
//                                             pageId string, NOT an object wrapper)

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import { buildUpdatePropsTransaction } from "./update-instance-prop/build-patches.js";
import { assertSafeRadixProp } from "../lib/radix-wrappers.js";

const PropUpdateSchema = z.object({
  instanceId: z.string(),
  propName: z.string(),
  type: z
    .enum([
      "string", "number", "boolean", "json", "asset", "page", "string[]",
      "parameter", "resource", "expression", "action", "animationAction",
    ])
    .optional(),
  value: z.unknown(),
  createIfMissing: z.boolean().default(false),
  preserveExpressions: z.boolean().default(true),
  force: z.boolean().default(false),
  ignoreWrapperWarning: z.boolean().default(false),
}).strict();

export const updateInstancePropInputSchema = z.object({
  projectSlug: z.string(),
  updates: z.array(PropUpdateSchema).min(1),
  dryRun: z.boolean().default(true),
}).strict();

export const updateInstancePropTool: ToolModule = {
  definition: {
    name: "webstudio_update_instance_prop",
    description: `Use when: set a LITERAL prop value on an instance (href, src, alt, ariaLabel, role, asset id) without touching other props/text/styles.
Do NOT use when: the value must be a dynamic EXPRESSION (referencing a dataSource, variable, or resource) — use webstudio_instance_prop (which auto-handles dataSource ID encoding). To edit the visible text child, use webstudio_update_instance_text. To remove a prop row entirely, use webstudio_instance_prop (setting value="" here leaves an empty-string prop in build.props).
Returns: dry-run diff per update (old → new, "= already matches" no-ops, "!" failures) OR push result. Idempotent.
Missing prop skipped unless createIfMissing=true. preserveExpressions=true (default) refuses to overwrite an existing type=expression prop with a literal; pass force=true to override. For internal links: type="page" with value=<pageId> as a plain string (rename-safe, get pageId from webstudio_fetch_pages). For images: type="asset" with value=<sha256>.
Refuses class/className/style/id on Radix non-rendering wrappers (DialogTrigger, etc.) with RADIX_TRIGGER_POLLUTION (asChild merge bug — move the prop to the rendering child, or pass ignoreWrapperWarning=true per update).
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default.

Example: { projectSlug: "acme", updates: [{ instanceId: "abc", propName: "alt", value: "Hero image" }] }
Example: { projectSlug: "acme", updates: [{ instanceId: "abc", propName: "href", type: "page", value: "pg_contact" }] }`,
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
              propName: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "string", "number", "boolean", "json", "asset", "page", "string[]",
                  "parameter", "resource", "expression", "action", "animationAction",
                ],
              },
              value: {},
              createIfMissing: { type: "boolean" },
              preserveExpressions: { type: "boolean", description: "Refuse to overwrite an expression-bound prop with a different type. Default true." },
              force: { type: "boolean", description: "Bypass preserveExpressions safety check." },
              ignoreWrapperWarning: { type: "boolean", description: "Bypass the RADIX_TRIGGER_POLLUTION guard that refuses class/style/id on non-rendering Radix wrappers. Default false (recommended)." },
            },
            required: ["instanceId", "propName", "value"],
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
    const parsed = updateInstancePropInputSchema.safeParse(args);
    if (!parsed.success)
      return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
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

    // Refuse presentation props on Radix non-rendering wrappers (asChild merge
    // overwrites the child's Webstudio atomic hash class — SPA-navigation bug).
    const pollutionErrors: string[] = [];
    for (const u of updates) {
      if (u.ignoreWrapperWarning) continue;
      const inst = build.instances.find((i) => i.id === u.instanceId);
      if (!inst) continue; // handled by buildUpdatePropsTransaction below
      const check = assertSafeRadixProp(inst.component, u.propName);
      if (!check.ok) {
        pollutionErrors.push(
          `${u.instanceId} (${inst.component.split(":").pop()} "${inst.label ?? "?"}"):\n  ${check.reason}\n  → ${check.hint}`,
        );
      }
    }
    if (pollutionErrors.length > 0) {
      return errorResult(
        "RADIX_TRIGGER_POLLUTION",
        `${pollutionErrors.length} prop(s) refused on Radix non-rendering wrappers:\n\n${pollutionErrors.join("\n\n")}`,
      );
    }

    const tx = buildUpdatePropsTransaction(build, updates);

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
        `DRY-RUN update_instance_prop\n\n${tx.patchCount} patch(es) over ${updates.length} update(s):\n${tx.details.join("\n")}\n\nIf OK, re-run with dryRun=false.`,
      );
    }

    try {
      const { result, finalVersion } = await pushWithRetry(
        auth,
        (cur) => buildUpdatePropsTransaction(cur, updates).transaction,
      );
      return textResult(
        `${tx.patchCount} prop(s) updated — version → ${finalVersion}\nstatus: ${result.status}\n\n${tx.details.join("\n")}`,
      );
    } catch (err) {
      return runtimeErrorResult(err, "Update failed");
    }
  },
};
