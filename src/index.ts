#!/usr/bin/env node
// MCP server entry point — aggregates the tool modules.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { ToolModule } from "./tools/types.js";
import { textResult } from "./tools/types.js";
import { listPatternResources, readPatternResource } from "./resources.js";
import { logTelemetry } from "./lib/telemetry.js";

// ─── Core meta / setup / fetch ─────────────────────────────────────────────
// buildFragmentTool, pushFragmentTool, createSheetTool, createNavigationMenuTool consolidated into buildTool
// helpersTool removed from registry in v0.4.0 — use webstudio_describe_pattern(helper:"<query>") instead.
// The SNIPPETS source remains in src/tools/helpers.ts and is imported by describe-pattern.ts.
// v1.0 mega-tools — auth + project + pages + read + meta
// (listTokensTool, defineTokenTool from projects.js are imported by tokens-mega.ts directly)
import { authTool } from "./tools/auth-mega.js";
import { projectTool } from "./tools/project-mega.js";
import { pagesTool } from "./tools/pages.js";
import { readTool } from "./tools/read-mega.js";
import { makeMetaTool } from "./tools/meta-mega.js";

// build mega-tool (consolidates buildFragmentTool + pushFragmentTool + createSheetTool + createNavigationMenuTool)
import { buildTool } from "./tools/build-mega.js";
import { instancesTool } from "./tools/instances-mega.js";

// ─── Variables & resources — v1.0 mega-tools (atomics consolidated, source files kept as internal handlers) ──
import { variablesTool } from "./tools/variables-mega.js";
import { resourcesTool } from "./tools/resources-mega.js";

// ─── Instances atomics — consolidated into instancesTool ──
// (all instance atomic source files kept as internal handlers, accessed by instancesTool)

// ─── Styles / tokens / cssvar — v1.0 mega-tools ──
import { stylesMegaTool } from "./tools/styles-mega.js";
import { tokensTool } from "./tools/tokens-mega.js";
import { cssvarTool } from "./tools/cssvar-mega.js";
// dedupeTokenLocalsTool, cleanupOrphanLocalsTool absorbed into tokensTool
// (actions:"dedupe_locals" and "cleanup_orphan_locals" — see tokens-mega.ts).

// ─── Pages atomic tools (legacy, consolidated into pagesTool — kept as internal handlers) ──

// ─── Assets — v1.0 mega-tool (5 atomics consolidated, source files kept as internal handlers) ──
import { assetsTool } from "./tools/assets.js";

// ─── Audit — v1.0 mega-tool (absorbs audit_page in action:"page") ──
import { auditMegaTool } from "./tools/audit-mega.js";

// ─── CMS — v1.0 mega-tool (Directus adapter, workstream #11) ──
import { cmsTool } from "./tools/cms-mega.js";

// ─── Project lifecycle (atomic source files — consolidated in projectTool mega-tool) ──

const TOOLS: ToolModule[] = [
  // v1.0 mega-tools — auth + project + read
  authTool,                // 3 actions: setup | allow_push | update_app_version
  projectTool,             // 5 actions: init | list | export | nuke | import_figma
  readTool,                // 5 actions: fetch_pages | list_instances | read_texts | inspect | snapshot

  // Build & instances — v1.0 mega-tools
  buildTool,               // 6 actions: build_fragment | push_fragment | push_complete | create_sheet | create_navigation_menu | push_html
  instancesTool,           // 11 actions: append | delete | clone | clone_page | wrap | flatten | update_label | update_text | prop_update | prop_delete | prop_bind

  // Pages — v1.0 mega-tool (create | update | delete | list_folders | delete_folder)
  pagesTool,

  // Styles / tokens / cssvar — v1.0 mega-tools
  stylesMegaTool,          // 4 actions: get_decls | update | delete_decl | replace_value (LOCAL only — not tokens)
  tokensTool,              // 16 actions: define_local | list_local | init_brand_kit | sync_local | create_tokens | list_tokens_cloud | update_token_styles | attach_token | detach_token | extract_token | extract_variant | delete_token | bulk_rename_token_names | migrate_token_selections | dedupe_locals | cleanup_orphan_locals
  cssvarTool,              // 4 actions: define | list | delete | rewrite_refs

  // Variables & resources — v1.0 mega-tools
  variablesTool,           // 5 actions: create | list | update | delete | bind_page_field
  resourcesTool,           // 4 actions: create | list | update | delete

  // Assets — v1.0 mega-tool
  assetsTool,              // 5 actions: upload | list | find_usage | replace | delete

  // Audits — v1.0 mega-tool (action:"page" absorbs auditPageTool, 12 other kinds are READ-ONLY actions)
  auditMegaTool,           // 13 actions: page | overflow | local_styles | token_usage | token_overlap | orphans | assets | fonts | images | scripts | resources_perf | diff_pages_tokens | radix_trigger_pollution

  // CMS — v1.0 mega-tool (Directus, killer feature: bind_collection_to_instance)
  cmsTool,                 // 7 actions: list_collections | discover_schema | list_items | create_item | update_item | delete_item | bind_collection_to_instance
];

