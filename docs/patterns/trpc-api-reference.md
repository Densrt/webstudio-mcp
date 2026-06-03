---
name: Phase 2 — Reverse-engineering Webstudio tRPC (direct push)
description: Complete map of the Webstudio tRPC mutations for direct push from an external client (MCP). A single universal mutation, build.patch. Immer JSON-Patch-like patches. Estimated 5-6 days of dev work.
category: workflow
complexity: advanced
lastUpdated: 2026-05-20
recommendedTool: (reference)
recommendedToolNote: universal tRPC mutation build.patch + Immer JSON patches
---

# Phase 2 — Direct push to Webstudio Cloud

**Source**: tRPC agent from 2026-05-08 (detailed report).
**Repo**: `webstudio-is/webstudio` main branch.
**Note**: the typo `trcp-router` is intentional in the source code.

## TL;DR

Webstudio **does not expose** an "insertInstances"-style mutation. Everything goes through **`build.patch`** = a universal mutation that takes **Immer patches** (JSON-Patch-like: `add` / `replace` / `remove`) grouped by container (`instances`, `props`, `styles`, etc.).

**MCP workflow**:
1. Read the build via `GET /rest/data/{projectId}` → get `buildId` + `version`
2. Build a fragment and mutate the `WebstudioData` locally via Immer
3. Collect the Immer patches grouped by container
4. POST `build.patch` with those patches
5. If `version_mismatched` → re-fetch and retry

**Estimate: 5-6 days of dev work** if you are comfortable with tRPC + Immer.

## tRPC routers

**Root**: `apps/builder/app/services/trcp-router.server.ts`

Sub-routers:
| Sub-router | Path | Role |
|---|---|---|
| `build` | `apps/builder/app/services/build-router.server.ts` | **content mutations (key for Phase 2)** |
| `dashboardProject` | `packages/dashboard/src/trpc/project-router.ts` | project listing |
| `project` | `packages/project/src/trpc/project-router.ts` | project CRUD |
| `domain`, `workspace`, `notification`, `authorizationToken`, `polly`, `marketplace`, `user`, `logout` | various | not critical for Phase 2 |

**HTTP endpoint**: `POST /trpc/<router>.<method>` via `apps/builder/app/routes/trpc.$.ts`. Batch link enabled on the client side.

## The `build.patch` mutation (center of the system)

### Zod schemas

```ts
const patchEntryInput = z.object({
  seq: z.number().optional(),
  transaction: z.custom<BuildPatchTransaction>(),
});

const browserPatchInput = z.object({
  source: z.literal("browser"),
  appVersion: z.string(),       // e.g. "0.241.0" — MUST match the server
  authToken: z.string().optional(),
  buildId: z.string(),
  projectId: z.string(),
  version: z.number(),          // current client version
  entries: z.array(patchEntryInput),
});

const relayPatchInput = z.object({
  source: z.literal("relay"),
  // ... + authToken per entry
});

input: z.discriminatedUnion("source", [browserPatchInput, relayPatchInput])
```

### `BuildPatchTransaction`

```ts
type BuildPatchTransaction = {
  id: string;                  // unique transaction ID (free string, no nanoid/uuid enforcement)
  payload: BuildPatchChange[];
};

type BuildPatchChange = {
  namespace: string;           // 11 possible namespaces (see below)
  patches: Patch[];            // Immer Patch[] : { op, path, value }
};
```

### The 11 immer namespaces

```
pages, instances, props, styles, styleSources, styleSourceSelections,
breakpoints, dataSources, resources, assets, marketplaceProduct
```

### `PatchResult` response

```ts
| { status: "ok"; version: number; entries: EntryResult[] }
| { status: "partial"; version: number; entries: EntryResult[] }
| { status: "version_mismatched"; errors: string }
| { status: "authorization_error" | "error"; errors: string }
```

The server increments `version` on every applied batch and returns it. On `version_mismatched`, the builder forces a reload.

## Authentication

### Three modes on the server side

| Mode | Header | Validation |
|---|---|---|
| **Service** | `Authorization: <TRPC_SERVER_API_TOKEN>` | matches env var |
| **Token (project-scoped)** | `x-auth-token: <token>` | DB lookup `AuthorizationToken` |
| **User (session)** | OAuth session cookie | `authenticator.isAuthenticated` |

### For our MCP

