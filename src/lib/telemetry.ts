// Telemetry — opt-in JSONL logger for tool calls and silent coercions.
//
// Gated by env var WEBSTUDIO_MCP_TELEMETRY=1. When disabled, every call is a
// no-op (zero file I/O, zero allocations on the hot path). When enabled,
// events are appended one per line to:
//   1. $WEBSTUDIO_MCP_TELEMETRY_PATH if set (explicit override — recommended
//      in deployments where the MCP runs under a different user than the one
//      owning $HOME).
//   2. otherwise ~/.webstudio-mcp-telemetry.jsonl (homedir()).
//
// Two event families ship in v2.7.4:
//   • event:"tool_call"  — one row per MCP tool invocation (tool, action,
//                          success, duration_ms, error_class?).
//   • event:"coerce"     — one row per silent server-side normalisation that
//                          would otherwise be invisible to the caller (key
//                          identifies which coerce: "expand:gridColumn",
//                          "coerce:aspectRatio", "detect:manual-single-cell",
//                          etc.). Counted by scripts/telemetry-report.mjs to
//                          surface "what does the model keep getting wrong".
//
// API is intentionally generic: callers pass any extra keys they want — we
// only add `ts` if missing. Schema-on-read (the report script knows what to
// extract per event type).

import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

let telemetryEnabled = process.env.WEBSTUDIO_MCP_TELEMETRY === "1";
// Allow an explicit override path via env var — useful when homedir() points at
// a directory the MCP user cannot write to.
let telemetryLogPath: string | null = telemetryEnabled
  ? (process.env.WEBSTUDIO_MCP_TELEMETRY_PATH?.trim() || join(homedir(), ".webstudio-mcp-telemetry.jsonl"))
  : null;

/** True if telemetry env var is set (or enabled via test override). */
export function isTelemetryEnabled(): boolean {
  return telemetryEnabled;
}

/** Log path for tests + the report script. Null if telemetry is disabled. */
export function getTelemetryLogPath(): string | null {
  return telemetryLogPath;
}

/** TEST-ONLY: override the enabled flag and log path. Pass null to disable. */
export function _setTelemetryForTests(opts: { enabled: boolean; path: string | null }): void {
  telemetryEnabled = opts.enabled;
  telemetryLogPath = opts.path;
}

/**
 * Append one event line to the telemetry JSONL file.
 *
 * Generic shape — pass any keys you want. We only ensure `ts` is set (ISO).
 * Best-effort: any error during write is swallowed (telemetry must NEVER
 * break a tool call).
 *
 * Examples:
 *   logTelemetry({ event: "tool_call", tool: "styles", action: "update", success: true, duration_ms: 42 });
 *   logTelemetry({ event: "coerce", key: "expand:gridColumn", source: "styles.update", projectSlug: "my-site" });
 */
export async function logTelemetry(
  event: Record<string, unknown> & { event?: string; ts?: string },
): Promise<void> {
  if (!telemetryEnabled || !telemetryLogPath) return;
  try {
    const enriched = { ts: event.ts ?? new Date().toISOString(), ...event };
    await appendFile(telemetryLogPath, JSON.stringify(enriched) + "\n");
  } catch {
    // best-effort — never break a tool call because telemetry write failed
  }
}

/**
 * Convenience helper for coerce events — same as logTelemetry({event:"coerce", key, ...rest})
 * but reads better at call sites. Use this from libs that emit silent
 * normalisations (expand-shorthand, style-coerce, etc.).
 */
export async function logCoerce(
  key: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await logTelemetry({ event: "coerce", key, ...extra });
}
