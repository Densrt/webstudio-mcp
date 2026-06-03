// File-content acquisition for asset uploads — supports local path, base64,
// and remote URL fetch.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { lookup } from "node:dns/promises";
import net from "node:net";

export type ResolveInput = {
  filePath?: string;
  base64Content?: string;
  url?: string;
  filename?: string;
};

/** True for IPv4/IPv6 addresses that must never be fetched from: loopback, private,
 *  link-local (incl. the cloud metadata endpoint 169.254.169.254), unique-local, CGNAT. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;       // this-host / private / loopback
    if (a === 172 && b >= 16 && b <= 31) return true;         // private
    if (a === 192 && b === 168) return true;                  // private
    if (a === 169 && b === 254) return true;                  // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true;        // CGNAT 100.64/10
    return false;
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;                 // loopback / unspecified
  if (v.startsWith("fc") || v.startsWith("fd")) return true;  // unique-local fc00::/7
  if (/^fe[89ab]/.test(v)) return true;                       // link-local fe80::/10
  const mapped = v.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/); // IPv4-mapped IPv6
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

/** SSRF guard for caller-supplied URLs: only http(s), and the host must not resolve to a
 *  private/loopback/link-local address. NOTE: HTTP redirects are followed by fetch() and
 *  are NOT re-validated here (see SECURITY.md). Since the MCP is agent-driven, this blocks
 *  the common "fetch http://169.254.169.254/… or http://localhost:port" prompt-injection vector. */
export async function assertPublicHttpUrl(urlStr: string): Promise<void> {
  let u: URL;
  try { u = new URL(urlStr); } catch { throw new Error(`Invalid URL: ${urlStr}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are allowed for asset upload (got "${u.protocol}").`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error(`Refusing to fetch "localhost" (SSRF guard).`);
  }
  const ips = net.isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      throw new Error(`Refusing to fetch a private/loopback/link-local address (${host} → ${ip}) — SSRF guard.`);
    }
  }
}

export async function resolveBuffer(input: ResolveInput): Promise<{ buffer: Buffer; filename: string }> {
  if (input.filePath) {
    // NOTE: reads from the MCP HOST filesystem with this process's permissions. When the
    // MCP is exposed to untrusted prompt input, treat filePath as a sensitive surface
    // (a malicious prompt could try to upload local secrets) — see SECURITY.md.
    const buf = await readFile(input.filePath);
    const fname = input.filename ?? basename(input.filePath);
    return { buffer: buf, filename: fname };
  }
  if (input.url) {
    await assertPublicHttpUrl(input.url);
    const res = await fetch(input.url);
    if (!res.ok) throw new Error(`Fetch URL failed: HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    const fname = input.filename ?? (basename(new URL(input.url).pathname) || "download.bin");
    return { buffer: buf, filename: fname };
  }
  const buf = Buffer.from(input.base64Content!, "base64");
  if (!input.filename) throw new Error("filename is required when using base64Content");
  return { buffer: buf, filename: input.filename };
}
