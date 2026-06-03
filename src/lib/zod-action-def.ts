// v2.0 — derive a mega-tool's per-action JSON schema FROM the Zod schema of
// each atomic sub-handler, instead of writing it twice. This eliminates the
// wrapper/sub-handler drift class of bugs that produced 21 mismatches in v1.0.3.
//
// Source of truth = the Zod schema exported by the atomic. The mega-tool
// imports it and feeds it here. We produce an ActionDef shape that the
// existing buildJsonSchemaForActions consumes — keeping the Anthropic-API
// compatibility flattening (action enum + props merge + xActions metadata)
// unchanged.

import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { buildJsonSchemaForActions, type ActionDef, type MegaToolInputSchema } from "./mega-tool.js";

export type ZodActionDef = {
  /** Discriminator value for this action. */
  action: string;
  /** Description rendered in the JSON Schema and surfaced to the agent. */
  description: string;
  /**
   * Strict Zod schema of the atomic sub-handler's input — should NOT include
   * `action`/`label`/`context` (these are mega-tool-level, added separately by
   * buildJsonSchemaForActions).
   *
   * Convention: `.strict()` to enforce no extra keys, so the derived JSON
   * schema's `additionalProperties:false` matches Zod's runtime behaviour.
   */
  zod: ZodTypeAny;
};

type JsonSchemaShape = {
  properties?: Record<string, object>;
  required?: string[];
  // zod-to-json-schema may emit other top-level fields ($schema, type, additionalProperties, $ref…).
  // We only consume properties + required here; the rest is dropped by buildJsonSchemaForActions.
};

/**
 * Run `zodToJsonSchema` while filtering out the "Recursive reference detected"
 * `console.warn` noise. The library emits one warning per recursive ref found
 * (e.g. `StyleValueSchema` is a recursive `z.lazy(union(...))` — legitimate)
 * and the warnings end up on stderr at MCP boot, drowning the boot banner.
 *
 * We let the library default the recursive ref to `any` (its existing behavior
 * — perfectly acceptable for JSON schema discovery) but suppress the noise.
 * Other warnings pass through unchanged.
 */
function quietZodToJsonSchema(zod: ZodTypeAny, opts: Parameters<typeof zodToJsonSchema>[1]) {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string" && first.startsWith("Recursive reference detected at ")) return;
    originalWarn(...args);
  };
  try {
    return zodToJsonSchema(zod, opts);
  } finally {
    console.warn = originalWarn;
  }
}

/**
 * Convert a ZodActionDef into the shape consumed by buildJsonSchemaForActions.
 *
 * Uses zod-to-json-schema to derive `properties` and `required` from the Zod
 * schema. Strips any v3/v4 schema wrappers that zod-to-json-schema may emit
 * ($schema, definitions, $ref) — we want a flat object shape.
 *
 * Throws if the Zod schema doesn't produce a `properties` object (e.g. it's a
 * union or a primitive at the top level — sub-handler atomics must be objects).
 */
export function actionFromZod(def: ZodActionDef): ActionDef {
  // target: "jsonSchema7" produces draft-07 JSON Schema, which is the closest
  // compatible target with Anthropic's API requirement of "JSON Schema draft
  // 2020-12" (v2.1.0 used "openApi3" which emits `nullable:true` + OpenAPI-only
  // constructs the Anthropic API rejects). The flatten in buildJsonSchemaForActions
  // strips any top-level oneOf/allOf/anyOf either way.
  const json = quietZodToJsonSchema(def.zod, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as JsonSchemaShape;

  if (!json.properties || typeof json.properties !== "object") {
    throw new Error(
      `actionFromZod(${def.action}): derived JSON schema has no \`properties\` — ` +
        `sub-handler Zod must be a z.object(). Got: ${JSON.stringify(json).slice(0, 200)}`,
    );
  }

  return {
    action: def.action,
    description: def.description,
    schema: json.properties,
    required: json.required ?? [],
  };
}

/**
 * Build a mega-tool's flat JSON inputSchema from Zod action definitions.
 *
 * Equivalent to buildJsonSchemaForActions but driven by Zod schemas — the same
 * Zod that the runtime sub-handler uses to validate. Single source of truth
 * per action.
 */
export function buildJsonSchemaFromZodActions(defs: ZodActionDef[]): MegaToolInputSchema {
  return buildJsonSchemaForActions(defs.map(actionFromZod));
}
