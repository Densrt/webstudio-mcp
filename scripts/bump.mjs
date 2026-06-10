#!/usr/bin/env node
// Sync version across package.json + src/index.ts in one command.
//
// Usage:
//   node scripts/bump.mjs patch   # 1.3.0 → 1.3.1
//   node scripts/bump.mjs minor   # 1.3.0 → 1.4.0
//   node scripts/bump.mjs major   # 1.3.0 → 2.0.0
//   node scripts/bump.mjs 1.5.2   # explicit version
//
// CI already enforces version consistency (mcp-health.yml). This script is the
// preventive companion — never get a CI fail because src/index.ts was forgotten.

import { readFile, writeFile } from "node:fs/promises";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/bump.mjs <patch|minor|major|x.y.z>");
  process.exit(1);
}

const PKG_PATH = "package.json";
const SRC_PATH = "src/index.ts";

const pkg = JSON.parse(await readFile(PKG_PATH, "utf-8"));
const current = pkg.version;
const [maj, min, pat] = current.split(".").map(Number);

let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg;
} else if (arg === "patch") {
  next = `${maj}.${min}.${pat + 1}`;
} else if (arg === "minor") {
  next = `${maj}.${min + 1}.0`;
} else if (arg === "major") {
  next = `${maj + 1}.0.0`;
} else {
  console.error(`Invalid bump arg: ${arg}. Expected patch|minor|major or x.y.z.`);
  process.exit(1);
}

// Write package.json (preserve key order via re-stringify + 2-space indent).
pkg.version = next;
await writeFile(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");

// Patch the SERVER_VERSION literal in src/index.ts.
// Detect the literal's PRESENCE with a regex test (not post-replace string equality):
// when next === current the replacement is identical, so `patched === src` would
// misfire as "literal not found" and abort a legitimate same-version (idempotent) run.
const SERVER_VERSION_RE = /const SERVER_VERSION = "[^"]+";/;
const src = await readFile(SRC_PATH, "utf-8");
if (!SERVER_VERSION_RE.test(src)) {
  console.error(`Could not find SERVER_VERSION literal in ${SRC_PATH}. Aborting.`);
  process.exit(1);
}
const patched = src.replace(SERVER_VERSION_RE, `const SERVER_VERSION = "${next}";`);
await writeFile(SRC_PATH, patched);

console.log(`Bumped ${current} → ${next}`);
console.log(`  ${PKG_PATH}`);
console.log(`  ${SRC_PATH}`);
console.log(`Next: update CHANGELOG.md, commit, tag v${next}, push.`);
