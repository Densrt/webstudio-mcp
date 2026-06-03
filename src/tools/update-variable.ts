// Tool: webstudio_update_variable — change the value or name of an existing variable
// (dataSource of type "variable"). Find by id OR name.
//
// Use cases: update site-wide config (email, phone, place ID, language) without going through
// the Webstudio UI. Idempotent.

import { z } from "zod";
import { customAlphabet } from "nanoid";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type {
  WebstudioBuild,
  BuildPatchTransaction,
  BuildPatchOperation,
} from "../webstudio-client.js";

const txId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

type Variable = {
  type: "variable";
  id: string;
  scopeInstanceId: string;
  name: string;
  value: { type: string; value: unknown };
};

export const updateVariableInputSchema = z
  .object({
    projectSlug: z.string(),
    dataSourceId: z.string().optional(),
    name: z.string().optional().describe("Find by current name (case-sensitive). Useful when id unknown."),
    /** New name. */
    newName: z.string().optional(),
    /** New value. Provide both type and value. */
    value: z
      .discriminatedUnion("type", [
        z.object({ type: z.literal("string"), value: z.string() }),
        z.object({ type: z.literal("number"), value: z.number() }),
        z.object({ type: z.literal("boolean"), value: z.boolean() }),
        z.object({ type: z.literal("json"), value: z.unknown() }),
      ])
      .optional(),
    dryRun: z.boolean().default(true),
  }).strict()
  .refine((d) => d.dataSourceId || d.name, { message: "Provide dataSourceId or name" })
  .refine((d) => d.newName !== undefined || d.value !== undefined, {
    message: "Provide newName or value (or both)",
  });

function describe(v: Variable): string {
  return `"${v.name}" (${v.value.type}=${JSON.stringify(v.value.value)})`;
}

function buildUpdateVariableTransaction(
  build: WebstudioBuild,
  input: z.infer<typeof updateVariableInputSchema>,
): {
  transaction: BuildPatchTransaction;
  details: string[];
  patchCount: number;
} {
  const dataSources = (build as unknown as { dataSources: Variable[] }).dataSources ?? [];
  const candidates = dataSources.filter((d) => d.type === "variable");
  const target = candidates.find(
    (d) => (input.dataSourceId && d.id === input.dataSourceId) || (input.name && d.name === input.name),
  );

  if (!target) {
    return {
      transaction: { id: `mcp-update-var-${txId()}`, payload: [] },
      details: [
        `! Variable not found. Available:`,
        ...candidates.map((v) => `  - ${describe(v)}  id=${v.id}`),
      ],
      patchCount: 0,
    };
  }

  // Resolve duplicate name match
  const matches = candidates.filter(
    (d) => (input.dataSourceId && d.id === input.dataSourceId) || (input.name && d.name === input.name),
  );
  if (matches.length > 1) {
    return {
      transaction: { id: `mcp-update-var-${txId()}`, payload: [] },
      details: [
        `! Multiple variables match (${matches.length}). Use dataSourceId to disambiguate:`,
        ...matches.map((v) => `  - ${describe(v)}  id=${v.id}  scope=${v.scopeInstanceId}`),
      ],
      patchCount: 0,
    };
  }

  const updated: Variable = { ...target };
  const details: string[] = [`Variable [${target.id}]:`];

  if (input.newName !== undefined && input.newName !== target.name) {
    details.push(`  name: "${target.name}" → "${input.newName}"`);
    updated.name = input.newName;
  }

  if (input.value !== undefined) {
    const sameType = input.value.type === target.value.type;
    const sameValue = JSON.stringify(input.value.value) === JSON.stringify(target.value.value);
    if (sameType && sameValue) {
      details.push(`  = value already ${target.value.type}=${JSON.stringify(target.value.value)}`);
    } else {
      details.push(
        `  value: ${target.value.type}=${JSON.stringify(target.value.value)} → ${input.value.type}=${JSON.stringify(input.value.value)}`,
      );
      updated.value = { type: input.value.type, value: input.value.value };
    }
  }

  if (JSON.stringify(target) === JSON.stringify(updated)) {
    return {
      transaction: { id: `mcp-update-var-${txId()}`, payload: [] },
      details: [`= No changes for variable ${describe(target)}`],
      patchCount: 0,
    };
  }

  const patches: BuildPatchOperation[] = [
    { op: "replace", path: [target.id], value: updated },
  ];

  return {
    transaction: {
      id: `mcp-update-var-${txId()}`,
      payload: [{ namespace: "dataSources", patches }],
    },
    details,
    patchCount: 1,
  };
}

export const updateVariableTool: ToolModule = {
  definition: {
    name: "webstudio_update_variable",
    description: `Use when: change a variable's name and/or value (site-wide config rotation: new email, new phone, toggle a flag).
Do NOT use when: you need to change an HTTP resource's URL/headers — use webstudio_update_resource. To delete, use webstudio_delete_variables.
Returns: { details, version } — patchCount=0 means no-op (same value). Reports ambiguous-name conflicts before patching.
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. Idempotent.

Example: { projectSlug: "acme", name: "contactEmail", value: { type: "string", value: "new@acme.com" } }
Example: { projectSlug: "my-site", dataSourceId: "abc123", newName: "phoneNumber" }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        dataSourceId: { type: "string" },
        name: { type: "string", description: "Find by current name (case-sensitive). Useful when id unknown." },
        newName: { type: "string" },
        value: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["string", "number", "boolean", "json"] },
            value: {},
          },
          required: ["type", "value"],
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug"],
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
    const parsed = updateVariableInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const data = parsed.data;

    let auth;
    try {
      auth = data.dryRun ? requireAuth(data.projectSlug) : requirePushAuth(data.projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build: WebstudioBuild;
    try {
      build = await fetchBuild(auth);
    } catch (err) {
      return runtimeErrorResult(err, "fetch build failed");
    }

    const tx = buildUpdateVariableTransaction(build, data);
    if (tx.patchCount === 0) {
      const isError = tx.details[0]?.startsWith("!") ?? false;
      if (isError) {
        const first = tx.details[0] ?? "";
        if (first.startsWith("! Variable not found")) return errorResult("VARIABLE_NOT_FOUND", tx.details.join("\n"));
        if (first.startsWith("! Multiple variables")) return errorResult("VALIDATION_FAILED", tx.details.join("\n"));
        return errorResult("INTERNAL_ERROR", tx.details.join("\n"));
      }
      return textResult(tx.details.join("\n"));
    }

    if (data.dryRun) {
      return textResult(
        `DRY-RUN update_variable\n\n${tx.details.join("\n")}\n\nIf OK, re-run with dryRun=false.`,
      );
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) =>
        buildUpdateVariableTransaction(cur, data).transaction,
      );
      return textResult(
        `Variable updated — version → ${finalVersion}\nstatus: ${result.status}\n\n${tx.details.join("\n")}`,
      );
    } catch (err) {
      return runtimeErrorResult(err, "Update failed");
    }
  },
};
