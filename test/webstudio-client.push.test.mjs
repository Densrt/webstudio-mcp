// Tests for the push-side of webstudio-client: applyTransaction + pushWithRetry.
// Both auth refresh on version_mismatched and the tRPC batch wire format are covered.
// HTTP is mocked via globalThis.fetch — no real network.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  AuthExpiredError,
  applyTransaction,
  pushWithRetry,
  __setBrowserAppVersionFetcher,
} from "../dist/webstudio-client.js";

// Prevent fetchAppVersion's Playwright fallback from launching a real Chromium
// and hitting the live Webstudio API with our mock cookie. Tests that need a
// specific browserFetcher behavior can override this in their own scope.
beforeEach(() => {
  __setBrowserAppVersionFetcher(async () => {
    throw new Error("playwright disabled in tests");
  });
});

let originalFetch;
let calls;

function installFetch(handler) {
  calls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length - 1);
  };
}

function makeResponse({ status = 200, body = "", json } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return typeof body === "string" ? body : JSON.stringify(body); },
    async json() { return json ?? (typeof body === "string" ? JSON.parse(body || "null") : body); },
  };
}

afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = undefined;
  __setBrowserAppVersionFetcher(undefined);
});

const cfg = () => ({
  projectId: "myproject",
  cookie: "session=abc",
  csrfToken: "csrf-1",
  appVersion: "v1",
});

const dummyTx = { id: "tx-1", payload: [] };

// ─── applyTransaction ─────────────────────────────────────────────────────────

test("applyTransaction sends the tRPC batch=1 envelope with the `0` key (no json wrapper)", async () => {
  installFetch(() =>
    makeResponse({
      status: 200,
      json: [{ result: { data: { status: "ok", version: 8, entries: [] } } }],
    }),
  );
  const result = await applyTransaction(cfg(), "build-1", 7, dummyTx);
  assert.equal(result.status, "ok");

  // Wire-level: URL ends with /trpc/build.patch?batch=1
  assert.match(calls[0].url, /\/trpc\/build\.patch\?batch=1$/);
  assert.equal(calls[0].init.method, "POST");

  const body = JSON.parse(calls[0].init.body);
  // tRPC batch quirk: keyed by "0", NOT wrapped in { json: ... }.
  assert.ok("0" in body, `body must have key "0"; got ${Object.keys(body)}`);
  assert.equal(body["0"].buildId, "build-1");
  assert.equal(body["0"].version, 7);
  assert.equal(body["0"].source, "browser");
  assert.equal(body["0"].appVersion, "v1");
  assert.deepEqual(body["0"].entries, [{ transaction: dummyTx }]);
  // Sanity: outgoing headers include csrf + appVersion + cookie + Content-Type.
  assert.equal(calls[0].init.headers["x-csrf-token"], "csrf-1");
  assert.equal(calls[0].init.headers["x-webstudio-client-version"], "v1");
  assert.equal(calls[0].init.headers.Cookie, "session=abc");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
});

test("applyTransaction throws AuthExpiredError on 401/403", async () => {
  installFetch(() => makeResponse({ status: 401 }));
  await assert.rejects(
    applyTransaction(cfg(), "b", 1, dummyTx),
    (err) => err instanceof AuthExpiredError && err.httpStatus === 401,
  );
  installFetch(() => makeResponse({ status: 403 }));
  await assert.rejects(
    applyTransaction(cfg(), "b", 1, dummyTx),
    (err) => err instanceof AuthExpiredError && err.httpStatus === 403,
  );
});

test("applyTransaction surfaces a tRPC `error` field as a thrown Error", async () => {
  installFetch(() => makeResponse({ status: 200, json: [{ error: { message: "bad input" } }] }));
  await assert.rejects(
    applyTransaction(cfg(), "b", 1, dummyTx),
    /tRPC error/,
  );
});

