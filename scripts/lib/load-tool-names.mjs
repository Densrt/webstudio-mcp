// Shared helper to load the set of valid tool names registered in src/index.ts.
//
// Post-v1.0 replacement for the old TOOL_CATEGORY map (src/tools/index-tool-categories.ts,
// removed). Scans `src/index.ts` for `import { xxxTool } from "./tools/<file>.js"` patterns
// and resolves each import to its `name: "..."` in the target file.
//
// Returns a Set of tool names exposed in the MCP manifest (e.g. "pages", "build", ...).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");

export function loadToolNames() {
  const indexSrc = readFileSync(join(ROOT, "src/index.ts"), "utf8");
  const names = new Set();
  const importRe = /from\s+"\.\/tools\/([^"]+)\.js"/g;
  const seenFiles = new Set();
  let m;
  while ((m = importRe.exec(indexSrc)) !== null) {
    const relPath = m[1];
    if (seenFiles.has(relPath)) continue;
    seenFiles.add(relPath);
    const filePath = join(ROOT, "src/tools", `${relPath}.ts`);
    if (!existsSync(filePath)) continue;
    const fileSrc = readFileSync(filePath, "utf8");
    // Match ONLY name fields that appear inside a `definition: { name: "..." }`
    // This avoids picking up sample `name:` values inside Example: {} blobs
    // in description strings (e.g. {name:"brand-primary"} in a CSS var example).
    const definitionNameRe = /definition\s*:\s*\{\s*name:\s*"([a-z][\w-]*)"/g;
    let nm;
    while ((nm = definitionNameRe.exec(fileSrc)) !== null) {
      const candidate = nm[1];
      // Skip atomic webstudio_* names (these are internal sub-handlers in v1.0)
      if (!candidate.startsWith("webstudio_")) names.add(candidate);
    }
    // Also support factory pattern: `return { definition: { name: "..." } }`
    // Used by makeMetaTool() — name appears inside the return statement.
    const factoryNameRe = /return\s*\{\s*definition\s*:\s*\{\s*name:\s*"([a-z][\w-]*)"/g;
    while ((nm = factoryNameRe.exec(fileSrc)) !== null) {
      const candidate = nm[1];
      if (!candidate.startsWith("webstudio_")) names.add(candidate);
    }
  }
  return names;
}
