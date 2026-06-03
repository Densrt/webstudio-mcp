// Tests for the read-side of webstudio-client: fetchAppVersion + fetchBuild + AuthExpiredError.
// All HTTP is mocked via globalThis.fetch — no real network.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  AuthExpiredError,
  fetchAppVersion,
  fetchBuild,
  commonHeaders,
  __setBrowserAppVersionFetcher,
} from "../dist/webstudio-client.js";

// Stub the headless-browser fallback so tests stay fast and offline.
// Each test that exercises the fallback overrides browserStub.
let browserStub = async () => { throw new Error("browser fetcher not stubbed for this test"); };
__setBrowserAppVersionFetcher((id, c) => browserStub(id, c));

// ─── fetch stub helpers ───────────────────────────────────────────────────────

let originalFetch;
let calls; // captured request descriptors per test

function installFetch(handler) {
  calls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
}

function makeResponse({ status = 200, body = "", json, headers = {} } = {}) {
  const hdr = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => hdr.get(String(name).toLowerCase()) ?? null },
    async text() { return typeof body === "string" ? body : JSON.stringify(body); },
    async json() { return json ?? (typeof body === "string" ? JSON.parse(body || "null") : body); },
  };
}

beforeEach(() => { /* per-test installFetch */ });
afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = undefined;
});

// ─── AuthExpiredError ─────────────────────────────────────────────────────────

test("AuthExpiredError carries name + httpStatus and a helpful message", () => {
  const err = new AuthExpiredError(401);
  assert.equal(err.name, "AuthExpiredError");
  assert.equal(err.httpStatus, 401);
  assert.ok(err instanceof Error);
  assert.match(err.message, /401/);
  assert.match(err.message, /webstudio_setup_auth/);
});

// ─── fetchAppVersion ──────────────────────────────────────────────────────────

test("fetchAppVersion extracts GIT_SHA from builder HTML", async () => {
  installFetch(() =>
    makeResponse({
      status: 200,
      body: `<html><script>window.ENV = { GIT_SHA: "abc123def" };</script></html>`,
    }),
  );
  const version = await fetchAppVersion("myproject", "cookie=val");
  assert.equal(version, "abc123def");
  // Sanity: the cookie was forwarded.
  assert.equal(calls[0].init.headers.Cookie, "cookie=val");
  assert.match(calls[0].url, /p-myproject\.apps\.webstudio\.is/);
});

test("fetchAppVersion falls back to clientVersion when GIT_SHA is absent", async () => {
  installFetch(() =>
    makeResponse({
      status: 200,
      body: `<html><script>"clientVersion":"deadbeef-99"</script></html>`,
    }),
  );
  const version = await fetchAppVersion("myproject", "cookie=val");
  assert.equal(version, "deadbeef-99");
});

test("fetchAppVersion falls back to the meta tag as a last resort", async () => {
  installFetch(() =>
    makeResponse({
      status: 200,
      body: `<html><head><meta name="x-webstudio-client-version" content="meta-vXYZ"></head></html>`,
    }),
  );
  const version = await fetchAppVersion("myproject", "cookie=val");
  assert.equal(version, "meta-vXYZ");
});

test("fetchAppVersion falls back to headless browser when HTML has no marker", async () => {
  installFetch(() => makeResponse({ status: 200, body: `<html><body>nothing here</body></html>` }));
  browserStub = async () => "browser-v-abc123";
  const v = await fetchAppVersion("myproject", "cookie=val");
  assert.equal(v, "browser-v-abc123");
});

test("fetchAppVersion falls back to headless browser when HTML fetch fails (500)", async () => {
  installFetch(() => makeResponse({ status: 500, body: "boom" }));
  browserStub = async () => "browser-v-from-500";
  const v = await fetchAppVersion("myproject", "cookie=val");
  assert.equal(v, "browser-v-from-500");
});

test("fetchAppVersion throws a combined error when HTML AND browser both fail", async () => {
  installFetch(() => makeResponse({ status: 200, body: `<html><body>nothing here</body></html>` }));
  browserStub = async () => { throw new Error("Chromium not found"); };
  await assert.rejects(
    fetchAppVersion("myproject", "cookie=val"),
    (err) => err.name !== "AuthExpiredError"
      && /appVersion auto-fetch failed/i.test(err.message)
      && /Chromium not found/.test(err.message)
      && /F12/.test(err.message),
  );
});

// ─── AuthExpired detection (v2.4 — distinguish expired-session from CF/bot blocks) ───

test("fetchAppVersion throws AuthExpiredError when builder 302-redirects to /login", async () => {
  installFetch(() => makeResponse({
    status: 302,
    headers: { location: "https://apps.webstudio.is/login?returnTo=..." },
  }));
  // Browser must NOT be called — auth-expired is terminal (both routes will fail the same way).
  let browserCalled = false;
  browserStub = async () => { browserCalled = true; return "should-not-be-used"; };

  await assert.rejects(
    fetchAppVersion("myproject", "cookie=stale"),
    (err) => err.name === "AuthExpiredError" && err.httpStatus === 302,
  );
  assert.equal(browserCalled, false, "browser fallback must be skipped on AuthExpiredError");
});

