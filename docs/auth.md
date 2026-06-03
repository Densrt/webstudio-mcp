# Authentication

How an external client talks to Webstudio Cloud. There is no public API token
flow that grants project-level write access today, so this implementation
reuses the user's browser session.

## What you need

Three values, captured once from the user's browser DevTools while the builder
is open:

1. **Cookie header** — the full `Cookie: …` string. Two cookies matter:
   - `__Host-_session_builder_session_3` (session)
   - `__Host-_csrf_1` (CSRF base)
2. **CSRF token** — extracted from the CSRF cookie:
   ```ts
   const csrfToken = JSON.parse(atob(csrfCookie.split('.')[0])).token;
   ```
3. **App version** — the value of `x-webstudio-client-version` on any
   `/trpc/...` request. Auto-fetched if you skip it (see below).

The MCP stores these per-project in `projects/{slug}/webstudio-auth.json`
(mode 0600, gitignored). See `src/auth.ts`.

## Required headers

Every request must carry the full set below. Missing any one of the
`sec-fetch-*` triplet returns **403 "Cross-origin request to …"** — a
misleading error since the request is in fact same-origin.

| Header | Value |
|---|---|
| `Cookie` | full cookie header |
| `x-csrf-token` | extracted token |
| `x-webstudio-client` | `browser` (literal) |
| `x-webstudio-client-version` | the build hash (`appVersion`) |
| `sec-fetch-mode` | `cors` |
| `sec-fetch-site` | `same-origin` |
| `sec-fetch-dest` | `empty` |
| `Referer` | `https://p-{projectId}.apps.webstudio.is/` |
| `User-Agent` | any realistic browser UA |

For mutations also add `Content-Type: application/json` and `Origin`
(same as `Referer` minus the trailing slash). The MCP builds these in
`src/webstudio-client.ts:121-139`.

## Endpoints

Each project is served from its own subdomain:

```
https://p-{projectId}.apps.webstudio.is
```

| Method + path | Purpose |
|---|---|
| `GET /rest/data/{projectId}` | Full build snapshot (instances, styles, pages, version, …) |
| `POST /trpc/build.patch?batch=1` | Apply Immer patches (see [patches.md](patches.md)) |
| `GET /trpc/polly.poll?batch=1&input=…` | Health-check (no side effects) |

The polly endpoint is useful as a session liveness check because it does not
mutate anything.

## tRPC batch quirk: `{"0": …}`, no `json` wrapper

The tRPC client library documents inputs wrapped in `{ json: … }`. The
batch HTTP transport on Webstudio's deployment does **not** use that wrapper.
Bodies look like:

```json
{
  "0": {
    "source": "browser",
    "appVersion": "<hash>",
    "buildId": "<uuid>",
    "projectId": "<uuid>",
    "version": 14,
    "entries": [...]
  }
}
```

Wrapping the value in `{"json": …}` makes the server read an empty input
and fail Zod validation on `source`/`appVersion`. The MCP encodes the body
correctly in `src/webstudio-client.ts:158-167`.

Responses from `build.patch` come back as an array (also unwrapped):

```json
[
  { "result": { "data": { "status": "ok", "version": 15, "entries": [...] } } }
]
```

## Discovering `appVersion`

The server rejects mutations whose `appVersion` does not match the deployed
build hash. Hard-coding it would break on every Webstudio release.

`src/webstudio-client.ts:21-54` (`fetchAppVersion`) loads the project HTML
and tries three regex extractions in order:

1. `GIT_SHA: "<hash>"` from `window.ENV` (Remix env injection)
2. `clientVersion: "<hash>"` from a Vite/Remix manifest
3. `<meta name="x-webstudio-client-version" content="<hash>">`

When `applyTransaction` returns `version_mismatched` and the error message
mentions `appVersion`/`clientVersion`, the retry loop refreshes the cached
version automatically (`pushWithRetry` in `src/webstudio-client.ts:198-242`).

## Detecting expired sessions

`fetchBuild` and `applyTransaction` raise `AuthExpiredError` on HTTP 401 / 403.
The MCP surfaces this with a message that tells the user to re-run
`webstudio_setup_auth` with a fresh cookie. Cookies typically last a few days.

```ts
class AuthExpiredError extends Error {
  constructor(public readonly httpStatus: number) {
    super(`Webstudio session expired (HTTP ${httpStatus}) — refresh your cookie`);
  }
}
```

## Ideal future: project-scoped tokens

The Webstudio source has a token-based path (`x-auth-token`, table
`AuthorizationToken`, used by the `webstudio link` CLI). It is project-scoped
and bypasses CSRF, which would make a long-lived MCP integration much safer
than reusing user cookies. This implementation does not yet exercise that path
because no public endpoint provisions such tokens for an external app — but
the relevant code lives in:

- `apps/builder/app/shared/context.server.ts` — `extractAuthFromRequest` priorities
- `apps/builder/app/services/build-router.server.ts` — token validation on `build.patch`