test("applyTransaction returns version_mismatched body without throwing", async () => {
  installFetch(() =>
    makeResponse({
      status: 200,
      json: [{ result: { data: { status: "version_mismatched", errors: "build moved on" } } }],
    }),
  );
  const result = await applyTransaction(cfg(), "b", 1, dummyTx);
  assert.equal(result.status, "version_mismatched");
});

// ─── pushWithRetry ────────────────────────────────────────────────────────────
//
// pushWithRetry calls fetchBuild (GET /rest/data/<pid>) then applyTransaction (POST /trpc/...).
// We dispatch based on URL so a single fetch stub serves both.

function dispatch({ buildHandler, applyHandler }) {
  return (url) => {
    if (url.endsWith("/trpc/build.patch?batch=1")) return applyHandler(url);
    return buildHandler(url);
  };
}

const fakeBuildResponse = (version) =>
  makeResponse({
    status: 200,
    json: {
      id: "buildX",
      projectId: "myproject",
      version,
      breakpoints: [],
      instances: [],
      props: [],
      styles: [],
      styleSources: [],
      styleSourceSelections: [],
      dataSources: [],
      resources: [],
      assets: [],
      pages: { homePageId: "h", rootFolderId: "r", pages: [], folders: [] },
      marketplaceProduct: null,
      createdAt: "", updatedAt: "",
    },
  });

test("pushWithRetry succeeds on first attempt and returns finalVersion", async () => {
  let applyCount = 0;
  installFetch(
    dispatch({
      buildHandler: () => fakeBuildResponse(1),
      applyHandler: () => {
        applyCount++;
        return makeResponse({
          status: 200,
          json: [{ result: { data: { status: "ok", version: 2, entries: [] } } }],
        });
      },
    }),
  );

  const { result, finalVersion, appVersionUpdated } = await pushWithRetry(cfg(), () => dummyTx);
  assert.equal(result.status, "ok");
  assert.equal(finalVersion, 2);
  assert.equal(applyCount, 1);
  assert.equal(appVersionUpdated, undefined);
});

test("pushWithRetry retries up to 3 times on version_mismatched, then throws", async () => {
  let applyCount = 0;
  installFetch(
    dispatch({
      buildHandler: () => fakeBuildResponse(1),
      applyHandler: () => {
        applyCount++;
        return makeResponse({
          status: 200,
          json: [{ result: { data: { status: "version_mismatched", errors: "stale" } } }],
        });
      },
    }),
  );

  await assert.rejects(
    pushWithRetry(cfg(), () => dummyTx),
    /after 3 retries.*version_mismatched/i,
  );
  assert.equal(applyCount, 3, "should attempt exactly maxRetries times");
});

test("pushWithRetry refreshes appVersion when the mismatch error mentions clientVersion", async () => {
  let applyCount = 0;
  let appVersionFetchCount = 0;
  const config = cfg();

  installFetch((url) => {
    if (url.endsWith("/trpc/build.patch?batch=1")) {
      applyCount++;
      if (applyCount === 1) {
        return makeResponse({
          status: 200,
          json: [{
            result: { data: { status: "version_mismatched", errors: "clientVersion mismatch" } },
          }],
        });
      }
      return makeResponse({
        status: 200,
        json: [{ result: { data: { status: "ok", version: 5, entries: [] } } }],
      });
    }
    if (url.endsWith("/rest/data/myproject")) return fakeBuildResponse(1);
    // The "/" root request — that's the appVersion refresh path.
    appVersionFetchCount++;
    return makeResponse({
      status: 200,
      body: `<html><script>GIT_SHA: "v2-fresh"</script></html>`,
    });
  });

  const { result, finalVersion, appVersionUpdated } = await pushWithRetry(config, () => dummyTx);
  assert.equal(result.status, "ok");
  assert.equal(finalVersion, 5);
  assert.equal(appVersionFetchCount, 1, "appVersion refresh should happen once");
  assert.equal(appVersionUpdated, "v2-fresh");
  assert.equal(config.appVersion, "v2-fresh", "config mutated in place");
});
