// Initial catalog of structured error codes returned by Webstudio MCP tool
// handlers. Each entry maps a discriminant key to a default action-oriented
// hint that helps the LLM (or an automated orchestrator) recover.
//
// HOW TO ADD A NEW CODE
//   1. Hit a test session where an existing error doesn't fit cleanly.
//   2. Add a new key to `ERROR_CODES` below (alphabetical or grouped).
//   3. Update the handler(s) that should emit it.
//   4. Log the addition in `tasks/error-codes-log.md` with: date, code,
//      one-line "why", and the originating test session.
//   5. Commit the change.
//
// CONVENTIONS
//   - The value is the *default hint* — what should the caller do next.
//   - The per-call `message` carries the specific failure context (which
//     project, ID, prop, etc.). The hint is meant to be re-usable across
//     occurrences of the same code.
//   - Don't invent speculative codes — grow the catalog from real friction.
//
// See `src/tools/types.ts` → `errorResult()` for the wire format.

export const ERROR_CODES = {
  AUTH_EXPIRED:        "Session cookie expired. Open the Webstudio builder in a browser, F12 → Network → any /trpc/ request → Request Headers → copy the full Cookie header and the x-csrf-token header, then re-run webstudio_setup_auth (appVersion auto-fetches).",
  AUTH_MISSING:        "No auth registered for this project. Run webstudio_setup_auth with cookie + csrfToken from DevTools (Network → /trpc/ request headers).",
  PUSH_DISABLED:       "allowPush is false for this project. Confirm the project name, then enable via webstudio_allow_push.",
  PROJECT_NOT_FOUND:   "Project slug not found in local config. Run webstudio_init_project first or check webstudio_list_projects.",
  PAGE_NOT_FOUND:      "Page not found. Check pagePath / pageId via webstudio_fetch_pages.",
  INSTANCE_NOT_FOUND:  "Instance ID not found in the current build. Use webstudio_list_instances to discover IDs.",
  TOKEN_NOT_FOUND:     "Token not found by name or ID. List via webstudio_list_tokens.",
  ASSET_NOT_FOUND:     "Asset ID not found. List via webstudio_list_assets.",
  ASSET_PREFIX_AMBIGUOUS: "Multiple assets match the provided sha256 prefix. Pass a longer prefix or the full id (list with webstudio_list_assets fullIds=true).",
  VARIABLE_NOT_FOUND:  "Variable not found. List via webstudio_list_variables.",
  RESOURCE_NOT_FOUND:  "Resource not found. List via webstudio_list_resources.",
  CSS_VAR_NOT_FOUND:   "CSS variable not declared at :root. List via webstudio_css_var.",
  VERSION_MISMATCHED:  "Build version drifted (concurrent edit). Auto-retry will refetch; if persistent, close the builder.",
  VALIDATION_FAILED:   "Input did not match the tool schema. Check argument names and types.",
  CONTEXT_REQUIRED_FOR_CRITICAL: "This action is CRITICAL (destructive at project scale). Provide a 15-25 word third-person `context` summarising why the call is being made (no PII, no secrets).",
  CONTEXT_INVALID_FORMAT: "The `context` field failed format validation. Use 15-25 words, third-person (no I/we/you/my/our/your), no PII (email/IP), no secrets (token/password/api-key).",
  ROOT_FOLDER_PROTECTED: "The project's ROOT folder cannot be deleted (always refused, even with force=true). To clean a project's folder structure, target child folders individually or use pages.delete to remove pages without their parent folder.",
  BUILDER_OPEN_WARNING:"Push succeeded but builder was open — user will see a reload toast.",
  RADIX_TRIGGER_POLLUTION: "Presentation prop (class/className/style/id) or local style set on a Radix non-rendering wrapper (DialogTrigger, etc.). Radix forwards props via React.cloneElement (asChild) — your prop overwrites the child's Webstudio atomic hash class, causing a SPA-navigation rendering bug. Move the prop/style to the first child (Button/Link) that actually renders DOM. See docs/patterns/sheet-mobile-radix.md § Major pitfall. Pass ignoreWrapperWarning=true to bypass (not recommended).",
  INTERNAL_ERROR:      "Unexpected error. See message field for details.",
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