**Strong assumption**: the `webstudio link` CLI provisions an `AuthorizationToken` (project-scoped) and stores it in `~/.config/webstudio/webstudio-config.json`. To be sent via `x-auth-token`.

**To verify empirically**:
```bash
curl -H "x-auth-token: <token>" https://apps.webstudio.is/rest/data/{projectId}
```

### CSRF bypass

CSRF is bypassed when `x-auth-token` is present. Good news: no need to handle CSRF on the MCP side.

### Project-scoped token limitation

An `AuthorizationToken` only has access to **1 project** (the one that generated it). To list all of the user's projects you would need a user-scoped OAuth — not easily accessible from an MCP. **Pragmatic solution**: have the user provide `projectId` directly.

## Concrete MCP workflow

### Step 1 — Auth
Read the token from `~/.config/webstudio/webstudio-config.json`. Likely format:
```json
{
  "projects": {
    "<projectId>": {
      "token": "<authorization-token>",
      "url": "https://apps.webstudio.is"
    }
  }
}
```

### Step 2 — Fetch build + version
**REST endpoint** (not tRPC): `GET /rest/data/{projectId}`
**Source path**: `apps/builder/app/routes/rest.data.$projectId.ts`

```ts
const res = await fetch(`https://apps.webstudio.is/rest/data/${projectId}`, {
  headers: { "x-auth-token": authToken }
});
const data = await res.json();
const buildId = data.id;
const version = data.version;
const pages = data.pages;          // { pages: Page[], homePage: Page, folders: Folder[] }
```

### Step 3 — Identify the target page
Each `Page` has `id`, `path`, `name`, `rootInstanceId`. To insert into a page:
- either push an `instances` patch that adds nodes AND a `pages` patch that pushes the fragment's root ID into the `children` of the page's `rootInstanceId`
- or modify `instances` directly (the page's root node) to push the new child

### Step 4 — Build the patches

**Option A (recommended)**: reproduce the builder's logic.

```ts
import { produceWithPatches } from "immer";
import { insertWebstudioFragmentCopy, insertInstanceChildrenMutable } from "@webstudio-is/instance-utils"; // if exposed on npm
// or vendor the code from apps/builder/app/shared/instance-utils.ts

const [newData, patches] = produceWithPatches(currentData, (draft) => {
  const { newInstanceIds } = insertWebstudioFragmentCopy({
    data: draft,
    fragment,
    availableVariables: findAvailableVariables({...draft, startingInstanceId: parentId}),
    projectId,
    conflictResolution: "theirs",
  });
  insertInstanceChildrenMutable(draft, [{ type: "id", value: newInstanceIds.get(rootId) }], pasteTarget);
});

// Group the patches by container/namespace
const patchesByNamespace = groupPatchesByNamespace(patches);
```

**Option B (simple)**: mutate the containers directly and capture the patches manually (without `insertWebstudioFragmentCopy`). Risk: forgetting ID regeneration, token conflicts, etc.

### Step 5 — POST build.patch

```ts
const transaction: BuildPatchTransaction = {
  id: nanoid(),
  payload: [
    { namespace: "instances", patches: instancesPatches },
    { namespace: "props", patches: propsPatches },
    { namespace: "styles", patches: stylesPatches },
    { namespace: "styleSources", patches: styleSourcesPatches },
    { namespace: "styleSourceSelections", patches: ssSelectionsPatches },
    { namespace: "breakpoints", patches: breakpointsPatches },
    // ... other namespaces if touched
  ].filter(c => c.patches.length > 0),
};