test("fetchAppVersion throws AuthExpiredError when builder 302-redirects to /oauth/", async () => {
  installFetch(() => makeResponse({
    status: 302,
    headers: { location: "https://apps.webstudio.is/oauth/ws/authorize?client_id=..." },
  }));
  browserStub = async () => "should-not-be-used";

  await assert.rejects(
    fetchAppVersion("myproject", "cookie=stale"),
    (err) => err.name === "AuthExpiredError",
  );
});

test("fetchAppVersion treats unrelated 3xx redirects as a normal HTML failure (falls back to browser)", async () => {
  // Some other 302 (e.g. to a CDN asset) should not be confused with auth expiry.
  installFetch(() => makeResponse({
    status: 302,
    headers: { location: "https://cdn.webstudio.is/static/foo.html" },
  }));
  browserStub = async () => "browser-v-recovered";

  const v = await fetchAppVersion("myproject", "cookie=val");
  assert.equal(v, "browser-v-recovered");
});

test("fetchAppVersion uses redirect:manual to detect the auth redirect (no auto-follow)", async () => {
  installFetch(() => makeResponse({
    status: 302,
    headers: { location: "https://apps.webstudio.is/login" },
  }));
  browserStub = async () => "should-not-be-used";

  await assert.rejects(fetchAppVersion("myproject", "cookie=val"));
  // The single fetch call must explicitly set redirect:"manual" — otherwise
  // the 302 would be silently followed and we'd misread "/login" 200 OK as
  // "no marker found", waste 15s in the browser, then surface a confusing
  // timeout instead of a clean AuthExpiredError.
  assert.equal(calls[0].init.redirect, "manual");
});

// ─── commonHeaders ────────────────────────────────────────────────────────────

test("commonHeaders includes cookie + csrf + app-version + sec-fetch headers", () => {
  const cfg = {
    projectId: "myproject",
    cookie: "session=abc; __Host-_csrf_1=xyz",
    csrfToken: "xyz",
    appVersion: "v1",
  };
  const h = commonHeaders(cfg);
  assert.equal(h.Cookie, cfg.cookie);
  assert.equal(h["x-csrf-token"], "xyz");
  assert.equal(h["x-webstudio-client-version"], "v1");
  assert.equal(h["x-webstudio-client"], "browser");
  assert.equal(h["sec-fetch-mode"], "cors");
  assert.equal(h["sec-fetch-site"], "same-origin");
  assert.equal(h["sec-fetch-dest"], "empty");
  assert.ok(h.Referer.includes("p-myproject"));
  // No Content-Type / Origin when withContent=false
  assert.equal(h["Content-Type"], undefined);
  assert.equal(h.Origin, undefined);

  const hw = commonHeaders(cfg, true);
  assert.equal(hw["Content-Type"], "application/json");
  assert.ok(hw.Origin?.includes("p-myproject"));
});

// ─── fetchBuild ───────────────────────────────────────────────────────────────

test("fetchBuild parses the JSON body on 200 OK", async () => {
  const fakeBuild = { id: "buildX", projectId: "myproject", version: 7 };
  installFetch(() => makeResponse({ status: 200, json: fakeBuild }));
  const result = await fetchBuild({
    projectId: "myproject",
    cookie: "c",
    csrfToken: "t",
    appVersion: "v1",
  });
  assert.deepEqual(result, fakeBuild);
  // wire-level: GET /rest/data/<projectId>
  assert.match(calls[0].url, /\/rest\/data\/myproject$/);
});

test("fetchBuild throws AuthExpiredError on 401 and 403", async () => {
  installFetch(() => makeResponse({ status: 401, body: "unauthorized" }));
  await assert.rejects(
    fetchBuild({ projectId: "p", cookie: "c", csrfToken: "t", appVersion: "v" }),
    (err) => err instanceof AuthExpiredError && err.httpStatus === 401,
  );

  installFetch(() => makeResponse({ status: 403, body: "forbidden" }));
  await assert.rejects(
    fetchBuild({ projectId: "p", cookie: "c", csrfToken: "t", appVersion: "v" }),
    (err) => err instanceof AuthExpiredError && err.httpStatus === 403,
  );
});

test("fetchBuild throws a plain Error (not AuthExpired) on 500", async () => {
  installFetch(() => makeResponse({ status: 500, body: "server boom" }));
  await assert.rejects(
    fetchBuild({ projectId: "p", cookie: "c", csrfToken: "t", appVersion: "v" }),
    (err) => !(err instanceof AuthExpiredError) && /fetchBuild failed: 500/.test(err.message),
  );
});
