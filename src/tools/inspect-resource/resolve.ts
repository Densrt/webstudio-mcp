// Resolve a Webstudio resource definition into a concrete URL + headers + body
// suitable for an actual HTTP call. Honors user-provided overrides for any
// searchParam / header bound to an expression.

import { decodeStored } from "./decode.js";

export type Resource = {
  id: string;
  name: string;
  method: string;
  url: string;
  headers?: Array<{ name: string; value: string }>;
  searchParams?: Array<{ name: string; value: string }>;
  body?: string;
};

export type ResolveOverrides = {
  searchParams?: Record<string, string>;
  headers?: Record<string, string>;
};

export type Resolved = {
  url: URL;
  headers: Record<string, string>;
  body?: string;
  expressionParams: string[];
  expressionHeaders: string[];
};

export function resolveResourceCall(resource: Resource, overrides: ResolveOverrides): Resolved | { error: string } {
  const urlDecoded = decodeStored(resource.url);
  if (urlDecoded.expression) {
    return { error: `Resource URL is a runtime expression — cannot resolve here.\n  expression: ${urlDecoded.expression}\n\nThis tool only handles literal URLs. Pass raw=true to dump the definition without executing, or modify the resource to use a literal URL.` };
  }
  const url = new URL(urlDecoded.literal!);

  const spOverrides = overrides.searchParams ?? {};
  const expressionParams: string[] = [];
  for (const sp of resource.searchParams ?? []) {
    if (sp.name in spOverrides) {
      url.searchParams.set(sp.name, spOverrides[sp.name]);
      continue;
    }
    const dec = decodeStored(sp.value);
    if (dec.literal !== undefined) url.searchParams.set(sp.name, dec.literal);
    else if (dec.expression !== undefined) expressionParams.push(`${sp.name}=${dec.expression}`);
  }
  for (const [k, v] of Object.entries(spOverrides)) {
    if (!url.searchParams.has(k)) url.searchParams.set(k, v);
  }

  const reqHeaders: Record<string, string> = {};
  const expressionHeaders: string[] = [];
  for (const h of resource.headers ?? []) {
    if (overrides.headers && h.name in overrides.headers) {
      reqHeaders[h.name] = overrides.headers[h.name];
      continue;
    }
    const dec = decodeStored(h.value);
    if (dec.literal !== undefined) reqHeaders[h.name] = dec.literal;
    else if (dec.expression !== undefined) expressionHeaders.push(`${h.name}=${dec.expression}`);
  }
  if (overrides.headers) {
    for (const [k, v] of Object.entries(overrides.headers)) {
      if (!(k in reqHeaders)) reqHeaders[k] = v;
    }
  }

  let body: string | undefined;
  if (resource.body !== undefined) {
    const dec = decodeStored(resource.body);
    body = dec.literal ?? dec.expression;
  }

  return { url, headers: reqHeaders, body, expressionParams, expressionHeaders };
}

/** Build a textual dump of a resource's raw (undecoded but human-readable) definition. */
export function formatRawDefinition(resource: Resource): string {
  const lines: string[] = [];
  lines.push(`# Resource "${resource.name}" [${resource.id}] (raw)`);
  lines.push(`Method: ${resource.method.toUpperCase()}`);
  const urlDecoded = decodeStored(resource.url);
  if (urlDecoded.literal !== undefined) lines.push(`URL (literal): ${urlDecoded.literal}`);
  else if (urlDecoded.expression !== undefined) lines.push(`URL (expression): ${urlDecoded.expression}`);
  if (resource.searchParams && resource.searchParams.length > 0) {
    lines.push(`SearchParams (${resource.searchParams.length}):`);
    for (const sp of resource.searchParams) {
      const dec = decodeStored(sp.value);
      if (dec.literal !== undefined) lines.push(`  - ${sp.name} = "${dec.literal}" (literal)`);
      else lines.push(`  - ${sp.name} = ${dec.expression} (expression)`);
    }
  }
  if (resource.headers && resource.headers.length > 0) {
    lines.push(`Headers (${resource.headers.length}):`);
    for (const h of resource.headers) {
      const dec = decodeStored(h.value);
      if (dec.literal !== undefined) lines.push(`  - ${h.name} = "${dec.literal}" (literal)`);
      else lines.push(`  - ${h.name} = ${dec.expression} (expression)`);
    }
  }
  if (resource.body !== undefined) {
    const dec = decodeStored(resource.body);
    if (dec.literal !== undefined) lines.push(`Body (literal): ${dec.literal.slice(0, 300)}`);
    else lines.push(`Body (expression): ${dec.expression}`);
  }
  return lines.join("\n");
}
