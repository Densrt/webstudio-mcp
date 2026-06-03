---
name: Phase 2 — Webstudio Cloud auth + READ + WRITE validated
description: An auth pattern that works for talking to the Webstudio backend from an external client (MCP). Session cookies + CSRF + sec-fetch headers. Full PoC (read + write build.patch) validated 2026-05-08.
category: workflow
complexity: medium
lastUpdated: 2026-05-20
recommendedTool: auth.setup
recommendedToolNote: cookies + CSRF + sec-fetch headers for tRPC access
---

# Webstudio Cloud — validated READ + WRITE pattern

**Full PoC validated on 2026-05-08**:
1. GET `/rest/data/{projectId}` → 200 OK with the complete build
2. POST `/trpc/build.patch?batch=1` → 200 `{status:"ok", version: N+1}` with Map-style Immer patches
3. Multi-patches in a single transaction (add instance + reference it in children) → OK
4. Incremental versioning `0 → 1 → 2` handled correctly
5. `version_mismatched` returned when sending a stale version

## REQUIRED headers

Without **ALL** of these headers, the server returns **403 "Cross-origin request to..."** (misleading message — it is not really cross-origin CSRF, it is a global Webstudio check on the request signature).

| Header | Value | Source |
|---|---|---|
| `Cookie` | `__Host-_session_builder_session_3=...; __Host-_csrf_1=...` | Browser cookies (DevTools → Application → Cookies) |
| `x-csrf-token` | Extracted from the CSRF cookie | `JSON.parse(atob(cookie.split('.')[0])).token` |
| `x-webstudio-client` | `browser` | Constant |
| `x-webstudio-client-version` | e.g. `b65cac61112cb571f38448087e3ac46ca3e7a3ea` | Hash of the server build — changes on every Webstudio release. Must match for `build.patch` mutations |
| `sec-fetch-mode` | `cors` | Constant |
| `sec-fetch-site` | `same-origin` | Constant |
| `sec-fetch-dest` | `empty` | Constant |
| `referer` | `https://p-{projectId}.apps.webstudio.is/` | Project subdomain |
| `user-agent` | Any realistic browser user-agent | Chrome desktop or mobile works |

**Optional**: `accept`, `accept-encoding`, `accept-language`, `cache-control`, `content-type`, `pragma`, `priority`, `sec-ch-ua*`. Not critical to pass the check.

## Validated endpoints

### Read the complete build
```
GET https://p-{projectId}.apps.webstudio.is/rest/data/{projectId}
```

Returns JSON with **top-level keys**:
```
id, projectId, version, createdAt, updatedAt,
pages, breakpoints, styles, styleSources, styleSourceSelections,
props, dataSources, resources, instances, marketplaceProduct, assets,
project, publisherHost
```

**Key fields for Phase 2**:
- `id` = buildId (UUID, to pass into `build.patch`)
- `version` = integer, incremented on every applied patch (also to pass)
- `pages.pages[]` = array of `{ id, name, path, rootInstanceId }`
- `pages.homePage` = home page
- `instances` = array (probably serialized as an array of tuples [id, instance] — to verify at write time)

### tRPC polling (simple, no-risk test)
```
GET https://p-{projectId}.apps.webstudio.is/trpc/polly.poll?batch=1&input=%7B%220%22%3A%7B%22topics%22%3A%5B%22notifications%22%5D%7D%7D
```
→ `[{"result":{"data":{"notifications":[]}}}]`

Usable as an auth healthcheck (mutates nothing, so it is safe).

### build.patch mutation — validated format

**URL**: `POST https://p-{projectId}.apps.webstudio.is/trpc/build.patch?batch=1`

**Wire body** (NO `json` wrapper, despite what the tRPC docs suggest):
```json
{
  "0": {
    "source": "browser",
    "appVersion": "<x-webstudio-client-version hash>",
    "buildId": "<build UUID>",
    "projectId": "<project UUID>",
    "version": <number, current>,
    "entries": [
      {
        "transaction": {
          "id": "<free string id>",
          "payload": [
            {
              "namespace": "instances",
              "patches": [
                { "op": "add", "path": ["new-instance-id"], "value": { "type": "instance", "id": "new-instance-id", "component": "ws:element", "tag": "div", "children": [] } },
                { "op": "add", "path": ["body-id", "children", 0], "value": { "type": "id", "value": "new-instance-id" } }
              ]
            }
          ]
        }
      }
    ]
  }
}
```

