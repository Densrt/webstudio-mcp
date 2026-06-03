#!/usr/bin/env node
// E2E smoke: load real auth, run fetchAppVersion, print result.
// Usage: node scripts/e2e-app-version.mjs <projectSlug>

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fetchAppVersion } from "../dist/webstudio-client.js";

const slug = process.argv[2] || "my-site";
const authPath = join(homedir(), ".webstudio-mcp", "projects", slug, "webstudio-auth.json");
const auth = JSON.parse(await readFile(authPath, "utf-8"));

console.log(`[e2e] project=${slug} projectId=${auth.projectId}`);
const t0 = Date.now();
try {
  const v = await fetchAppVersion(auth.projectId, auth.cookie);
  console.log(`[e2e] OK appVersion=${v} elapsed=${Date.now() - t0}ms`);
} catch (e) {
  console.error(`[e2e] FAIL elapsed=${Date.now() - t0}ms`);
  console.error(e.message);
  process.exit(1);
}
