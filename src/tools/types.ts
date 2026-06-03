// Shared interface for MCP tool modules.
// Each tool exports a definition (for ListToolsRequest) + a handler.

import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { ERROR_CODES, type ErrorCode } from "./error-codes.js";

export type ToolHandler = (args: unknown) => Promise<CallToolResult>;

export type ToolModule = {
  definition: Tool;
  handler: ToolHandler;
};

export function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError && { isError: true }) };
}

/**
 * Structured error return. Sets isError=true. Payload shape:
 *   { ok: false, code: <ErrorCode>, message: string, hint?: string }
 *
 * The hint defaults to the ERROR_CODES catalog entry — pass an explicit
 * hint to override (e.g. when project-specific context helps the caller).
 */
export function errorResult(code: ErrorCode, message: string, hint?: string): CallToolResult {
  const payload = {
    ok: false,
    code,
    message,
    hint: hint ?? ERROR_CODES[code],
  };
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

/**
 * Map an Error thrown by requireAuth/requirePushAuth to the right structured
 * code. Returns AUTH_MISSING for "not configured", PUSH_DISABLED for
 * "Push refused", INTERNAL_ERROR otherwise.
 */
export function authErrorResult(err: unknown): CallToolResult {
  const msg = (err as Error).message ?? String(err);
  if (msg.startsWith("Push refused")) return errorResult("PUSH_DISABLED", msg);
  if (msg.includes("auth not configured")) return errorResult("AUTH_MISSING", msg);
  return errorResult("INTERNAL_ERROR", msg);
}

/**
 * Map an error caught around a Webstudio HTTP call (fetchBuild, pushWithRetry,
 * applyTransaction, fetchAppVersion). Recognises AuthExpiredError by name
 * and 401/403 mentions, otherwise returns INTERNAL_ERROR.
 */
export function runtimeErrorResult(err: unknown, prefix?: string): CallToolResult {
  const e = err as Error;
  const msg = e?.message ?? String(err);
  const full = prefix ? `${prefix}: ${msg}` : msg;
  if (e?.name === "AuthExpiredError" || /\b(401|403)\b/.test(msg)) {
    return errorResult("AUTH_EXPIRED", full);
  }
  if (msg.includes("version_mismatched")) {
    return errorResult("VERSION_MISMATCHED", full);
  }
  return errorResult("INTERNAL_ERROR", full);
}