**Immer Patch format — Map-style**: `path: ["map-key", ...sub-path]`. Webstudio serializes the containers (instances, props, styles, etc.) as arrays over the JSON wire, but in memory they are Immer Maps (`enableMapSet`). So the patches use the ID directly as the key.

### Exact Map keys per container (validated 2026-05-08 via a full fragment push)

| Container | Map key (path[0]) |
|---|---|
| `instances` | `instance.id` |
| `props` | `prop.id` (internal Webstudio convention: `<instanceId>:<propName>`, but nanoids are accepted too) |
| `breakpoints` | `breakpoint.id` |
| `styleSources` | `styleSource.id` (local convention: `<instanceId>:ws:style`, but nanoid is OK) |
| `styleSourceSelections` | `selection.instanceId` |
| `styles` | **composite key**: `${styleSourceId}:${breakpointId}:${state ?? ""}:${property}` |

**Insertion into `children`**: `path: [parentId, "children", index]` with `op: "add"` inserts at `index` in the parent's children array.

### tRPC batch wire format (POST, validated)

```http
POST /trpc/build.patch?batch=1
Content-Type: application/json

{"0":{"source":"browser","appVersion":"<hash>","buildId":"<uuid>","projectId":"<uuid>","version":<n>,"entries":[{"transaction":{"id":"<free>","payload":[{"namespace":"instances","patches":[...]}]}}]}}
```

**NO `json` wrapper** — the tRPC batch serves the input directly. If you wrap it in `{json:...}`, the server reads `{}` and fails on the required fields.

**Observed responses**:
- `{result:{data:{status:"ok", version:N+1, entries:[{transactionId,status:"accepted"}]}}}` → patch applied, version incremented
- `{result:{data:{status:"error", errors:"Transaction entries required"}}}` → empty entries
- `{result:{data:{status:"version_mismatched", errors:"...single-player mode..."}}}` → re-fetch + retry

### Informative Zod errors while probing

When you send an invalid body, the server returns a detailed Zod error that reveals the expected schema. Useful for discovering the format blind.

## Open questions

- **Long-lived token**: we currently depend on the user's session cookies (limited lifetime, ~a few days). No permanent `apiToken` mechanism identified in the Webstudio UI. The `authToken` query param of the builder URL (`?authToken=...`) is the most stable solution for an autonomous MCP — to be tested on push (not only on read, which was done via cookie).
- **`appVersion` strict matching**: if we hardcode it and the server deploys a new version, mutations get rejected. Solution: the initial fetch of `/rest/data/{projectId}` probably returns the current version in a header (to observe).
- **Multi-namespace patches**: we validated `instances` alone. Still to test with `props`, `styles`, `styleSources`, `styleSourceSelections`, `breakpoints` in the same transaction (the real workflow for pushing a complete fragment).
- **Auto patch generation**: we currently build them by hand. To push a complete fragment (see WebstudioFragment), we need a `fragmentToPatches(fragment, currentBuild) → BuildPatchChange[]` function. Either reproduce the builder's `insertWebstudioFragmentCopy`, or use Immer + `produceWithPatches` on a copy of the local build.

## Reference code for the MCP (to integrate)

```ts
type WebstudioAuth = {
  projectId: string;
  cookie: string;        // full value of the Cookie header
  csrfToken: string;     // x-csrf-token (extracted from the __Host-_csrf_1 cookie)
  appVersion: string;    // x-webstudio-client-version (to fetch or ask the user for)
};

async function fetchBuild(auth: WebstudioAuth): Promise<WebstudioBuild> {
  const origin = `https://p-${auth.projectId}.apps.webstudio.is`;
  const res = await fetch(`${origin}/rest/data/${auth.projectId}`, {
    headers: {
      cookie: auth.cookie,
      "x-csrf-token": auth.csrfToken,
      "x-webstudio-client": "browser",
      "x-webstudio-client-version": auth.appVersion,
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "sec-fetch-dest": "empty",
      referer: `${origin}/`,
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/147.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`Build fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}
```

## How to apply

To start a direct-push MCP session on Webstudio:
1. Ask the user to open their builder, F12 → Network → copy the cookies + the `x-webstudio-client-version` header from a trpc request
2. Store it in the MCP config (securely — it is the equivalent of the user's session)
3. Use `fetchBuild()` at startup to get buildId + version + page list
4. To push: build the Immer patches (see `phase2_trpc.md`), POST `build.patch` with the same headers + `Content-Type: application/json`
