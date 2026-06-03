// Reproducer for the clone_subtree expression remap bug:
// Bracket-notation prop values (e.g. $ws$dataSource$x["field"]) were not
// always remapped to the new dataSource ID after clone, while dot-notation
// values on the same instance were.
//
// This test builds a minimal in-memory WebstudioBuild with:
//   - a Collection-like parent + one child instance
//   - a dataSource scoped on the child
//   - 2 props on the child: one using dot-notation, one using bracket-notation
// then clones the parent's children into a new target and asserts BOTH props
// were rewritten to reference the new (cloned) dataSource ID.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCloneSubtreeChanges } from "../dist/clone-helpers.js";

// Use an ID that contains a `-` to exercise the dash-encoding path that
// the production bug hit (`4Yk9OsJp_l9I7W-TJp0op`). Webstudio stores expressions
// with `-` encoded as `__DASH__`.
const OLD_DS = "dsource-1";
const ENCODED_OLD_DS = OLD_DS.replace(/-/g, "__DASH__");

const build = {
  instances: [
    { id: "root", component: "Body", children: [{ type: "id", value: "src" }, { type: "id", value: "dst" }] },
    { id: "src", component: "Box", children: [{ type: "id", value: "instA" }] },
    { id: "dst", component: "Box", children: [] },
    {
      id: "instA",
      component: "Image",
      children: [
        // expression child of type "expression" — also exercised by the remap
        { type: "expression", value: `$ws$dataSource$${ENCODED_OLD_DS}.title` },
      ],
    },
  ],
  props: [
    // dot-notation (this one was working in production)
    {
      id: "propDot",
      instanceId: "instA",
      name: "href",
      type: "expression",
      value: `$ws$dataSource$${ENCODED_OLD_DS}.url`,
    },
    // bracket-notation (this one was NOT being remapped — the bug)
    {
      id: "propBracket",
      instanceId: "instA",
      name: "src",
      type: "expression",
      value: `$ws$dataSource$${ENCODED_OLD_DS}["image_principale"]`,
    },
  ],
  styleSourceSelections: [],
  styleSources: [],
  styles: [],
  breakpoints: [],
  dataSources: [
    { id: OLD_DS, scopeInstanceId: "instA", type: "variable", name: "item", value: { type: "json", value: {} } },
  ],
  resources: [],
};

test("clone_subtree remaps bracket-notation prop values (regression for BUGS.md)", () => {
  const { changes } = buildCloneSubtreeChanges(build, {
    sourceInstanceId: "src",
    targetInstanceId: "dst",
    mode: "append",
  });

  const dsChange = changes.find((c) => c.namespace === "dataSources");
  assert.ok(dsChange, "expected a dataSources change");
  const newDsId = dsChange.patches[0].path[0];
  assert.notEqual(newDsId, OLD_DS, "dataSource should have been remapped to a new id");
  const newEncoded = newDsId.replace(/-/g, "__DASH__");

  const propsChange = changes.find((c) => c.namespace === "props");
  assert.ok(propsChange, "expected a props change");
  const clonedProps = propsChange.patches.map((p) => p.value);
  const cloneDot = clonedProps.find((p) => p.name === "href");
  const cloneBracket = clonedProps.find((p) => p.name === "src");
  assert.ok(cloneDot, "dot-notation prop should be cloned");
  assert.ok(cloneBracket, "bracket-notation prop should be cloned");

  // Both should reference the NEW datasource id, not the old one.
  assert.ok(
    !cloneDot.value.includes(ENCODED_OLD_DS),
    `dot prop still references old ds: ${cloneDot.value}`,
  );
  assert.ok(
    cloneDot.value.includes(newEncoded),
    `dot prop should reference new ds; got: ${cloneDot.value}`,
  );

  assert.ok(
    !cloneBracket.value.includes(ENCODED_OLD_DS),
    `bracket prop still references old ds: ${cloneBracket.value}`,
  );
  assert.ok(
    cloneBracket.value.includes(newEncoded),
    `bracket prop should reference new ds; got: ${cloneBracket.value}`,
  );
});

// Second scenario: prefix-overlap between dataSource IDs. When two cloned
// dataSources have IDs where A is a substring of B, the naive split/join
// remap corrupts B's references (A gets substituted INSIDE B's reference
// because string-search has no notion of identifier boundary).
// This is the most likely root cause behind the production bracket bug:
// a Collection has multiple scoped dataSources, one's id is a prefix of
// another's (or shares a substring), and the failing prop happened to use
// bracket-notation (a coincidence — dot-notation would fail too in this case).
test("clone_subtree handles dataSource IDs with prefix overlap (no substring corruption)", () => {
  // Two dataSources where A's id is a prefix of B's id.
  const A_ID = "dsA";
  const B_ID = "dsAlongerB"; // contains A_ID as prefix
  const localBuild = {
    instances: [
      { id: "root", component: "Body", children: [{ type: "id", value: "src3" }, { type: "id", value: "dst3" }] },
      { id: "src3", component: "Box", children: [{ type: "id", value: "instC" }] },
      { id: "dst3", component: "Box", children: [] },
      { id: "instC", component: "Image", children: [] },
    ],
    props: [
      // bracket-notation against the LONGER id — naive split() of A_ID corrupts this
      { id: "pBracket", instanceId: "instC", name: "src", type: "expression", value: `$ws$dataSource$${B_ID}["image_principale"]` },
      // dot-notation against A — should remap cleanly
      { id: "pDot", instanceId: "instC", name: "href", type: "expression", value: `$ws$dataSource$${A_ID}.url` },
    ],
    styleSourceSelections: [], styleSources: [], styles: [], breakpoints: [],
    dataSources: [
      { id: A_ID, scopeInstanceId: "instC", type: "variable", name: "a", value: { type: "json", value: {} } },
      { id: B_ID, scopeInstanceId: "instC", type: "variable", name: "b", value: { type: "json", value: {} } },
    ],
    resources: [],
  };

  const { changes } = buildCloneSubtreeChanges(localBuild, {
    sourceInstanceId: "src3",
    targetInstanceId: "dst3",
    mode: "append",
  });

  const dsChange = changes.find((c) => c.namespace === "dataSources");
  const newAId = dsChange.patches.find((p) => p.value.name === "a").path[0];
  const newBId = dsChange.patches.find((p) => p.value.name === "b").path[0];
  const propsChange = changes.find((c) => c.namespace === "props");
  const cloneBracket = propsChange.patches.find((p) => p.value.name === "src").value;
  const cloneDot = propsChange.patches.find((p) => p.value.name === "href").value;

  // Bracket prop should reference the NEW B id, intact (no substring corruption).
  assert.equal(
    cloneBracket.value,
    `$ws$dataSource$${newBId.replace(/-/g, "__DASH__")}["image_principale"]`,
    `bracket prop corruption: ${cloneBracket.value}`,
  );
  // Dot prop should reference the NEW A id.
  assert.equal(
    cloneDot.value,
    `$ws$dataSource$${newAId.replace(/-/g, "__DASH__")}.url`,
    `dot prop corruption: ${cloneDot.value}`,
  );
});
