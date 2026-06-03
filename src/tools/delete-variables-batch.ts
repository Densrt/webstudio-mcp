// Tool: webstudio_delete_variables — batch deletion of dataSource variables with continue-on-error.
//
// Difference vs. webstudio_delete_variable: takes an array of ids OR names, builds ONE consolidated
// transaction with all valid removals, and pushes it once. Each item is processed independently —
// a failure on one item (not found, ambiguous name, referenced without force) is reported in the
// "failed" list without aborting the rest. Only items that resolve cleanly contribute patches.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth, requirePushAuth } from "../auth.js";
import { fetchBuild, pushWithRetry } from "../webstudio-client.js";
import type {
  WebstudioBuild,
  BuildPatchTransaction,
  BuildPatchChange,
  BuildPatchOperation,
} from "../webstudio-client.js";
import { txId } from "./pages/ids.js";

export const deleteVariablesBatchInputSchema = z.object({
  projectSlug: z.string(),
  dataSourceIdsOrNames: z.array(z.string()).min(1),
  force: z.boolean().default(false),
  dryRun: z.boolean().default(true),
}).strict();

type Variable = {
  type: string;
  id: string;
  scopeInstanceId: string;
  name: string;
  value?: { type: string; value: unknown };
};

type Succeeded = { input: string; id: string; name: string; refCount: number };
type Failed = { input: string; reason: string };

type Plan = {
  changes: BuildPatchChange[];
  succeeded: Succeeded[];
  failed: Failed[];
};

/** Same dual-encoding scan as delete-variable.ts (raw id + __DASH__-escaped id). */
function findReferences(build: WebstudioBuild, id: string): string[] {
  const escapedId = id.replace(/-/g, "__DASH__");
  const refs: string[] = [];

  for (const ds of (build as unknown as { dataSources: Variable[] }).dataSources ?? []) {
    if (ds.id === id) continue;
    const s = JSON.stringify(ds);
    if (s.includes(id) || s.includes(escapedId)) {
      refs.push(`dataSource ${ds.id} ("${ds.name}")`);
    }
  }

  for (const r of (build as unknown as { resources?: Array<Record<string, unknown>> }).resources ?? []) {
    const s = JSON.stringify(r);
    if (s.includes(id) || s.includes(escapedId)) {
      refs.push(`resource ${r.id} ("${r.name}")`);
    }
  }

  for (const p of build.props) {
    const s = JSON.stringify(p.value);
    if (s.includes(id) || s.includes(escapedId)) {
      refs.push(`prop ${p.name} on instance ${p.instanceId}`);
    }
  }

  for (const inst of build.instances) {
    for (const c of inst.children ?? []) {
      if (c.type === "expression" && typeof c.value === "string") {
        if (c.value.includes(id) || c.value.includes(escapedId)) {
          refs.push(`expression child of instance ${inst.id} (${inst.label || inst.component})`);
        }
      }
    }
  }

  return refs;
}

/**
 * Build a consolidated transaction's changes from a list of variable targets.
 * Each input is resolved independently — only clean hits contribute patches.
 */
function planDeleteVariables(
  build: WebstudioBuild,
  inputs: string[],
  force: boolean,
): Plan {
  const dataSources = (build as unknown as { dataSources: Variable[] }).dataSources ?? [];
  const variables = dataSources.filter((d) => d.type === "variable");

  const succeeded: Succeeded[] = [];
  const failed: Failed[] = [];
  const removePatches: BuildPatchOperation[] = [];

  const seenIds = new Set<string>();
  const seenInputs = new Set<string>();

  for (const input of inputs) {
    if (seenInputs.has(input)) {
      failed.push({ input, reason: "duplicate in batch (skipped)" });
      continue;
    }
    seenInputs.add(input);

    // Match by id first, then by name (only among variables).
    const byId = variables.find((v) => v.id === input);
    const byName = byId ? [] : variables.filter((v) => v.name === input);

    let target: Variable | undefined;
    if (byId) {
      target = byId;
    } else if (byName.length === 1) {
      target = byName[0];
    } else if (byName.length === 0) {
      failed.push({ input, reason: "not found" });
      continue;
    } else {
      const ids = byName.map((v) => v.id).join(", ");
      failed.push({ input, reason: `ambiguous (matches: ${ids})` });
      continue;
    }

    if (seenIds.has(target.id)) {
      failed.push({ input, reason: `duplicate target ${target.id} (already in batch)` });
      continue;
    }

    const refs = findReferences(build, target.id);
    if (refs.length > 0 && !force) {
      failed.push({
        input,
        reason: `has ${refs.length} reference(s): [${refs.join("; ")}]`,
      });
      continue;
    }

    seenIds.add(target.id);
    removePatches.push({ op: "remove", path: [target.id] });
    succeeded.push({
      input,
      id: target.id,
      name: target.name,
      refCount: refs.length,
    });
  }

  const changes: BuildPatchChange[] = [];
  if (removePatches.length > 0) {
    changes.push({ namespace: "dataSources", patches: removePatches });
  }

  return { changes, succeeded, failed };
}

