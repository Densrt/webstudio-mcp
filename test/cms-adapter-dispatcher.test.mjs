// Unit tests for the v2.1 getAdapterBySource dispatcher.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getAdapterBySource } from "../dist/lib/cms-adapter.js";

test("getAdapterBySource: rejects unknown adapter type", async () => {
  await assert.rejects(
    () => getAdapterBySource("unknown"),
    /Unknown CMS source/,
  );
});

test("getAdapterBySource: parses 'wordpress:blog' into type+name", async () => {
  // Adapter factory will throw because no config file exists, but we can assert
  // that it tries to load the WP config (and not the Directus or n8n one) via
  // the error message.
  await assert.rejects(
    () => getAdapterBySource("wordpress:blog"),
    /WordPress config missing/,
  );
});

test("getAdapterBySource: parses 'n8n:prod' into type+name", async () => {
  await assert.rejects(
    () => getAdapterBySource("n8n:prod"),
    /n8n config missing/,
  );
});

test("getAdapterBySource: bare 'wordpress' tries WP adapter", async () => {
  await assert.rejects(
    () => getAdapterBySource("wordpress"),
    /WordPress config missing/,
  );
});

test("getAdapterBySource: bare 'n8n' tries n8n adapter", async () => {
  await assert.rejects(
    () => getAdapterBySource("n8n"),
    /n8n config missing/,
  );
});

test("getAdapterBySource: bare 'directus' tries Directus adapter", async () => {
  // If the user happens to have a real directus.json, this returns success.
  // Otherwise it throws the expected error. Either way the type is "directus".
  try {
    const adapter = await getAdapterBySource("directus");
    assert.equal(adapter.name, "directus");
  } catch (err) {
    assert.match((err).message, /Directus config missing/);
  }
});
