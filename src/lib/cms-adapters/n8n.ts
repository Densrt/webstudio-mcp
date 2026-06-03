// n8n adapter (v2.1).
//
// Config: ~/.webstudio-mcp/cms/n8n.json
//
// Single-instance format:
//   { baseUrl: "https://n8n.example.com", apiKey: "..." }
//
// Multi-instance format:
//   {
//     "instances": {
//       "prod": { baseUrl, apiKey },
//       "staging": { ... }
//     }
//   }
//
// Auth: n8n API key (X-N8N-API-KEY header). Generate in n8n → Settings → API.
//
// Mapping CMS concepts → n8n:
//   - listCollections() = list workflows (each workflow = a "collection")
//   - discoverSchema()  = surface workflow metadata (name, active, nodes count) — no real
//     row schema since n8n is workflow-centric, not record-centric.
//   - listItems()       = list executions of a workflow (runs as "rows")
//   - createItem()      = trigger the workflow (passes the item payload as input data).
//                          REQUIRES a webhook trigger node in the workflow.
//   - updateItem()      = NOT SUPPORTED (executions are immutable). Throws.
//   - deleteItem()      = delete an execution by id.
//   - resourceUrl()     = the workflow's webhook URL (for Webstudio resource binding).
//
// This is a deliberately limited adapter — n8n is not a traditional CMS. The
// `bind_collection_to_instance` workflow makes sense for read-only data feeds
// (e.g. a "moto pricing" workflow that exposes a webhook → Webstudio renders
// the cards). For mutations (create/delete executions), use the n8n UI.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CmsAdapter, CmsItem, CollectionDef, FieldDef } from "../cms-adapter.js";

type N8nInstance = {
  baseUrl: string;
  apiKey: string;
};

type N8nConfigSingle = N8nInstance;
type N8nConfigMulti = { instances: Record<string, N8nInstance> };
type N8nConfig = N8nConfigSingle | N8nConfigMulti;

async function loadN8nConfig(): Promise<N8nConfig | null> {
  const path = join(homedir(), ".webstudio-mcp", "cms", "n8n.json");
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as N8nConfig;
  } catch {
    return null;
  }
}

function isSingleConfig(cfg: N8nConfig): cfg is N8nConfigSingle {
  return typeof (cfg as N8nConfigSingle).baseUrl === "string";
}

function pickInstance(cfg: N8nConfig, name?: string): { instance: N8nInstance; instanceName: string } {
  if (isSingleConfig(cfg)) {
    if (name) {
      throw new Error(
        `n8n.json is in single-instance format but source "n8n:${name}" requested a named instance.`,
      );
    }
    return { instance: cfg, instanceName: "default" };
  }
  const entries = Object.entries(cfg.instances);
  if (entries.length === 0) {
    throw new Error("n8n.json multi-instance config has empty `instances` object.");
  }
  if (!name) {
    if (entries.length > 1) {
      const list = entries.map(([n]) => `"n8n:${n}"`).join(", ");
      throw new Error(`n8n.json defines multiple instances — pass a named source (one of ${list}).`);
    }
    const [instanceName, instance] = entries[0];
    return { instance, instanceName };
  }
  const instance = cfg.instances[name];
  if (!instance) {
    const available = entries.map(([n]) => n).join(", ");
    throw new Error(`n8n.json has no instance named "${name}". Available: ${available}.`);
  }
  return { instance, instanceName: name };
}

type N8nWorkflow = {
  id: string;
  name: string;
  active: boolean;
  nodes?: Array<{ name: string; type: string; webhookId?: string; parameters?: Record<string, unknown> }>;
};

type N8nExecution = {
  id: string;
  workflowId: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  mode?: string;
  data?: unknown;
};

