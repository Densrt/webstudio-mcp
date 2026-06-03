// Tool: webstudio_inspect — unified inspect dispatcher.
//
// Consolidates inspect_instance / inspect_form / inspect_resource behind one tool
// with `target` enum. Each target delegates to the existing handler.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { errorResult } from "./types.js";
import { inspectInstanceTool } from "./inspect-instance.js";
import { inspectFormTool } from "./inspect-form.js";
import { inspectResourceTool } from "./inspect-resource.js";

/**
 * v2 — superset Zod for the inspect dispatcher. Marks all sub-handler fields as
 * optional except target+projectSlug; the picked sub-handler enforces strictness
 * for its own target at runtime. Drives the JSON schema surfaced by the `read`
 * mega-tool's `inspect` action.
 */
export const inspectInputSchema = z.object({
  projectSlug: z.string(),
  target: z.enum(["instance", "form", "resource"]),
  // instance fields
  instanceIds: z.array(z.string()).optional(),
  labelContains: z.string().optional(),
  propNameContains: z.string().optional(),
  maxValueLength: z.number().int().optional(),
  childDepth: z.number().int().optional(),
  // instance + form shared
  pageId: z.string().optional(),
  pagePath: z.string().optional(),
  // resource fields
  resourceId: z.string().optional(),
  resourceName: z.string().optional(),
  searchParams: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  bodyMaxChars: z.number().int().optional(),
  raw: z.boolean().optional(),
}).strict();

const TARGET_TO_TOOL: Record<string, ToolModule> = {
  "instance": inspectInstanceTool,
  "form": inspectFormTool,
  "resource": inspectResourceTool,
};

export const inspectTool: ToolModule = {
  definition: {
    name: "webstudio_inspect",
    description: `Use when: deep details on an instance, form, or resource — typically BEFORE patching (update_styles, update_instance_prop, bind_instance_prop, delete_instance).
Do NOT use when: you only need a flat tree of IDs/labels on a page — use webstudio_list_instances (lighter, faster). For a full page audit (sections, tokens, anomalies), use webstudio_audit_page.
Returns: target-specific payload:
  - target:"instance" → { tag, label, component, props, text/expression children, style sources }. Params: instanceIds? | labelContains?+pagePath?|pageId?, propNameContains?, maxValueLength?, childDepth?
  - target:"form" → list of <Form> instances with inputs/textareas/selects (name, type, required, placeholder, pattern). Params: pageId? | pagePath?
  - target:"resource" → executes the resource and returns response sample + inferred schema (needed before bind_instance_prop to know field paths). Params: resourceId?|resourceName?, searchParams?, headers?, raw?
Side effects: none (read-only) for instance/form; target:"resource" triggers a real HTTP call to the resource URL.

Example: { target: "instance", projectSlug: "acme", instanceIds: ["abc123"] }
Example: { target: "form", projectSlug: "my-site", pagePath: "/contact" }
Example: { target: "resource", projectSlug: "my-site", resourceName: "motoData" }`,
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: Object.keys(TARGET_TO_TOOL),
          description: "What to inspect. Each target has its own set of params (see description).",
        },
        projectSlug: { type: "string" },
      },
      required: ["target", "projectSlug"],
      additionalProperties: true,
    },
    annotations: {
      title: "Inspect instance, form, or resource",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const raw = (args ?? {}) as Record<string, unknown>;
    const target = typeof raw.target === "string" ? raw.target : undefined;
    if (!target) {
      return errorResult(
        "VALIDATION_FAILED",
        `Missing 'target' param. Valid values: ${Object.keys(TARGET_TO_TOOL).join(", ")}`,
      );
    }
    const sub = TARGET_TO_TOOL[target];
    if (!sub) {
      return errorResult(
        "VALIDATION_FAILED",
        `Unknown inspect target "${target}". Valid values: ${Object.keys(TARGET_TO_TOOL).join(", ")}`,
      );
    }
    const { target: _target, ...rest } = raw;
    return sub.handler(rest);
  },
};