const response = await fetch('https://apps.webstudio.is/trpc/build.patch?batch=1', {
  method: 'POST',
  headers: {
    'x-auth-token': authToken,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify([{
    json: {
      source: "browser",
      appVersion: "0.241.0",        // ⚠️ MUST match the server — fetch the version beforehand
      authToken,                    // pass it in the body too
      buildId,
      projectId,
      version,
      entries: [{ transaction }],
    }
  }])
});

const result = await response.json();
const newVersion = result[0].result.data.json.version;
```

**Exact wire format to confirm empirically** (batch=1, body shape `[{json:...}]` vs `{0:{json:...}}`).

### Step 6 — Retry on version_mismatched
On `status: "version_mismatched"` → re-fetch `/rest/data/{projectId}`, regenerate the patches against the new version, retry.

## Risks & uncertainties (to test empirically)

1. **Exact tRPC wire format** — batching, body shape. Solution: MITM the builder to observe it.
2. **`appVersion` strict matching** — rejected if different. Solution: fetch the current version beforehand from a URL that returns it, or hardcode + monitor breaking changes.
3. **CLI token format** — not confirmed that `webstudio link` stores a DB AuthorizationToken. To verify in `~/.config/webstudio/webstudio-config.json`.
4. **Is `x-auth-token` accepted on `/rest/data/{projectId}`?** The code shows support but `checkCsrf` is called unconditionally beforehand — to confirm.
5. **Concurrent push**: no server-side merge. Implement a strict retry on `version_mismatched`.
6. **Payload limit**: no explicit limit seen, but 413 is possible on large builds.
7. **`pages` immer namespace**: do changes to `Page.children` go through `instances` or `pages`? To observe in practice.
8. **Is `relay` mode accessible?** The code seems reserved for service auth, not tested for x-auth-token.

## Multiplayer / canvas re-render

- **Local builder**: nanostores + BroadcastChannel/postMessage → iframe canvas auto re-renders. No network.
- **Cross-client (collab)**: WebSocket relay (`createMultiplayerRelayUrl`). Patches broadcast in real time **in parallel** with the `build.patch` HTTP call.
- **Our MCP skips the relay** → other clients won't see the diff unless they reload.

⚠️ **UX issue**: if the user has the builder open during an MCP push, their client will send a stale version → `version_mismatched` → forces a browser reload (toast "reloadBrowser"). Solution: **the MCP should warn "close the builder before I push"**.

## Suggested implementation plan

| Step | Duration | Description |
|---|---|---|
| 1 | 1d | MITM proxy on the builder locally, observe 1 paste, capture the exact headers + body |
| 2 | 1d | From the MCP, GET `/rest/data/{projectId}` with `x-auth-token`, parse, verify buildId+version |
| 3 | 2d | Import `@webstudio-is/sdk` + Immer into the MCP. Reproduce `insertWebstudioFragmentCopy`. Generate patches via `produceWithPatches` |
| 4 | 1d | POST `build.patch` with the constructed payload. Iterate until `status: "ok"` |
| 5 | 1d | Retry on `version_mismatched` (re-fetch + re-mutate) |
| 6 | 0.5d | MCP UX: detect open builder, warn the user |

**Total: ~5-6 days of dev work** back to back.

## Key files to know

| File | Role |
|---|---|
| `apps/builder/app/services/build-router.server.ts` | `build.patch` mutation + Zod schemas |
| `apps/builder/app/services/trcp-router.server.ts` | Root router |
| `apps/builder/app/routes/trpc.$.ts` | tRPC HTTP handler + auth dispatch |
| `apps/builder/app/shared/context.server.ts` | `extractAuthFromRequest` (auth priorities) |
| `apps/builder/app/shared/sync/project-queue.ts` | **Exact code that calls `build.patch.mutate`** |
| `apps/builder/app/shared/sync/sync-stores.ts` | List of the 11 immer containers |
| `apps/builder/app/shared/instance-utils.ts` | `updateWebstudioData` + manipulation utilities |
| `apps/builder/app/shared/copy-paste/plugin-instance.ts` | Paste logic (reference) |
| `apps/builder/app/shared/trpc/trpc-client.ts` | `createNativeClient(headers)` — pattern to reproduce |
| `apps/builder/app/shared/fetch.client.ts` | Headers injection + CSRF |
| `apps/builder/app/routes/rest.data.$projectId.ts` | REST loader build + version |
| `packages/project/src/db/build-patch-core.ts` | `BuildPatchTransaction`, namespace mapping |
| `packages/project/src/db/build-patch-permissions.ts` | Per-patch auth model |
| `apps/builder/app/shared/sync/patch/patch-service.server.ts` | `applyPatchRequest` on the server side |

## Final note

The cleanest strategy would be for Webstudio to expose a dedicated endpoint `instance.insertFragment(projectId, pageId, parentId, fragment)` — they probably did not because the immer/patches system is their universal "primitive" API. Our MCP has to reproduce the **fragment → patches** layer that the builder does in the browser. The right instinct: import `@webstudio-is/instance-utils` (if it exists as a public npm package) or vendor the code of the `insertWebstudioFragmentCopy` + `insertInstanceChildrenMutable` functions directly.
