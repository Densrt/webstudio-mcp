# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use this repository's
**GitHub Security Advisories** ("Security" tab → "Report a vulnerability") for private
disclosure. We aim to acknowledge reports within a few business days.

## Supported versions

Security fixes target the latest released minor version. Older versions are not
back-patched.

## Threat model & operational notes

This is an **unofficial** MCP server that drives Webstudio Cloud through a captured
browser **session cookie + CSRF token**. Operators should understand the following before
exposing it — especially to automated / untrusted prompt input.

- **The credential is account-scoped, not project-scoped.** The session cookie grants
  access to **every project on the Webstudio account**, not just the one you are editing.
  It is stored locally at `~/.webstudio-mcp/projects/<slug>/webstudio-auth.json` with `0600`
  permissions and is never logged. The per-project **`allowPush` gate** (off by default)
  guards against accidental writes to the wrong project.

- **Destructive actions default to a dry run.** `project.nuke` and every `*.delete` action
  default to `dryRun: true` and require an explicit confirmation (and `allowPush`) to
  mutate. `project.nuke` additionally requires `confirm` to equal the project slug.

- **`assets.upload` URL fetch is SSRF-guarded.** Caller-supplied URLs are restricted to
  public `http(s)` hosts; loopback, private, link-local (incl. the cloud-metadata endpoint
  `169.254.169.254`), unique-local and CGNAT addresses are rejected. **Caveat:** HTTP
  redirects are followed and **not** re-validated, so do not aim it at untrusted redirectors.

- **`assets.upload` `filePath` reads the host filesystem.** It reads with the MCP process's
  permissions. When the server is exposed to untrusted prompt input, treat `filePath` as a
  sensitive surface — a malicious prompt could attempt to upload local files.

- **`projectSlug` is path-traversal validated** (charset-restricted + resolved-path
  containment check) before it is used as an on-disk directory name.

- **Headless Chromium runs with `--no-sandbox`.** The optional Playwright probe that reads
  the Webstudio app version launches Chromium with `--no-sandbox` for container/root
  compatibility. It only ever navigates to your own project's `apps.webstudio.is` origin.
  Prefer running this MCP as a **non-root** user in a sandboxed environment.

- **CMS adapter config holds third-party credentials in plaintext.** Files under
  `~/.webstudio-mcp/cms/*.json` (Directus token, WordPress application password, n8n API
  key) are read but **not created** by the MCP — `chmod 600` them yourself.

- **Telemetry is opt-in.** It is disabled unless `WEBSTUDIO_MCP_TELEMETRY=1` is set, and
  records only `tool` / `action` / `projectSlug` / duration — never credentials or input
  values.

## Hardening checklist for operators

- Run the MCP as a non-root user.
- Keep `allowPush` off except on projects you intend to write to.
- `chmod 600 ~/.webstudio-mcp/cms/*.json` if you use CMS adapters.
- Treat the MCP host as trusted: `filePath` uploads and the session cookie make it a
  credential-bearing process.