// Prepend the meta mega-tool (action:index sees the final list — closure pattern).
TOOLS.unshift(makeMetaTool(() => TOOLS));

const handlers = new Map(TOOLS.map((t) => [t.definition.name, t.handler]));

const SERVER_NAME = "webstudio";
const SERVER_VERSION = "2.10.10";

// MCP `instructions` — sent once at handshake (per the MCP spec, the host can
// surface these to the model as a system-level preamble). Use it for cross-cutting
// workflow guidance that's painful to learn one tool at a time. Keep terse:
// every agent pays this token cost on connect.
const SERVER_INSTRUCTIONS = `Webstudio MCP v${SERVER_VERSION} — workflow rules.

1. **Discovery first.** Before building or pushing ANY section/component, call \`meta.guide({brief:"..."})\` — single-shot triage that returns the best pattern + matching high-level tool (e.g. desktop mega menu → \`navigation-menu-radix\` + \`build.create_navigation_menu\`). Alternatives: \`meta.index\` (tool catalog), \`meta.list_patterns\` (recipe slugs). Patterns are also exposed as MCP Resources (\`webstudio://patterns/<slug>\`). Guessing slugs (bento, mega-menu, sheet-mobile…) re-invents existing patterns.
2. **Read before mutating styles.** Call \`styles.get_decls\` on the target instance(s) before \`styles.update\` / \`tokens.update_token_styles\`. \`read.inspect\` returns style SOURCES (names + ids), NOT the CSS values. Without get_decls you cannot reason about the cascade and will produce hacks (e.g. \`box-shadow: inset …\` to fake an overlay instead of \`backgroundImage\` layers — see pattern inline-bg-image-overlay).
3. **Overlay over background image** → \`backgroundImage: { type:"layers", value:[gradient, image] }\` on the element itself. Do NOT nest absolute-positioned divs. Do NOT use \`box-shadow\` as an overlay.
4. **Local vs token.** \`styles.update\` writes LOCAL overrides — for 2+ instances sharing decls, prefer \`tokens.create_tokens\` / \`tokens.update_token_styles\` then \`tokens.dedupe_locals\`. See pattern component-architecture.
5. **Dry-run by default.** Most mutating tools default to \`dryRun: true\`. Inspect the patch list before pushing.
`;

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    capabilities: { tools: {}, resources: {} },
    instructions: SERVER_INSTRUCTIONS,
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => t.definition),
}));

// MCP resources — expose docs/patterns/*.md at webstudio://patterns/<slug>.
// The LLM can cite a pattern passively (no tool call required) — Notion v2 / Linear pattern.
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: listPatternResources().map((r) => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType,
  })),
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const result = readPatternResource(req.params.uri);
  if (!result) throw new Error(`Resource not found: ${req.params.uri}`);
  return result;
});

// Claude Code sometimes serializes arrays/objects/booleans/numbers as JSON strings inside MCP parameters.
// We coerce string values back to their natural types before passing them to handlers.
function parseArgs(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") {
      if (v.startsWith("[") || v.startsWith("{")) {
        try { out[k] = JSON.parse(v); } catch { out[k] = v; }
      } else if (v === "true") {
        out[k] = true;
      } else if (v === "false") {
        out[k] = false;
      } else {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Telemetry — see src/lib/telemetry.ts. Opt-in via WEBSTUDIO_MCP_TELEMETRY=1.
// Two event families: "tool_call" (every MCP invocation) + "coerce" (silent
// server-side normalisations, emitted by lib/expand-shorthand.ts etc.).
// Used by scripts/telemetry-report.mjs to surface top coerces over time.

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const handler = handlers.get(request.params.name);
  if (!handler) return textResult(`Unknown tool: ${request.params.name}`, true);
  const args = parseArgs(request.params.arguments ?? {});
  const startedAt = Date.now();
  try {
    const result = await handler(args);
    await logTelemetry({
      event: "tool_call",
      ts: new Date(startedAt).toISOString(),
      tool: request.params.name,
      args_keys: Object.keys(args),
      success: result.isError !== true,
      duration_ms: Date.now() - startedAt,
      error_class: result.isError ? "tool_error" : undefined,
    });
    return result;
  } catch (err) {
    await logTelemetry({
      event: "tool_call",
      ts: new Date(startedAt).toISOString(),
      tool: request.params.name,
      args_keys: Object.keys(args),
      success: false,
      duration_ms: Date.now() - startedAt,
      error_class: (err as Error)?.name ?? "exception",
    });
    throw err;
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Boot banner on stderr (stdout reserved for MCP framing). Surfaces the running
// version in `claude mcp logs` and host UIs that pipe stderr → debug pane.
process.stderr.write(`[${SERVER_NAME}-mcp] v${SERVER_VERSION} started — ${TOOLS.length} tools registered\n`);
