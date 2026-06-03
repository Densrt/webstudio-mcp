// Two-step Webstudio asset upload over HTTP:
//   1. POST /rest/assets (multipart) — register the metadata
//   2. POST /rest/assets/<name>     — upload the raw bytes

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorResult, runtimeErrorResult } from "../types.js";
import { origin, commonHeaders, AuthExpiredError } from "../../webstudio-client.js";
import type { WebstudioConfig } from "../../webstudio-client.js";
type AuthConfig = WebstudioConfig;

export type RegisterResult =
  | { ok: true; registeredName: string }
  | { ok: false; result: CallToolResult };

export async function registerAsset(
  auth: AuthConfig,
  assetId: string,
  assetType: "image" | "font",
  filename: string,
): Promise<RegisterResult> {
  const form = new FormData();
  form.append("assetId", assetId);
  form.append("projectId", auth.projectId);
  form.append("type", assetType);
  form.append("filename", filename);

  const registerUrl = `${origin(auth.projectId)}/rest/assets`;
  const headers = commonHeaders(auth);
  // Do NOT set Content-Type for multipart — fetch will set it with the boundary.
  delete headers["Content-Type"];
  headers["Origin"] = origin(auth.projectId);

  try {
    const res = await fetch(registerUrl, { method: "POST", headers, body: form });
    if (res.status === 401 || res.status === 403) throw new AuthExpiredError(res.status);
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      return { ok: false, result: errorResult("INTERNAL_ERROR", `Register failed (HTTP ${res.status}): ${body}`) };
    }
    const data = (await res.json()) as { name?: string };
    if (!data.name) {
      return { ok: false, result: errorResult("INTERNAL_ERROR", `Register response missing "name" field: ${JSON.stringify(data)}`) };
    }
    return { ok: true, registeredName: data.name };
  } catch (err) {
    return { ok: false, result: runtimeErrorResult(err, "Register request failed") };
  }
}

export async function uploadAssetBytes(
  auth: AuthConfig,
  registeredName: string,
  buffer: Buffer,
  mime: string,
): Promise<{ ok: true } | { ok: false; result: CallToolResult }> {
  const uploadUrl = `${origin(auth.projectId)}/rest/assets/${encodeURIComponent(registeredName)}`;
  const headers = commonHeaders(auth);
  headers["Content-Type"] = mime;
  headers["Origin"] = origin(auth.projectId);

  try {
    // Copy to a fresh ArrayBuffer to satisfy TS strict typings (Buffer.buffer may be SharedArrayBuffer).
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const bodyBlob = new Blob([ab], { type: mime });
    const res = await fetch(uploadUrl, { method: "POST", headers, body: bodyBlob });
    if (res.status === 401 || res.status === 403) throw new AuthExpiredError(res.status);
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      return {
        ok: false,
        result: errorResult(
          "INTERNAL_ERROR",
          `Binary upload failed (HTTP ${res.status}) for "${registeredName}": ${body}`,
        ),
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, result: runtimeErrorResult(err, "Binary upload request failed") };
  }
}
