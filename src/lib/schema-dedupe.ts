// Wire-schema structural dedupe (v2.17.0 — item 7 of the 2026-06-10 audit).
//
// zod-to-json-schema ($refStrategy:"none") inlines every shape at every use
// site: the StyleValue union alone repeats across styles/tokens/cloudTokens/
// pattern in the `build` tool (~29k chars of pure structure, zero
// descriptions). This pass hoists repeated SCHEMA subtrees into top-level
// `$defs` and replaces occurrences with `$ref` — lossless JSON Schema,
// applied ONLY at the wire boundary (in-memory schemas stay inlined for the
// guard tests and meta BM25).
//
// Position-aware traversal: only nodes in schema position are hoistable.
// The value of `properties` is a keyword MAP (its values are schemas, the
// map itself is not); `default`/`const`/`enum` subtrees are DATA — a $ref
// there would be semantically wrong.
//
// Anthropic-API note: the known restriction is top-level oneOf/allOf/anyOf.
// $defs + internal $ref are standard and widely emitted (Pydantic/FastMCP).

const MIN_NODE_CHARS = 150; // don't hoist trivia — a $ref costs ~25 chars
const MIN_OCCURRENCES = 2;

/** Keywords whose value is a map of <name> → schema. */
const SCHEMA_MAP_KEYS = new Set(["properties", "patternProperties", "$defs", "definitions"]);
/** Keywords whose value is a schema (object) — or an array of schemas. */
const SCHEMA_KEYS = new Set([
  "items", "additionalProperties", "additionalItems", "not", "propertyNames",
  "contains", "if", "then", "else",
]);
/** Keywords whose value is a list of schemas. */
const SCHEMA_LIST_KEYS = new Set(["anyOf", "allOf", "oneOf", "prefixItems"]);

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Visit every schema-position object node (bottom-up on children first). */
function visitSchemas(node: unknown, visit: (schema: Json) => void): void {
  if (!isObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (SCHEMA_MAP_KEYS.has(key) && isObject(value)) {
      for (const sub of Object.values(value)) visitSchemas(sub, visit);
    } else if (SCHEMA_LIST_KEYS.has(key) && Array.isArray(value)) {
      for (const sub of value) visitSchemas(sub, visit);
    } else if (SCHEMA_KEYS.has(key)) {
      if (Array.isArray(value)) for (const sub of value) visitSchemas(sub, visit);
      else visitSchemas(value, visit);
    }
    // everything else (default, const, enum, description, required, …) = data — skip
  }
  visit(node);
}

/** Rebuild the tree, replacing schema-position nodes found in `byJson` with $refs. */
function replaceSchemas(node: unknown, byJson: Map<string, string>): unknown {
  if (!isObject(node)) return node;
  const json = JSON.stringify(node);
  const defName = byJson.get(json);
  if (defName) return { $ref: `#/$defs/${defName}` };
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (SCHEMA_MAP_KEYS.has(key) && isObject(value)) {
      const map: Json = {};
      for (const [name, sub] of Object.entries(value)) map[name] = replaceSchemas(sub, byJson);
      out[key] = map;
    } else if (SCHEMA_LIST_KEYS.has(key) && Array.isArray(value)) {
      out[key] = value.map((sub) => replaceSchemas(sub, byJson));
    } else if (SCHEMA_KEYS.has(key)) {
      out[key] = Array.isArray(value)
        ? value.map((sub) => replaceSchemas(sub, byJson))
        : replaceSchemas(value, byJson);
    } else {
      out[key] = value; // data — copied as-is
    }
  }
  return out;
}

/**
 * Hoist repeated schema subtrees (≥150 chars, ≥2 occurrences) into `$defs`
 * + `$ref`. Iterates to a fixpoint so def bodies can reference smaller defs.
 * Deterministic (defs named d1, d2… in size order) — same input, same wire
 * bytes. Returns the input untouched (same reference) when nothing repeats.
 */
export function dedupeSchemaDefs<T extends Record<string, unknown>>(schema: T): T {
  let current: Json = schema;
  const defs: Json = {};
  let defCounter = 0;

  for (let pass = 0; pass < 10; pass++) {
    const counts = new Map<string, number>();
    const count = (n: Json) => {
      const json = JSON.stringify(n);
      if (json.length >= MIN_NODE_CHARS) counts.set(json, (counts.get(json) ?? 0) + 1);
    };
    visitSchemas(current, count);
    for (const body of Object.values(defs)) visitSchemas(body, count);

    // Largest first: a big duplicate absorbs its smaller inner duplicates;
    // the next pass catches what remains inside the hoisted bodies.
    const existingBodies = new Set(Object.values(defs).map((d) => JSON.stringify(d)));
    const repeated = [...counts.entries()]
      .filter(([json, n]) => n >= MIN_OCCURRENCES && !existingBodies.has(json))
      .sort((a, b) => b[0].length - a[0].length);
    if (repeated.length === 0) break;

    const byJson = new Map<string, string>();
    for (const [json] of repeated) {
      defCounter += 1;
      byJson.set(json, `d${defCounter}`);
    }

    current = replaceSchemas(current, byJson) as Json;
    for (const [json, name] of byJson) {
      // Inside a def body, smaller hoisted shapes become refs too — but a
      // body must not collapse into a ref to itself.
      const inner = new Map([...byJson].filter(([j]) => j !== json));
      defs[name] = replaceSchemas(JSON.parse(json), inner);
    }
    for (const [name, body] of Object.entries(defs)) {
      if (byJson.has(JSON.stringify(body))) continue; // freshly written above
      const selfJson = JSON.stringify(body);
      const inner = new Map([...byJson].filter(([j]) => j !== selfJson));
      defs[name] = replaceSchemas(body, inner);
    }
  }

  if (defCounter === 0) return schema;
  return { ...current, $defs: defs } as unknown as T;
}
