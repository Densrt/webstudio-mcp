// Context param validator (workstream 2, v1.0 prep).
//
// v1.0 mega-tools accept a `context` field (15-25 words, third-person, no PII) that
// the LLM populates to explain WHY it's calling the tool. The enforcement is tiered:
//
// - CRITICAL: required. Refused if absent (CONTEXT_REQUIRED_FOR_CRITICAL).
// - STRUCTURING: recommended. Accepted absent, returns a hint to the caller.
// - TACTICAL: optional. No friction.
// - READ-ONLY: optional. Not pertinent (no audit need).
//
// Logging is fire-and-forget JSONL into ~/.webstudio-mcp-context.jsonl
// (opt-out via env var WEBSTUDIO_MCP_CONTEXT_LOG=0).

import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type Tier = "CRITICAL" | "STRUCTURING" | "TACTICAL" | "READ-ONLY";

const FIRST_PERSON_PATTERN = /\b(I|we|you|my|our|your)\b/i;
const EMAIL_PATTERN = /\S+@\S+\.\S+/;
const IP_PATTERN = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
const SECRET_PATTERN = /\b(password|token|secret|api[-_]?key)\b/i;

const MIN_WORDS = 15;
const MAX_WORDS = 25;

export type ValidationResult =
  | { ok: true; hint?: string }
  | { ok: false; code: "CONTEXT_REQUIRED_FOR_CRITICAL" | "CONTEXT_INVALID_FORMAT"; error: string };

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function checkFormat(context: string): { ok: true } | { ok: false; reason: string } {
  const wordCount = countWords(context);
  if (wordCount < MIN_WORDS) {
    return { ok: false, reason: `context too short: ${wordCount} words (min ${MIN_WORDS})` };
  }
  if (wordCount > MAX_WORDS) {
    return { ok: false, reason: `context too long: ${wordCount} words (max ${MAX_WORDS})` };
  }
  if (FIRST_PERSON_PATTERN.test(context)) {
    const match = context.match(FIRST_PERSON_PATTERN)![0];
    return {
      ok: false,
      reason: `context must be third-person — found pronoun "${match}". Rewrite as "the caller wants to..." or "the agent will...".`,
    };
  }
  if (EMAIL_PATTERN.test(context) || IP_PATTERN.test(context)) {
    return { ok: false, reason: `context must not contain PII (email or IP address detected)` };
  }
  if (SECRET_PATTERN.test(context)) {
    return { ok: false, reason: `context must not mention secrets/credentials (token/password/api-key)` };
  }
  return { ok: true };
}

/**
 * Validate a `context` string against tier rules. Returns { ok: true } if valid,
 * { ok: true, hint: "..." } if STRUCTURING/TACTICAL/READ-ONLY missing but acceptable,
 * { ok: false, code, error } if CRITICAL missing or format invalid.
 */
export function validateContext(context: string | undefined, tier: Tier): ValidationResult {
  if (context === undefined || context === null || context === "") {
    if (tier === "CRITICAL") {
      return {
        ok: false,
        code: "CONTEXT_REQUIRED_FOR_CRITICAL",
        error: `context is required for CRITICAL actions. Provide a 15-25 word third-person summary of why this call is being made (no PII, no secrets).`,
      };
    }
    if (tier === "STRUCTURING") {
      return {
        ok: true,
        hint: `Consider providing 'context' (15-25 words) for STRUCTURING actions — it improves audit trail and helps future debugging.`,
      };
    }
    return { ok: true };
  }
  const formatCheck = checkFormat(context);
  if (!formatCheck.ok) {
    return { ok: false, code: "CONTEXT_INVALID_FORMAT", error: formatCheck.reason };
  }
  return { ok: true };
}

const LOG_PATH = join(homedir(), ".webstudio-mcp-context.jsonl");
const LOG_ENABLED = process.env.WEBSTUDIO_MCP_CONTEXT_LOG !== "0";

export type ContextLogEntry = {
  tool: string;
  action: string;
  tier: Tier;
  context: string | undefined;
  projectSlug?: string;
};

/**
 * Fire-and-forget logging — never throws, returns immediately.
 * Append-only JSONL with timestamp. Opt-out via env WEBSTUDIO_MCP_CONTEXT_LOG=0.
 */
export function logContext(entry: ContextLogEntry): void {
  if (!LOG_ENABLED) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  appendFile(LOG_PATH, line).catch(() => {
    // Silent fail — logging must never block tool execution.
  });
}
