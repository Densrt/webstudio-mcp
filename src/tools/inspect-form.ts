// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HANDLER — dispatched via webstudio_inspect(target:"form").
//
// As of v0.3.0 this file is NOT exposed as a standalone tool in the MCP manifest.
// It remains as a handler delegated to by src/tools/inspect.ts. Editing this file:
//   - The `description` field is irrelevant (the dispatcher's description wins).
//   - The `handler` is what runs when `inspect({target:"form", ...})` is called.
//   - The Zod `Schema` still validates the dispatched args.
// To expose this back as a standalone tool: add `webstudio_<name>` to TOOLS in
// src/index.ts and add an entry in src/tools/index-tool-categories.ts.
// ─────────────────────────────────────────────────────────────────────────────
// Tool: webstudio_inspect_form — list all <Form> instances on a page, walking each one to
// dump its inputs/textareas/selects with their attributes (name, type, required, placeholder,
// pattern, min/max, value). Useful before configuring a webhook/n8n workflow that consumes
// the form payload, and to spot duplicates or mis-named fields.

import { z } from "zod";
import type { ToolModule } from "./types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "./types.js";
import { requireAuth } from "../auth.js";
import { fetchBuild } from "../webstudio-client.js";
import type { WebstudioBuild } from "../webstudio-client.js";

export const inspectFormInputSchema = z.object({
  projectSlug: z.string(),
  pageId: z.string().optional(),
  pagePath: z.string().optional(),
}).strict();

type FormReport = {
  formId: string;
  formLabel?: string;
  formProps: Record<string, unknown>;
  inputs: Array<{
    instanceId: string;
    label?: string;
    tag?: string;
    component: string;
    props: Record<string, unknown>;
  }>;
};

const INPUT_PATTERNS: Array<{ tag?: string[]; component?: string[] }> = [
  { tag: ["input", "textarea", "select"] },
  { component: ["Input", "Textarea", "Select", "Checkbox", "Switch"] },
];

function isInputLike(inst: { tag?: string; component: string }): boolean {
  for (const p of INPUT_PATTERNS) {
    if (p.tag && inst.tag && p.tag.includes(inst.tag)) return true;
    if (p.component) {
      const compShort = inst.component.split(":").pop() || inst.component;
      if (p.component.includes(compShort)) return true;
    }
  }
  return false;
}

function collectFormReports(build: WebstudioBuild, rootInstanceId?: string): FormReport[] {
  const instances = new Map(build.instances.map((i) => [i.id, i]));
  const propsByInstance = new Map<string, typeof build.props>();
  for (const p of build.props) {
    const arr = propsByInstance.get(p.instanceId) ?? [];
    arr.push(p);
    propsByInstance.set(p.instanceId, arr);
  }

  const inScope = new Set<string>();
  if (rootInstanceId) {
    const visit = (id: string) => {
      if (inScope.has(id)) return;
      inScope.add(id);
      const inst = instances.get(id);
      if (!inst) return;
      for (const c of inst.children ?? []) {
        if (c.type === "id") visit(c.value);
      }
    };
    visit(rootInstanceId);
  } else {
    for (const inst of build.instances) inScope.add(inst.id);
  }

  const forms = build.instances.filter(
    (i) => inScope.has(i.id) && (i.component === "Form" || i.component.endsWith(":Form")),
  );

  const reports: FormReport[] = [];
  for (const f of forms) {
    const fProps: Record<string, unknown> = {};
    for (const p of propsByInstance.get(f.id) ?? []) fProps[p.name] = p.value;

    const inputs: FormReport["inputs"] = [];
    const visit = (id: string) => {
      const inst = instances.get(id);
      if (!inst) return;
      if (isInputLike(inst)) {
        const ip: Record<string, unknown> = {};
        for (const p of propsByInstance.get(inst.id) ?? []) ip[p.name] = p.value;
        inputs.push({
          instanceId: inst.id,
          label: inst.label,
          tag: inst.tag,
          component: inst.component,
          props: ip,
        });
      }
      for (const c of inst.children ?? []) {
        if (c.type === "id") visit(c.value);
      }
    };
    for (const c of f.children ?? []) {
      if (c.type === "id") visit(c.value);
    }

    reports.push({
      formId: f.id,
      formLabel: f.label,
      formProps: fProps,
      inputs,
    });
  }

  return reports;
}

