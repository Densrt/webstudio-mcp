// Tool: webstudio_build_fragment — assembles a fragment JSON ready to paste into the builder.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ToolModule } from "./types.js";
import { textResult, errorResult } from "./types.js";
import { BuildFragmentSchema, buildFromArgs } from "../build-from-args.js";

/** v2 — exported Zod schema for `build.build_fragment` (alias for clarity). */
export const buildFragmentInputSchema = BuildFragmentSchema;

export const buildFragmentTool: ToolModule = {
  definition: {
    name: "webstudio_build_fragment",
    description: `Use when: generate a WebstudioFragment JSON file to paste (Ctrl+V) into the builder — offline build, no network. Useful when allowPush is off or to inspect the fragment shape before pushing.
Do NOT use when: you want to push directly to Webstudio Cloud — use webstudio_push_fragment (same inputs + pushTo). For a Sheet pattern use webstudio_create_sheet, for a NavigationMenu use webstudio_create_navigation_menu (both push directly).
Returns: { filename, sizeBytes, instanceCount } — JSON written to ~/.webstudio-mcp/fragments/fragment-<ISO>.json.
Side effects: local mutation only (writes JSON file). Components: Box, Text, Heading, Paragraph, Image, Link, Button, HtmlEmbed, Form, Input, Textarea, Select, Label, Separator, Video, YouTube, Vimeo, Time, Accordion, Dialog, NavigationMenu, Tabs, Tooltip, Popover, Sheet, Switch, Checkbox.
Breakpoints: base / tablet (≤991) / mobile-landscape (≤767) / mobile-portrait (≤479). For HTML5 video use the first-class Video component (NEVER ws:element tag="video") — see pattern:"video-component".

Example: { instances: [{ id: "i1", component: "Box", children: [] }], styles: [], props: [] }`,
    inputSchema: {
      type: "object",
      properties: {
        instances: { type: "array", items: { type: "object" } },
        props: { type: "array", items: { type: "object" } },
        styles: { type: "array", items: { type: "object" } },
        tokens: { type: "array", items: { type: "object" } },
        projectSlug: { type: "string" },
        useTokens: { type: "array", items: { type: "object" } },
        dataSources: { type: "array", items: { type: "object" }, description: "Raw dataSource entries (variable / parameter) for ws:collection bindings. See pattern:\"ws-collection-bindings\"." },
      },
      required: ["instances"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  handler: async (args) => {
    const parsed = BuildFragmentSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);

    let builder;
    try {
      builder = buildFromArgs(parsed.data);
    } catch (err) {
      return errorResult("VALIDATION_FAILED", `Build error: ${(err as Error).message}`);
    }

    const fragment = builder.build();
    const json = JSON.stringify(fragment);

    const outputDir = process.env.WEBSTUDIO_FRAGMENTS_DIR || path.join(os.homedir(), ".webstudio-mcp", "fragments");
    fs.mkdirSync(outputDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = path.join(outputDir, `fragment-${ts}.json`);
    fs.writeFileSync(filename, json);

    return textResult(`Fragment generated.
${parsed.data.instances.length} instance(s), ${parsed.data.styles.length} style(s), ${parsed.data.props.length} prop(s).
Size: ${json.length} bytes.

JSON saved to: ${filename}

To paste into Webstudio:
\`\`\`bash
cat "${filename}"
\`\`\``);
  },
};
