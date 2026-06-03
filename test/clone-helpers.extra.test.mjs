// Additional clone-helpers coverage (the bracket-notation/prefix-overlap regression
// is already covered by clone-subtree-bracket.test.mjs).
//
// These cases pin down:
//   - empty source → throws cleanly
//   - 3-level tree (parent → child → grandchild) → all IDs reassigned
//   - props of type "action" get their dataSource refs remapped in `code`
//   - resource scoped on a cloned instance: url + headers + searchParams all remap

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCloneSubtreeChanges } from "../dist/clone-helpers.js";

// Webstudio encodes dashes inside dataSource IDs as "__DASH__" within
// `$ws$dataSource$<id>` expressions (the raw "-" would otherwise terminate
// the identifier capture). Replicate the helper here to compare against the
// expected wire form, since nanoid frequently includes "-".
const dashEncode = (s) => s.replace(/-/g, "__DASH__");

function emptyBuild(extra = {}) {
  return {
    instances: [],
    props: [],
    styleSourceSelections: [],
    styleSources: [],
    styles: [],
    breakpoints: [],
    dataSources: [],
    resources: [],
    ...extra,
  };
}

test("buildCloneSubtreeChanges throws when source has no children to clone", () => {
  const build = emptyBuild({
    instances: [
      { id: "root", component: "Body", children: [{ type: "id", value: "src" }, { type: "id", value: "dst" }] },
      { id: "src", component: "Box", children: [] },
      { id: "dst", component: "Box", children: [] },
    ],
  });
  assert.throws(
    () => buildCloneSubtreeChanges(build, { sourceInstanceId: "src", targetInstanceId: "dst", mode: "append" }),
    /no children to clone/i,
  );
});

test("buildCloneSubtreeChanges remaps a 3-level tree (parent → child → grandchild) — every id reassigned", () => {
  const build = emptyBuild({
    instances: [
      { id: "root", component: "Body", children: [{ type: "id", value: "src" }, { type: "id", value: "dst" }] },
      { id: "src", component: "Box", children: [{ type: "id", value: "p" }] },
      { id: "dst", component: "Box", children: [] },
      { id: "p", component: "Box", children: [{ type: "id", value: "c" }] },
      { id: "c", component: "Box", children: [{ type: "id", value: "g" }] },
      { id: "g", component: "Heading", children: [{ type: "text", value: "deep" }] },
    ],
  });

  const { changes, summary } = buildCloneSubtreeChanges(build, {
    sourceInstanceId: "src",
    targetInstanceId: "dst",
    mode: "append",
  });
  assert.equal(summary.instancesCloned, 3);

  const instChange = changes.find((c) => c.namespace === "instances");
  // 3 add patches for clones + 1 replace patch for dst.children
  const adds = instChange.patches.filter((p) => p.op === "add");
  assert.equal(adds.length, 3);
  const newIds = adds.map((p) => p.path[0]);
  // No old id should reappear as a new id.
  for (const oldId of ["p", "c", "g"]) {
    assert.ok(!newIds.includes(oldId), `old id "${oldId}" must not be reused`);
  }
  // Each new value has its children rewritten to the new id (no dangling "p"/"c"/"g").
  for (const add of adds) {
    for (const child of add.value.children) {
      if (child.type === "id") {
        assert.ok(!["p", "c", "g"].includes(child.value), `child id "${child.value}" was not remapped in ${add.value.id}`);
      }
    }
  }
  // dst.children replace patch points at the cloned top-level (i.e. the remap of "p").
  const dstReplace = instChange.patches.find(
    (p) => p.op === "replace" && p.path[0] === "dst" && p.path[1] === "children",
  );
  assert.ok(dstReplace);
  const newChildIds = dstReplace.value.filter((c) => c.type === "id").map((c) => c.value);
  assert.equal(newChildIds.length, 1);
  assert.ok(!["src", "p", "c", "g"].includes(newChildIds[0]));
});