class N8nAdapterImpl implements CmsAdapter {
  public name: string;
  constructor(private inst: N8nInstance, instanceName: string) {
    this.name = instanceName === "default" ? "n8n" : `n8n:${instanceName}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.inst.baseUrl.replace(/\/$/, "")}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        "X-N8N-API-KEY": this.inst.apiKey,
        "content-type": "application/json",
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    if (!res.ok) {
      const errText = await res.text().catch(() => "(no body)");
      throw new Error(`n8n ${method} ${path} → HTTP ${res.status}: ${errText.slice(0, 500)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * Find a workflow by id OR by name. Names must be unique in practice — if multiple
   * workflows share a name, returns the first match (deterministic by API order).
   */
  private async resolveWorkflow(idOrName: string): Promise<N8nWorkflow> {
    // First try as id (n8n ids are numeric strings).
    if (/^\d+$/.test(idOrName)) {
      try {
        return await this.request<N8nWorkflow>("GET", `/api/v1/workflows/${idOrName}`);
      } catch {
        // fall through to name lookup
      }
    }
    const data = await this.request<{ data: N8nWorkflow[] }>("GET", "/api/v1/workflows");
    const match = data.data.find((w) => w.name === idOrName || w.id === idOrName);
    if (!match) {
      const available = data.data.map((w) => `"${w.name}" (id=${w.id})`).slice(0, 10).join(", ");
      throw new Error(`n8n workflow "${idOrName}" not found. Available (first 10): ${available}`);
    }
    return match;
  }

  /**
   * Extract the webhook URL from a workflow's webhook trigger node. Returns null
   * if no webhook node is configured.
   */
  private webhookUrl(workflow: N8nWorkflow): string | null {
    const webhookNode = workflow.nodes?.find((n) => n.type === "n8n-nodes-base.webhook");
    if (!webhookNode) return null;
    const params = webhookNode.parameters ?? {};
    const path = String(params.path ?? webhookNode.webhookId ?? "");
    if (!path) return null;
    // Production URL (active workflows). Test URLs use /webhook-test/ instead.
    return `${this.inst.baseUrl.replace(/\/$/, "")}/webhook/${path}`;
  }

  async listCollections(): Promise<string[]> {
    const data = await this.request<{ data: N8nWorkflow[] }>("GET", "/api/v1/workflows?active=true");
    return data.data.map((w) => w.name);
  }

  async discoverSchema(collection: string): Promise<CollectionDef> {
    const workflow = await this.resolveWorkflow(collection);
    const webhookUrl = this.webhookUrl(workflow);
    // n8n workflows don't have a typed schema per se — surface metadata instead.
    const fields: FieldDef[] = [
      { field: "id", type: "string", required: true, description: "Workflow id" },
      { field: "name", type: "string", required: true, description: "Workflow display name" },
      { field: "active", type: "boolean", required: true, description: "Whether the workflow is enabled" },
      { field: "nodeCount", type: "integer", required: false, description: `Number of nodes in the workflow (${workflow.nodes?.length ?? 0})` },
      ...(webhookUrl
        ? [{ field: "webhookUrl", type: "string" as const, required: false, description: `Production webhook URL: ${webhookUrl}` }]
        : [{ field: "webhookUrl", type: "string" as const, required: false, description: "No webhook trigger node — use a `Webhook` node to expose this workflow." }]),
    ];
    return { collection: workflow.name, fields };
  }

  async listItems(collection: string, opts: { filter?: Record<string, unknown>; limit?: number; offset?: number } = {}): Promise<CmsItem[]> {
    const workflow = await this.resolveWorkflow(collection);
    const params = new URLSearchParams();
    params.set("workflowId", workflow.id);
    if (opts.limit !== undefined) params.set("limit", String(opts.limit));
    // n8n uses `lastId` cursor pagination, not offset. We ignore opts.offset and document it in the README.
    if (opts.filter?.status) params.set("status", String(opts.filter.status));
    const data = await this.request<{ data: N8nExecution[] }>("GET", `/api/v1/executions?${params}`);
    return data.data as unknown as CmsItem[];
  }

  /**
   * Trigger the workflow's webhook with the given payload. Requires a Webhook
   * trigger node in the workflow. Returns the response of the webhook call
   * (whatever the workflow chose to respond with).
   */
  async createItem(collection: string, item: CmsItem): Promise<CmsItem> {
    const workflow = await this.resolveWorkflow(collection);
    const webhookUrl = this.webhookUrl(workflow);
    if (!webhookUrl) {
      throw new Error(`n8n workflow "${workflow.name}" has no webhook trigger — cannot createItem. Add a "Webhook" node to expose it.`);
    }
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(item),
    });
    if (!res.ok) {
      throw new Error(`n8n webhook POST ${webhookUrl} → HTTP ${res.status}: ${await res.text().catch(() => "(no body)")}`);
    }
    if (res.status === 204) return { id: "(empty response)" };
    try {
      return (await res.json()) as CmsItem;
    } catch {
      const text = await res.text().catch(() => "");
      return { id: text || "(non-json response)" };
    }
  }

  async updateItem(_collection: string, _id: string | number, _item: CmsItem): Promise<CmsItem> {
    throw new Error("n8n adapter: updateItem is not supported — executions are immutable in n8n. Trigger the workflow with `createItem` to start a new execution.");
  }

  async deleteItem(_collection: string, id: string | number): Promise<void> {
    // Delete an execution by id (workflow agnostic — id is unique per instance).
    await this.request<void>("DELETE", `/api/v1/executions/${id}`);
  }

  resourceUrl(collection: string): string {
    // Synchronous best-effort — we can't await here (interface is sync).
    // Returns the conventional webhook URL form; the actual path may differ.
    // Callers should run discoverSchema() first to get the real URL.
    return `${this.inst.baseUrl.replace(/\/$/, "")}/webhook/${encodeURIComponent(collection)}`;
  }
}

export async function getN8nAdapter(instanceName?: string): Promise<CmsAdapter> {
  const cfg = await loadN8nConfig();
  if (!cfg) {
    throw new Error(
      'n8n config missing — create ~/.webstudio-mcp/cms/n8n.json with either ' +
        '{ baseUrl, apiKey } (single-instance) or { instances: { "<name>": { baseUrl, apiKey } } } (multi-instance).',
    );
  }
  const { instance, instanceName: resolved } = pickInstance(cfg, instanceName);
  return new N8nAdapterImpl(instance, resolved);
}
