// Tool: webstudio_instance_prop — bind an instance prop (alt, src, href, ariaLabel...)
// to a JS expression that may reference dataSources/variables/resources.
//
// Symmetric to webstudio_bind_page_field but targets instance props instead of page meta.
// Forces type=expression. Handles dataSource ID encoding (`-` → `__DASH__`) automatically.

import { z } from "zod";
import { BindingSchema } from "../lib/zod-binding.js";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type { WebstudioBuild, BuildPatchTransaction, BuildPatchOperation } from "../webstudio-client.js";
import { bindingToExpression, lintBinding, type Binding } from "../expressions.js";
import { lintShowBinding } from "../lib/lint-show-binding.js";
import { assertSafeRadixProp } from "../lib/radix-wrappers.js";
import { logCoerce } from "../lib/telemetry.js";

const txId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);
const newPropId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 21);


export const bindInstancePropInputSchema = z.object({
  projectSlug: z.string(),
  instanceId: z.string(),
  /** Prop name to bind (e.g. "alt", "src", "href", "ariaLabel"). */
  propName: z.string(),
  binding: BindingSchema,
  /** If the prop doesn't exist, create it (default true). Set false to fail if missing. */
  createIfMissing: z.boolean().default(true),
  ignoreWrapperWarning: z.boolean().default(false),
  dryRun: z.boolean().default(false),
}).strict();

