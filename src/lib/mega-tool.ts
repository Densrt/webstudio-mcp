// Mega-tool dispatcher helpers (v1.0 prep).
//
// A mega-tool exposes a single MCP tool definition but routes to N internal action
// handlers via a discriminated-union input (`action: "create" | "update" | ...`).
// This module ships the type alias, the dispatcher, and a JSON Schema builder
// so each mega-tool stays lean (no boilerplate dispatch logic per file).

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorResult } from "../tools/types.js";

export type ActionHandler<T = unknown> = (input: T) => Promise<CallToolResult>;

/**
 * Dispatch a parsed input to its matching handler. Returns INVALID_ACTION if
 * the action key isn't in the handlers map. Callers MUST have parsed the input
 * (typically via a Zod discriminated union) before calling this.
 */
export async function dispatchAction<TInput extends { action: string }>(
  input: TInput,
  handlers: Record<string, ActionHandler<TInput>>,
): Promise<CallToolResult> {
  const handler = handlers[input.action];
  if (!handler) {
    const known = Object.keys(handlers).join(", ");
    return errorResult(
      "VALIDATION_FAILED",
      `Unknown action "${input.action}". Known actions: ${known}`,
    );
  }
  return handler(input);
}

export type ActionDef = {
  /** Discriminator value for this action (e.g. "create"). */
  action: string;
  /** Description rendered in the JSON Schema for documentation/agent guidance. */
  description: string;
  /** JSON Schema `properties` for THIS action's params (excluding `action` + `label`). */
  schema: Record<string, unknown>;
  /** Required property names within this action's schema (excluding `action` + `label`). */
  required?: string[];
};

/**
 * Action metadata kept alongside the flat JSON Schema. Consumed by `meta.index` and
 * `meta.get_more_tools` to count + BM25-rank actions without parsing the schema.
 * Not standard JSON Schema — Anthropic API tolerates extra top-level fields.
 */
export type ActionMeta = {
  action: string;
  description: string;
  required: string[];
  /** Per-action JSON schema property names (the keys the wrapper advertises for THIS
   *  action only). Excludes `action` + `label` which are always present at the mega-tool
   *  level. Used by `test/wrapper-schema-coherence.test.mjs` to assert wrapper-claimed
   *  params match the sub-handler's accepted params. */
  schemaKeys: string[];
};

/**
 * MCP Tool inputSchema shape — typed for the @modelcontextprotocol/sdk Tool definition.
 *
 * Flat schema (no top-level `oneOf` — Anthropic API rejects `oneOf/allOf/anyOf` at the
 * top of `tools[].custom.input_schema`). Per-action discrimination happens at runtime
 * via the Zod `discriminatedUnion` in each mega-tool's handler.
 */
export type MegaToolInputSchema = {
  type: "object";
  properties: Record<string, object>;
  required: string[];
  additionalProperties: boolean;
  /** Per-action metadata (action name + description + required-when-active). Non-standard. */
  xActions: ActionMeta[];
};

/**
 * Build the JSON Schema for a mega-tool's `inputSchema`. Returns a **flat** schema:
 *   - `action`: enum of all branch discriminator values, description concatenates each variant's docs
 *   - `label`: 3-30 chars action label
 *   - all branch properties merged by name (first-wins on conflicts)
 *   - `required: ["action", "label"]` — per-action required fields are enforced at
 *     runtime by the Zod discriminated union, not by JSON Schema (the API rejects
 *     `oneOf` at the top level so we can't express per-branch required[] there).
 *   - `xActions`: metadata for the `meta` mega-tool (index + BM25 ranking).
 */
export function buildJsonSchemaForActions(actions: ActionDef[]): MegaToolInputSchema {
  if (actions.length === 0) {
    throw new Error("buildJsonSchemaForActions: at least 1 action required");
  }
  const actionEnum = actions.map((a) => a.action);
  const actionDescription = actions
    .map((a) => `action="${a.action}" — ${a.description}`)
    .join("\n\n");
  const properties: Record<string, object> = {
    action: { type: "string", enum: actionEnum, description: actionDescription },
    label: {
      type: "string",
      minLength: 3,
      maxLength: 30,
      description: "Action label (3-30 chars, must be unique within a multi-action call).",
    },
    // `context` is mega-tool-level (declared in each mega-tool's Base Zod). Optional in
    // the JSON schema because the API rejects top-level oneOf/allOf/anyOf — we cannot
    // express "required IFF tier=CRITICAL" via the schema. The runtime validator
    // (lib/context-validator.ts) enforces the tier-based requirement and returns
    // CONTEXT_REQUIRED_FOR_CRITICAL when missing for a CRITICAL action.
    //
    // Without this property, `additionalProperties:false` rejects `context` before it
    // reaches the server (incident 2026-05-26: instances.delete unusable from the
    // caller despite the description listing context in the example).
    context: {
      type: "string",
      minLength: 60,
      maxLength: 200,
      description:
        "15-25 word third-person summary of WHY this call is being made. REQUIRED for CRITICAL actions (delete/replace/nuke/bulk_rename/migrate_token_selections — see each action's description for the explicit \"CRITICAL — context required\" marker). Recommended for STRUCTURING actions (returns a hint if missing). Optional for TACTICAL / READ-ONLY. No PII (no email/IP), no secrets (no token/password/api-key), no first-person pronouns (use \"the caller wants to...\" or \"the agent will...\").",
    },
  };
  for (const a of actions) {
    for (const [key, propSchema] of Object.entries(a.schema)) {
      if (key === "action" || key === "label") continue;
      if (!(key in properties) && propSchema !== null && typeof propSchema === "object") {
        properties[key] = propSchema as object;
      }
    }
  }
  const xActions: ActionMeta[] = actions.map((a) => ({
    action: a.action,
    description: a.description,
    required: a.required ?? [],
    schemaKeys: Object.keys(a.schema).filter((k) => k !== "action" && k !== "label"),
  }));
  return {
    type: "object",
    properties,
    required: ["action", "label"],
    additionalProperties: false,
    xActions,
  };
}
