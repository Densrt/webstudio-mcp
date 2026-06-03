// Build the props-namespace patches for webstudio_instance_prop.
// Handles: create-if-missing, preserve-expressions safety, idempotent skip.

import { customAlphabet } from "nanoid";
import type {
  WebstudioBuild,
  BuildPatchTransaction,
  BuildPatchOperation,
} from "../../webstudio-client.js";
import { encodeExpressionRefs } from "../../utils/expression-encoding.js";

const txId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

const PROP_ID_NANO = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  21,
);

export type PropUpdate = {
  instanceId: string;
  propName: string;
  type?:
    | "string" | "number" | "boolean" | "json" | "asset" | "page" | "string[]"
    | "parameter" | "resource" | "expression" | "action" | "animationAction";
  value?: unknown;
  createIfMissing: boolean;
  preserveExpressions: boolean;
  force: boolean;
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function describe(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value === "string") return `"${truncate(value, 60)}"`;
  return truncate(JSON.stringify(value), 80);
}

export function buildUpdatePropsTransaction(
  build: WebstudioBuild,
  updates: PropUpdate[],
): { transaction: BuildPatchTransaction; details: string[]; patchCount: number } {
  const patches: BuildPatchOperation[] = [];
  const details: string[] = [];

  for (const u of updates) {
    const inst = build.instances.find((i) => i.id === u.instanceId);
    if (!inst) {
      details.push(`! ${u.instanceId}: instance not found`);
      continue;
    }

    const existing = build.props.find(
      (p) => p.instanceId === u.instanceId && p.name === u.propName,
    );

    if (!existing) {
      if (!u.createIfMissing) {
        details.push(
          `! ${u.instanceId} (${inst.label ?? inst.component}): prop "${u.propName}" missing (use createIfMissing=true)`,
        );
        continue;
      }
      const newType = u.type ?? "string";
      // Auto-encode `-` → `__DASH__` in dataSourceId refs when value is a raw expression.
      // Idempotent — see src/utils/expression-encoding.ts.
      const newValue =
        newType === "expression" && typeof u.value === "string"
          ? encodeExpressionRefs(u.value)
          : u.value;
      const propId = PROP_ID_NANO();
      const newProp = { id: propId, instanceId: u.instanceId, name: u.propName, type: newType, value: newValue };
      patches.push({ op: "add", path: [propId], value: newProp });
      details.push(
        `+ ${u.instanceId} (${inst.label ?? inst.component}): add ${u.propName} (${newType}) = ${describe(newValue)}`,
      );
      continue;
    }

    const newType = u.type ?? existing.type;
    const oldVal = existing.value;
    // Auto-encode dataSourceId refs when this prop is becoming/remaining an expression.
    const newValue =
      newType === "expression" && typeof u.value === "string"
        ? encodeExpressionRefs(u.value)
        : u.value;
    const sameType = newType === existing.type;
    const sameValue = JSON.stringify(oldVal) === JSON.stringify(newValue);

    // Safety: refuse to overwrite an expression-bound prop with a different type unless forced.
    if (existing.type === "expression" && newType !== "expression" && u.preserveExpressions && !u.force) {
      details.push(
        `! ${u.instanceId} (${inst.label ?? inst.component}): "${u.propName}" is bound to an expression (${describe(oldVal)}) — refusing to overwrite with type=${newType}. Pass force=true to override, or preserveExpressions=false.`,
      );
      continue;
    }

    if (sameType && sameValue) {
      details.push(
        `= ${u.instanceId} (${inst.label ?? inst.component}): ${u.propName} already ${describe(newValue)}, skip`,
      );
      continue;
    }

    const newProp = { ...existing, type: newType, value: newValue };
    patches.push({ op: "replace", path: [existing.id], value: newProp });
    details.push(
      `> ${u.instanceId} (${inst.label ?? inst.component}): ${u.propName} ${describe(oldVal)} → ${describe(newValue)}${sameType ? "" : ` (type ${existing.type} → ${newType})`}`,
    );
  }

  return {
    transaction: {
      id: `mcp-update-prop-${txId()}`,
      payload: patches.length > 0 ? [{ namespace: "props", patches }] : [],
    },
    details,
    patchCount: patches.length,
  };
}