function validateDataSourceRefs(build: WebstudioBuild, binding: Binding): string | null {
  const ids: string[] = [];
  if (binding.kind === "variable") ids.push(binding.dataSourceId);
  if (binding.kind === "template") {
    for (const p of binding.parts) if (p.type === "variable") ids.push(p.dataSourceId);
  }
  if (ids.length === 0) return null;
  const dataSources = (build as unknown as { dataSources?: Array<{ id: string }> }).dataSources ?? [];
  const known = new Set(dataSources.map((d) => d.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length > 0) return `dataSourceId(s) not found in build: ${missing.join(", ")}`;
  return null;
}

function buildPatches(
  build: WebstudioBuild,
  args: z.infer<typeof bindInstancePropInputSchema>,
): { patch: BuildPatchOperation; expression: string; created: boolean; showLint?: ReturnType<typeof lintShowBinding> } {
  let expression = bindingToExpression(args.binding);
  // data-ws-show MUST resolve to a boolean (v2.19.0 — see lib/lint-show-binding).
  let showLint: ReturnType<typeof lintShowBinding> | undefined;
  if (args.propName === "data-ws-show") {
    showLint = lintShowBinding(expression);
    if (showLint.kind === "fixed") expression = showLint.expression;
  }
  const existing = build.props.find((p) => p.instanceId === args.instanceId && p.name === args.propName);

  if (!existing) {
    if (!args.createIfMissing) {
      throw new Error(`Prop "${args.propName}" not found on instance ${args.instanceId}. Pass createIfMissing=true to create it.`);
    }
    const newProp = {
      id: newPropId(),
      instanceId: args.instanceId,
      name: args.propName,
      type: "expression",
      value: expression,
    };
    return {
      patch: { op: "add", path: [newProp.id], value: newProp },
      expression,
      created: true,
      showLint,
    };
  }
  return {
    patch: { op: "replace", path: [existing.id], value: { ...existing, type: "expression", value: expression } },
    expression,
    created: false,
    showLint,
  };
}

export const bindInstancePropTool: ToolModule = {
  definition: {
    name: "webstudio_bind_instance_prop",
    description: `Use when: bind an instance prop (alt, src, href, ariaLabel, content) to a DYNAMIC expression referencing a dataSource / variable / resource.
Do NOT use when: the value is a literal string/number/asset id — use webstudio_instance_prop (faster, no expression parsing). For page meta fields (title, description, OG image), use webstudio_bind_page_field (same API shape).
Returns: dry-run summary with the compiled expression string, OR push result with version. Forces type=expression on the prop; createIfMissing=true by default. Auto-handles dataSource ID encoding (- → __DASH__).

WARNING — resources are wrapped in {ok, status, data} by Webstudio at runtime. To read a resource field, the expression path MUST start with .data. (e.g. resource.data.title, NOT resource.title — the latter evaluates to undefined). Variables and parameters have no such wrapper.

Three binding shapes:
  - {kind:"variable", dataSourceId, path?: ["data","items",0,"title"]}
  - {kind:"template", parts:[{type:"text", value:"Prix: "}, {type:"variable", dataSourceId, path:["data","price"]}]}
  - {kind:"raw", expression: "$ws$dataSource$ABC.data.title.toUpperCase()"}
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=false by default for this tool.

Example: { projectSlug: "acme", instanceId: "img1", propName: "alt", binding: { kind: "variable", dataSourceId: "ds_product", path: ["data", "name"] } }
Example: { projectSlug: "my-site", instanceId: "h1", propName: "ariaLabel", binding: { kind: "raw", expression: "$ws$dataSource$XYZ.data.title" } }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        instanceId: { type: "string" },
        propName: { type: "string" },
        binding: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["variable", "template", "raw"] },
            dataSourceId: { type: "string" },
            path: { type: "array" },
            parts: { type: "array" },
            expression: { type: "string" },
          },
          required: ["kind"],
        },
        createIfMissing: { type: "boolean" },
        ignoreWrapperWarning: { type: "boolean", description: "Bypass the RADIX_TRIGGER_POLLUTION guard that refuses class/style/id binding on non-rendering Radix wrappers. Default false." },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "instanceId", "propName", "binding"],
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
    const parsed = bindInstancePropInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    // Lint a hand-written `raw` expression against Webstudio's allowlist (see lib/lint-expression).
    // error = unparseable → refuse (would break the published build). warning = runs at runtime but
    // the editor flags it → pass through + educate via response hint + telemetry.
    const lint = lintBinding(data.binding);
    if (lint?.severity === "error") return errorResult("EXPRESSION_INVALID", lint.message, lint.hint);
    if (lint?.severity === "warning") {
      void logCoerce(lint.telemetryKey, {
        source: "instances.prop_bind",
        projectSlug: data.projectSlug,
        instanceId: data.instanceId,
        propName: data.propName,
        violations: lint.violations.map((v) => `${v.type}:${v.detail}`),
      });
    }
    const lintNote = lint?.severity === "warning" ? `\n\n⚠️  ${lint.hint}` : "";

    let auth;
    try { auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug); }
    catch (err) { return authErrorResult(err); }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const inst = build.instances.find((i) => i.id === data.instanceId);
    if (!inst) {
      return errorResult("INSTANCE_NOT_FOUND", `Instance "${data.instanceId}" not found`);
    }
    // Refuse presentation props on Radix non-rendering wrappers — see error-codes.ts.
    if (!data.ignoreWrapperWarning) {
      const check = assertSafeRadixProp(inst.component, data.propName);
      if (!check.ok) {
        return errorResult(
          "RADIX_TRIGGER_POLLUTION",
          `${inst.component.split(":").pop()} "${inst.label ?? data.instanceId}":\n  ${check.reason}\n\nHint: ${check.hint}`,
        );
      }
    }
    const refError = validateDataSourceRefs(build, data.binding);
    if (refError) return errorResult("VARIABLE_NOT_FOUND", refError);

    let r;
    try { r = buildPatches(build, data); }
    catch (err) { return errorResult("VALIDATION_FAILED", (err as Error).message); }

    let showNote = "";
    if (r.showLint && r.showLint.kind !== "clean") {
      void logCoerce(r.showLint.telemetryKey, {
        source: "instances.prop_bind",
        projectSlug: data.projectSlug,
        instanceId: data.instanceId,
      });
      showNote = `\n\n⚠️  ${r.showLint.hint}`;
    }

    const summary = `${r.created ? "Created" : "Replaced"} prop "${data.propName}" on ${data.instanceId}
  expression: ${r.expression}`;

    if (data.dryRun) return textResult(`DRY-RUN bind_instance_prop\n\n${summary}\n\nIf OK, re-run with dryRun=false.${lintNote}${showNote}`);

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const re = buildPatches(cur, data);
        const tx: BuildPatchTransaction = {
          id: `mcp-bind-prop-${txId()}`,
          payload: [{ namespace: "props", patches: [re.patch] }],
        };
        return tx;
      });
      return textResult(`Prop bound — version → ${finalVersion}\nstatus: ${result.status}\n\n${summary}${lintNote}${showNote}`);
    } catch (err) {
      return runtimeErrorResult(err, "Bind failed");
    }
  },
};