function fmtValue(v: unknown): string {
  if (typeof v === "string") return `"${v.length > 80 ? v.slice(0, 80) + "…" : v}"`;
  return JSON.stringify(v);
}

export const inspectFormTool: ToolModule = {
  definition: {
    name: "webstudio_inspect_form",
    description: `Use when: before configuring a backend webhook (n8n, Brevo), get the exact field names a Form POSTs.
Lists every <Form> on a page (or project-wide) with its props (action/method/enctype) and dumps all
descendant inputs/textareas/selects with their attributes (name, type, required, pattern, value, etc.).
Hidden inputs surfaced. Read-only.`,
    inputSchema: {
      type: "object",
      properties: {
        projectSlug: { type: "string" },
        pageId: { type: "string" },
        pagePath: { type: "string" },
      },
      required: ["projectSlug"],
      additionalProperties: false,
    },
  },
  handler: async (args) => {
    const parsed = inspectFormInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    const opts = parsed.data;

    let auth;
    try {
      auth = requireAuth(opts.projectSlug);
    } catch (err) {
      return authErrorResult(err);
    }

    let build: WebstudioBuild;
    try {
      build = await fetchBuild(auth);
    } catch (err) {
      return runtimeErrorResult(err, "fetch build failed");
    }

    let rootInstanceId: string | undefined;
    let pageHeader = "Project-wide";
    if (opts.pageId || opts.pagePath !== undefined) {
      const page = opts.pageId
        ? build.pages.pages.find((p) => p.id === opts.pageId)
        : build.pages.pages.find((p) => p.path === opts.pagePath);
      if (!page) {
        return errorResult("PAGE_NOT_FOUND", `Page not found (${opts.pageId ? "id" : "path"}=${opts.pageId ?? opts.pagePath})`);
      }
      rootInstanceId = page.rootInstanceId;
      pageHeader = `Page: ${page.path || "/"} (${page.name})`;
    }

    const reports = collectFormReports(build, rootInstanceId);

    if (reports.length === 0) {
      return textResult(`${pageHeader}\n\nNo <Form> instances found.`);
    }

    const lines: string[] = [`${pageHeader}\n`, `Found ${reports.length} form(s):`];

    for (const r of reports) {
      lines.push("");
      lines.push(`=== Form ${r.formId}${r.formLabel ? ` "${r.formLabel}"` : ""} ===`);
      const fp = r.formProps;
      const formInfo = [
        fp.method ? `method=${fp.method}` : null,
        fp.enctype ? `enctype=${fp.enctype}` : null,
        fp.action ? `action=${fmtValue(fp.action)}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
      if (formInfo) lines.push(`  ${formInfo}`);
      if (r.inputs.length === 0) {
        lines.push(`  (no input/textarea/select found)`);
        continue;
      }
      lines.push(`  ${r.inputs.length} field(s):`);
      for (const f of r.inputs) {
        const compShort = f.component.split(":").pop() || f.component;
        const tagPart = f.tag ? ` <${f.tag}>` : "";
        const labelPart = f.label ? ` "${f.label}"` : "";
        const propsLine = Object.entries(f.props)
          .map(([k, v]) => `${k}=${fmtValue(v)}`)
          .join(" ");
        lines.push(`    - ${compShort}${tagPart}${labelPart}`);
        if (propsLine) lines.push(`        ${propsLine}`);
      }
    }

    return textResult(lines.join("\n"));
  },
};
