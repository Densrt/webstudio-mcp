// Decode Webstudio expression-stored values and infer the top-level schema of
// arbitrary JSON.

/** Decode a Webstudio expression-stored value. If it's a JSON-encoded literal
 *  string, return the unquoted string. If it's an actual expression (variable
 *  reference, etc.), return it as `expression`. */
export function decodeStored(stored: string): { literal?: string; expression?: string } {
  if (typeof stored !== "string") return { literal: String(stored) };
  try {
    const parsed = JSON.parse(stored);
    if (typeof parsed === "string") return { literal: parsed };
    if (typeof parsed === "number" || typeof parsed === "boolean") return { literal: String(parsed) };
  } catch {
    /* not JSON */
  }
  return { expression: stored };
}

export function inferTopLevelSchema(value: unknown, depth = 0): string {
  if (depth > 3) return "...";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "Array(0)";
    return `Array(${value.length}) of ${inferTopLevelSchema(value[0], depth + 1)}`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    const lines = keys.slice(0, 30).map((k) => {
      const v = obj[k];
      let t: string;
      if (v === null) t = "null";
      else if (Array.isArray(v)) t = `Array(${v.length})`;
      else if (typeof v === "object") t = "Object";
      else t = typeof v;
      const sample = v !== null && typeof v !== "object"
        ? ` = ${JSON.stringify(v).slice(0, 80)}`
        : "";
      return `    ${k}: ${t}${sample}`;
    });
    if (keys.length > 30) lines.push(`    … (${keys.length - 30} more keys)`);
    return `{\n${lines.join("\n")}\n  }`;
  }
  return typeof value;
}