function buildTransaction(changes: BuildPatchChange[]): BuildPatchTransaction {
  return {
    id: `mcp-delete-vars-${txId()}`,
    payload: changes,
  };
}

function renderReport(succeeded: Succeeded[], failed: Failed[]): string {
  const lines: string[] = [];
  lines.push(`✅ Succeeded (${succeeded.length})`);
  for (const s of succeeded) {
    const refNote = s.refCount > 0 ? `  ⚠ ${s.refCount} dangling ref(s)` : "";
    lines.push(`  ✓ "${s.name}" (id=${s.id})  input="${s.input}"${refNote}`);
  }
  lines.push(`\n❌ Failed (${failed.length})`);
  for (const f of failed) {
    lines.push(`  ✗ "${f.input}" — ${f.reason}`);
  }
  return lines.join("\n");
}

export const deleteVariablesBatchTool: ToolModule = {
  definition: {
    name: "webstudio_delete_variables",
    description: `Use when: delete several variables at once (cleanup after refactor, batch remove dead config). Continue-on-error: bad targets are skipped and reported.
Do NOT use when: deleting HTTP resources — use webstudio_delete_resource instead. For a single variable, pass [singleIdOrName]. Each input can be a dataSourceId OR a unique name.
Returns: { succeeded:[{input,id,name,refCount}], failed:[{input,reason}] }. Refuses items with references unless force=true (then leaves dangling refs).
Side effects: push to Webstudio Cloud (requires allowPush). dryRun=true by default. Single consolidated transaction.

Example: { projectSlug: "acme", dataSourceIdsOrNames: ["oldEmail", "deprecatedFlag", "abc123"] }
Example: { projectSlug: "my-site", dataSourceIdsOrNames: ["legacyVar"], force: true, dryRun: false }`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        dataSourceIdsOrNames: {
          type: "array",
          items: { type: "string" },
          description: "List of dataSourceIds or variable names (mixed allowed).",
        },
        force: {
          type: "boolean",
          description: "Delete variables even if referenced (will leave dangling refs).",
        },
        dryRun: { type: "boolean" },
      },
      required: ["projectSlug", "dataSourceIdsOrNames"],
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
    const parsed = deleteVariablesBatchInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const { projectSlug, dataSourceIdsOrNames, force, dryRun } = parsed.data;

    let auth;
    try {
      auth = dryRun ? requireAuth(projectSlug) : requirePushAuth(projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build;
    try { build = await fetchBuild(auth); }
    catch (err) { return runtimeErrorResult(err, "fetch build failed"); }

    const plan = planDeleteVariables(build, dataSourceIdsOrNames, force);

    if (plan.succeeded.length === 0) {
      return textResult(
        `DRY-RUN delete_variables — nothing to delete.\n\n${renderReport(plan.succeeded, plan.failed)}`,
      );
    }

    if (dryRun) {
      return textResult(
        `DRY-RUN delete_variables (${plan.succeeded.length} variable(s) will be deleted)\n\n${renderReport(plan.succeeded, plan.failed)}\n\nIf OK, re-run with dryRun=false.`,
      );
    }

    try {
      const { result, finalVersion } = await pushWithRetry(auth, (cur) => {
        const fresh = planDeleteVariables(cur, dataSourceIdsOrNames, force);
        return buildTransaction(fresh.changes);
      });
      return textResult(
        `Batch delete_variables — version → ${finalVersion}  status: ${result.status}\n\n${renderReport(plan.succeeded, plan.failed)}`,
      );
    } catch (err) {
      return runtimeErrorResult(err, "Push failed");
    }
  },
};