test("buildCloneSubtreeChanges remaps action prop code referencing a cloned dataSource", () => {
  // OLD_DS must be long/distinctive enough that a random nanoid-21 cannot contain it
  // as a substring (else assert.ok(!code.includes(OLD_DS)) flakes ~20% of runs).
  const OLD_DS = "dsActionUniqueMarker_xyzABC123";
  const build = emptyBuild({
    instances: [
      { id: "root", component: "Body", children: [{ type: "id", value: "src" }, { type: "id", value: "dst" }] },
      { id: "src", component: "Box", children: [{ type: "id", value: "instX" }] },
      { id: "dst", component: "Box", children: [] },
      { id: "instX", component: "Button", children: [] },
    ],
    props: [
      // expression prop — remapped via the canonical path
      { id: "pE", instanceId: "instX", name: "show", type: "expression", value: `$ws$dataSource$${OLD_DS}` },
      // action prop — value is an array of {type:"execute", args, code}
      {
        id: "pA",
        instanceId: "instX",
        name: "onClick",
        type: "action",
        value: [
          { type: "execute", args: [], code: `$ws$dataSource$${OLD_DS} = true` },
          { type: "execute", args: [], code: `console.log($ws$dataSource$${OLD_DS})` },
        ],
      },
    ],
    dataSources: [{ id: OLD_DS, scopeInstanceId: "instX", type: "variable", name: "open", value: { type: "json", value: false } }],
  });

  const { changes } = buildCloneSubtreeChanges(build, { sourceInstanceId: "src", targetInstanceId: "dst", mode: "append" });
  const dsChange = changes.find((c) => c.namespace === "dataSources");
  const newDs = dsChange.patches[0].path[0];
  assert.notEqual(newDs, OLD_DS);

  const propsChange = changes.find((c) => c.namespace === "props");
  const cloneAction = propsChange.patches.find((p) => p.value.name === "onClick").value;
  const cloneExpr = propsChange.patches.find((p) => p.value.name === "show").value;

  // Expression prop value rewritten (compare against the dash-encoded form).
  const encNewDs = dashEncode(newDs);
  assert.equal(cloneExpr.value, `$ws$dataSource$${encNewDs}`);
  // Action prop: every entry's `code` rewritten, old id no longer present.
  for (const entry of cloneAction.value) {
    assert.ok(!entry.code.includes(OLD_DS), `action code still references old ds: ${entry.code}`);
    assert.ok(entry.code.includes(encNewDs), `action code should reference new ds: ${entry.code}`);
  }
});

test("buildCloneSubtreeChanges remaps resource url + headers + searchParams + scopeInstanceId", () => {
  // Long/distinctive IDs to avoid substring-collision flakes against nanoid-21 new IDs.
  const OLD_DS = "dsResourceUniqueMarker_xyzABC123";
  const OLD_RES = "resResourceUniqueMarker_xyzABC123";
  const build = emptyBuild({
    instances: [
      { id: "root", component: "Body", children: [{ type: "id", value: "src" }, { type: "id", value: "dst" }] },
      { id: "src", component: "Box", children: [{ type: "id", value: "instY" }] },
      { id: "dst", component: "Box", children: [] },
      { id: "instY", component: "Box", children: [] },
    ],
    props: [],
    dataSources: [{ id: OLD_DS, scopeInstanceId: "instY", type: "variable", name: "v", value: { type: "json", value: 1 } }],
    resources: [
      {
        id: OLD_RES,
        scopeInstanceId: "instY",
        name: "api",
        method: "get",
        url: `\`https://api.example.com/\${$ws$dataSource$${OLD_DS}}\``,
        headers: [{ name: "X-Tok", value: `\`Bearer \${$ws$dataSource$${OLD_DS}}\`` }],
        searchParams: [{ name: "q", value: `\`\${$ws$dataSource$${OLD_DS}}\`` }],
      },
    ],
  });

  const { changes } = buildCloneSubtreeChanges(build, { sourceInstanceId: "src", targetInstanceId: "dst", mode: "append" });
  const dsChange = changes.find((c) => c.namespace === "dataSources");
  const resChange = changes.find((c) => c.namespace === "resources");
  assert.ok(dsChange);
  assert.ok(resChange);

  const newDsId = dsChange.patches[0].path[0];
  const newRes = resChange.patches[0].value;

  // resource id reassigned
  assert.notEqual(newRes.id, OLD_RES);
  // scopeInstanceId remapped to the new instance id (not "instY")
  assert.notEqual(newRes.scopeInstanceId, "instY");
  // url + headers + searchParams all rewrite the dataSource ref (dash-encoded).
  const encNewDsId = dashEncode(newDsId);
  assert.ok(!newRes.url.includes(OLD_DS), `url still references old ds: ${newRes.url}`);
  assert.ok(newRes.url.includes(encNewDsId), `url should reference new ds: ${newRes.url}`);
  assert.ok(!newRes.headers[0].value.includes(OLD_DS));
  assert.ok(newRes.headers[0].value.includes(encNewDsId));
  assert.ok(!newRes.searchParams[0].value.includes(OLD_DS));
  assert.ok(newRes.searchParams[0].value.includes(encNewDsId));
});

test("buildCloneSubtreeChanges respects skipChildLabels (top-level children with matching label are skipped)", () => {
  const build = emptyBuild({
    instances: [
      { id: "root", component: "Body", children: [{ type: "id", value: "src" }, { type: "id", value: "dst" }] },
      { id: "src", component: "Box", children: [{ type: "id", value: "keep" }, { type: "id", value: "drop" }] },
      { id: "dst", component: "Box", children: [] },
      { id: "keep", component: "Box", label: "Body Content", children: [] },
      { id: "drop", component: "Box", label: "Slot Header", children: [] },
    ],
  });
  const { summary, changes } = buildCloneSubtreeChanges(build, {
    sourceInstanceId: "src",
    targetInstanceId: "dst",
    mode: "append",
    skipChildLabels: ["Slot Header"],
  });
  // Only "keep" should have been cloned (drop was skipped).
  assert.equal(summary.instancesCloned, 1);
  const instChange = changes.find((c) => c.namespace === "instances");
  const adds = instChange.patches.filter((p) => p.op === "add");
  assert.equal(adds.length, 1);
});
