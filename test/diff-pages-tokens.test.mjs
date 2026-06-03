// Unit tests for webstudio_diff_pages_tokens.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../dist/tools/diff-pages-tokens.js";

function makeBuild({ tokens, instancesPerPage, selectionsByInstance }) {
  // tokens: [{id, name}]
  // instancesPerPage: { [pageId]: [{id, children?: [{type:"id", value:string}]}] }
  // selectionsByInstance: { [instanceId]: [tokenId, ...] }
  const pages = Object.keys(instancesPerPage).map((pid) => ({
    id: pid,
    name: pid,
    path: `/${pid}`,
    rootInstanceId: instancesPerPage[pid][0].id,
  }));
  const instances = [];
  for (const pid of Object.keys(instancesPerPage)) {
    for (const i of instancesPerPage[pid]) {
      instances.push({ id: i.id, component: "Box", label: i.id, children: i.children ?? [] });
    }
  }
  const styleSourceSelections = Object.entries(selectionsByInstance).map(([instanceId, values]) => ({
    instanceId,
    values,
  }));
  return {
    id: "b", projectId: "p", version: 1, createdAt: "", updatedAt: "",
    pages: { homePageId: pages[0].id, rootFolderId: "r", pages, folders: [] },
    breakpoints: [{ id: "bp-base", label: "Base" }],
    instances,
    props: [], dataSources: [], resources: [], deployments: [], assets: [], marketplaceProduct: null,
    styles: [],
    styleSources: tokens.map((t) => ({ type: "token", id: t.id, name: t.name })),
    styleSourceSelections,
  };
}

test("flags DRIFT when a token is used on one page but missing on another", () => {
  const build = makeBuild({
    tokens: [{ id: "t1", name: "Drift" }, { id: "t2", name: "Uniform" }],
    instancesPerPage: {
      a: [{ id: "a-root" }],
      b: [{ id: "b-root" }],
    },
    selectionsByInstance: {
      "a-root": ["t1", "t2"],
      "b-root": ["t2"],
    },
  });
  const r = buildReport(build, { projectSlug: "p", pages: [], hideUniform: false, hideOrphans: false });
  const drift = r.rows.find((x) => x.name === "Drift");
  const uniform = r.rows.find((x) => x.name === "Uniform");
  assert.equal(drift.drift, true);
  assert.equal(uniform.uniform, true);
});

test("counts usage per page using subtree walk (not just root selection)", () => {
  // Page A: root → child (child uses token t1)
  const build = makeBuild({
    tokens: [{ id: "t1", name: "T1" }],
    instancesPerPage: {
      a: [
        { id: "a-root", children: [{ type: "id", value: "a-child" }] },
        { id: "a-child" },
      ],
    },
    selectionsByInstance: {
      "a-child": ["t1"],
    },
  });
  const r = buildReport(build, { projectSlug: "p", pages: [], hideUniform: false, hideOrphans: false });
  assert.equal(r.rows[0].counts[0], 1);
});

test("prefix filter excludes non-matching tokens", () => {
  const build = makeBuild({
    tokens: [
      { id: "t1", name: "MyBrand Color" },
      { id: "t2", name: "Other Token" },
    ],
    instancesPerPage: { a: [{ id: "a-root" }] },
    selectionsByInstance: { "a-root": ["t1", "t2"] },
  });
  const r = buildReport(build, { projectSlug: "p", pages: [], prefix: "MyBrand ", hideUniform: false, hideOrphans: false });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].name, "MyBrand Color");
});

test("resolving pages by path works", () => {
  const build = makeBuild({
    tokens: [{ id: "t1", name: "T1" }],
    instancesPerPage: { home: [{ id: "h" }], about: [{ id: "a" }] },
    selectionsByInstance: { h: ["t1"] },
  });
  const r = buildReport(build, { projectSlug: "p", pages: ["/home"], hideUniform: false, hideOrphans: false });
  assert.equal(r.targets.length, 1);
  assert.equal(r.targets[0].path, "/home");
});

test("returns PAGE_NOT_FOUND for unknown path", () => {
  const build = makeBuild({
    tokens: [{ id: "t1", name: "T1" }],
    instancesPerPage: { home: [{ id: "h" }] },
    selectionsByInstance: {},
  });
  const r = buildReport(build, { projectSlug: "p", pages: ["/nowhere"], hideUniform: false, hideOrphans: false });
  assert.equal(r.error, "PAGE_NOT_FOUND");
  assert.equal(r.missing, "/nowhere");
});

test("hideUniform filters out tokens used on every page", () => {
  const build = makeBuild({
    tokens: [{ id: "t1", name: "Everywhere" }, { id: "t2", name: "Drift" }],
    instancesPerPage: { a: [{ id: "a" }], b: [{ id: "b" }] },
    selectionsByInstance: { a: ["t1", "t2"], b: ["t1"] },
  });
  const r = buildReport(build, { projectSlug: "p", pages: [], hideUniform: true, hideOrphans: false });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].name, "Drift");
});

test("hideOrphans filters out unused tokens", () => {
  const build = makeBuild({
    tokens: [{ id: "t1", name: "Used" }, { id: "t2", name: "Orphan" }],
    instancesPerPage: { a: [{ id: "a" }] },
    selectionsByInstance: { a: ["t1"] },
  });
  const r1 = buildReport(build, { projectSlug: "p", pages: [], hideUniform: false, hideOrphans: false });
  const r2 = buildReport(build, { projectSlug: "p", pages: [], hideUniform: false, hideOrphans: true });
  assert.equal(r1.rows.length, 2);
  assert.equal(r2.rows.length, 1);
  assert.equal(r2.rows[0].name, "Used");
});

test("totals counts drift / uniform / orphans correctly", () => {
  const build = makeBuild({
    tokens: [
      { id: "t1", name: "Drift" },
      { id: "t2", name: "Uniform" },
      { id: "t3", name: "Orphan" },
    ],
    instancesPerPage: { a: [{ id: "a" }], b: [{ id: "b" }] },
    selectionsByInstance: { a: ["t1", "t2"], b: ["t2"] },
  });
  const r = buildReport(build, { projectSlug: "p", pages: [], hideUniform: false, hideOrphans: false });
  assert.equal(r.totals.drift, 1);
  assert.equal(r.totals.uniform, 1);
  assert.equal(r.totals.orphans, 1);
});
