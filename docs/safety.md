# Safety

A reusable browser cookie is the only auth mechanism available today, and it
is **account-scoped**. With one `setup_auth` call, an external client has
write access to every project the user owns. The cost of pushing to the
wrong project is high — Webstudio has no built-in version history visible
to API clients, no rollback button, no undo across sessions.

This document is the protocol the MCP enforces around that risk.

## Threat model

- **Wrong slug typo.** A model or script confuses two project slugs and pushes
  a fragment into a production site.
- **Concurrent builder session.** The user has the builder open while a push
  lands. Webstudio detects the version mismatch and forces a reload, which
  can drop unsaved local changes.
- **Stale fragment.** A pre-built fragment is pushed against a build whose
  shape has shifted (page deleted, parent renamed). The push succeeds but
  the structure is broken.
- **Expired cookie at the wrong moment.** A long-running flow attempts a
  push after the session has expired and fails after partial mutations.

## Built-in protections

### `allowPush` whitelist

The auth file (`projects/{slug}/webstudio-auth.json`, mode 0600) carries an
`allowPush: boolean`. The push tools refuse to proceed unless it is `true`:

```ts
function requirePushAuth(slug: string) {
  const auth = requireAuth(slug);
  if (auth.allowPush !== true) throw new Error("Push refused: allowPush is not true");
  return auth;
}
```

`src/auth.ts:43-54`. The flag toggles via a dedicated tool — there is no
implicit promotion. Production projects keep it `false` between sessions.

### Mandatory dry-run

Every push tool accepts a `dryRun` flag that:

1. Fetches `/rest/data/{projectId}` with the configured cookie
2. Returns the **server-reported project name** (`build.project.title`)
3. Echoes the target page, parent instance id, and a summary of the
   fragment that would be pushed
4. Performs no mutation

The expected flow is: dry-run, human reads the project name, human
explicitly confirms, then push.

### Confirmation gate

Before any non-dry-run mutation against a production project, the protocol
expects an explicit confirmation from the user that mentions the slug **and**
the server-reported name. Test projects have a lighter bar.

### Always re-fetch before patching

The retry loop in `src/webstudio-client.ts:198-242` (`pushWithRetry`)
re-fetches the build at the start of each attempt. The transaction is
constructed against the freshly fetched build version and shape. This is
also the correct response to `version_mismatched` — never mutate against
a stale snapshot.

### `appVersion` auto-refresh

When the server rejects a patch with a `version_mismatched` whose error
mentions `appVersion` / `clientVersion`, the retry loop refreshes the
cached build hash via `fetchAppVersion` and tries again. Avoids forcing
the user back into DevTools every time Webstudio deploys.

## Recommended operational protocol

Before any push:

1. Ask for the slug explicitly. Never guess one from prior context.
2. Run `fetch_pages` first — confirm the page id and `rootInstanceId` are
   what you expect.
3. Run the push with `dryRun: true` and read back the project name.
4. Get explicit confirmation from the user.
5. Set `allowPush: true` only after the confirmation.
6. Push.
7. Set `allowPush: false` after the session ends, especially for
   production projects.

Ask the user to **close the builder tab** before the push lands. Otherwise
Webstudio detects the version mismatch on their open client and forces a
reload toast, potentially losing unsaved local changes.

## What's missing

- **No automatic snapshot before patch.** The implementation does not yet
  capture the pre-push build to disk. Adding it would make recovery from
  bad pushes a one-line revert.
- **No project-scoped tokens.** Browser cookies remain the auth path,
  inheriting the account-wide scope. A first-class API token system on
  Webstudio's side would obsolete most of this document.
- **No conflict detection beyond version.** Concurrent edits that target
  different parts of the build still produce `version_mismatched` after
  the first lands. A semantic merge would be a Webstudio-side feature.
