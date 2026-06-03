// Build the transaction patches for webstudio_update_resource. Encodes
// literal/expression values per the Webstudio storage convention.

import { customAlphabet } from "nanoid";
import type {
  WebstudioBuild,
  BuildPatchTransaction,
  BuildPatchOperation,
} from "../../webstudio-client.js";
import { encodeExpressionRefs } from "../../utils/expression-encoding.js";

const txId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

export type Resource = {
  id: string;
  name: string;
  method: string;
  url: string;
  headers?: Array<{ name: string; value: string }>;
  searchParams?: Array<{ name: string; value: string }>;
  body?: string;
};

export type UpdateResourceInput = {
  resourceId?: string;
  resourceName?: string;
  url?: { value: string; mode: "literal" | "expression" };
  method?: "get" | "post" | "put" | "patch" | "delete";
  searchParams?: Array<{ name: string; value: string; mode: "literal" | "expression" }>;
  headers?: Array<{ name: string; value: string; mode: "literal" | "expression" }>;
  body?: { value: string; mode: "literal" | "expression" };
};

export function encode(input: { value: string; mode: "literal" | "expression" }): string {
  // Expression mode → raw JS string. Auto-encode dataSourceId refs (`-` → `__DASH__`)
  // so a raw id with a dash doesn't silently break the renderer. Idempotent.
  return input.mode === "literal" ? JSON.stringify(input.value) : encodeExpressionRefs(input.value);
}

export function describeStored(stored: string): string {
  // If JSON.parse succeeds and gives a primitive, it's a literal — show without surrounding quotes.
  try {
    const parsed = JSON.parse(stored);
    if (typeof parsed === "string") return `"${parsed.slice(0, 80)}"`;
    if (typeof parsed === "number" || typeof parsed === "boolean") return String(parsed);
  } catch {
    /* expression */
  }
  return `expr:${stored.slice(0, 80)}`;
}

export function buildUpdateResourceTransaction(
  build: WebstudioBuild,
  input: UpdateResourceInput,
): {
  transaction: BuildPatchTransaction;
  details: string[];
  patchCount: number;
  resource?: Resource;
} {
  const resources = (build as unknown as { resources?: Resource[] }).resources ?? [];
  const target = resources.find(
    (r) =>
      (input.resourceId && r.id === input.resourceId) ||
      (input.resourceName && r.name === input.resourceName),
  );
  if (!target) {
    return {
      transaction: { id: `mcp-update-resource-${txId()}`, payload: [] },
      details: [
        `! Resource not found. Available:\n${resources.map((r) => `  - "${r.name}" [${r.id}] ${r.method.toUpperCase()}`).join("\n")}`,
      ],
      patchCount: 0,
    };
  }

  const updated: Resource = { ...target };
  const details: string[] = [];

  if (input.url) {
    const newUrl = encode(input.url);
    if (newUrl !== target.url) {
      details.push(`url: ${describeStored(target.url)} → ${describeStored(newUrl)}`);
      updated.url = newUrl;
    } else {
      details.push(`= url unchanged`);
    }
  }

  if (input.method && input.method !== target.method) {
    details.push(`method: ${target.method} → ${input.method}`);
    updated.method = input.method;
  }

  if (input.searchParams) {
    const newSp = input.searchParams.map((s) => ({ name: s.name, value: encode(s) }));
    const oldSp = target.searchParams ?? [];
    if (JSON.stringify(oldSp) !== JSON.stringify(newSp)) {
      details.push(
        `searchParams: ${oldSp.length} → ${newSp.length} entry(ies)`,
        ...newSp.map((s) => `  + ${s.name}=${describeStored(s.value)}`),
      );
      updated.searchParams = newSp;
    }
  }

  if (input.headers) {
    const newH = input.headers.map((h) => ({ name: h.name, value: encode(h) }));
    const oldH = target.headers ?? [];
    if (JSON.stringify(oldH) !== JSON.stringify(newH)) {
      details.push(
        `headers: ${oldH.length} → ${newH.length} entry(ies)`,
        ...newH.map((h) => `  + ${h.name}=${describeStored(h.value)}`),
      );
      updated.headers = newH;
    }
  }

  if (input.body !== undefined) {
    const newBody = encode(input.body);
    if (newBody !== target.body) {
      details.push(`body: ${describeStored(target.body ?? '""')} → ${describeStored(newBody)}`);
      updated.body = newBody;
    }
  }

  if (JSON.stringify(target) === JSON.stringify(updated)) {
    return {
      transaction: { id: `mcp-update-resource-${txId()}`, payload: [] },
      details: [`= No changes for resource "${target.name}" [${target.id}]`],
      patchCount: 0,
      resource: target,
    };
  }

  const patches: BuildPatchOperation[] = [
    { op: "replace", path: [target.id], value: updated },
  ];

  return {
    transaction: {
      id: `mcp-update-resource-${txId()}`,
      payload: [{ namespace: "resources", patches }],
    },
    details: [`Resource "${target.name}" [${target.id}]:`, ...details],
    patchCount: 1,
    resource: target,
  };
}
