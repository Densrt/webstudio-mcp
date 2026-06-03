// Render a per-instance text report for webstudio_inspect_instance: text
// children, props (filterable), style sources, and child instance tree.

import type { WebstudioBuild } from "../../webstudio-client.js";

export type FormatOpts = {
  propNameContains?: string;
  maxValueLength: number;
  childDepth: number;
};

function truncate(s: string, n: number): string {
  if (n <= 0 || s.length <= n) return s;
  return s.slice(0, n) + "…";
}

function describeValue(v: unknown, max: number): string {
  if (typeof v === "string") return `"${truncate(v, max)}"`;
  return truncate(JSON.stringify(v), max);
}

type Indexes = {
  instances: Map<string, WebstudioBuild["instances"][number]>;
  propsByInstance: Map<string, WebstudioBuild["props"]>;
  stylesByInstance: Map<string, WebstudioBuild["styleSourceSelections"][number]>;
  styleSourceById: Map<string, WebstudioBuild["styleSources"][number]>;
};

export function buildIndexes(build: WebstudioBuild): Indexes {
  const instances = new Map(build.instances.map((i) => [i.id, i]));
  const propsByInstance = new Map<string, WebstudioBuild["props"]>();
  for (const p of build.props) {
    const arr = propsByInstance.get(p.instanceId) ?? [];
    arr.push(p);
    propsByInstance.set(p.instanceId, arr);
  }
  const stylesByInstance = new Map<string, WebstudioBuild["styleSourceSelections"][number]>();
  for (const s of build.styleSourceSelections) stylesByInstance.set(s.instanceId, s);
  const styleSourceById = new Map(build.styleSources.map((s) => [s.id, s]));
  return { instances, propsByInstance, stylesByInstance, styleSourceById };
}

export function renderInstance(
  id: string,
  idx: Indexes,
  opts: FormatOpts,
  lines: string[],
): void {
  const inst = idx.instances.get(id);
  if (!inst) {
    lines.push(`\n=== ${id} ===\n! instance not found`);
    return;
  }

  const compShort = inst.component.split(":").pop() || inst.component;
  const tagPart = inst.tag ? ` <${inst.tag}>` : "";
  const labelPart = inst.label ? ` "${inst.label}"` : "";
  lines.push(`\n=== [${id}] ${compShort}${tagPart}${labelPart} ===`);

  const propFilter = opts.propNameContains?.toLowerCase();

  // Text/expression children — same childIndex convention as update_instance_text
  const children = inst.children ?? [];
  let textExprIndex = -1;
  const textLines: string[] = [];
  const idChildren: string[] = [];
  for (const c of children) {
    if (c.type === "text" || c.type === "expression") {
      textExprIndex++;
      textLines.push(`  [${textExprIndex}] (${c.type}) ${describeValue(c.value, opts.maxValueLength)}`);
    } else if (c.type === "id") {
      idChildren.push(c.value);
    }
  }
  if (textLines.length > 0) {
    lines.push(`Text/expression children:`);
    lines.push(...textLines);
  }

  const props = idx.propsByInstance.get(id) ?? [];
  const filteredProps = propFilter ? props.filter((p) => p.name.toLowerCase().includes(propFilter)) : props;
  if (filteredProps.length > 0) {
    lines.push(`Props (${filteredProps.length}${propFilter ? `/${props.length}` : ""}):`);
    for (const p of filteredProps) {
      lines.push(`  ${p.name} = ${describeValue(p.value, opts.maxValueLength)} [${p.type}]`);
    }
  } else if (propFilter) {
    lines.push(`Props (0/${props.length} matching "${propFilter}")`);
  }

  const sel = idx.stylesByInstance.get(id);
  if (sel && sel.values.length > 0) {
    lines.push(`Style sources (${sel.values.length}):`);
    for (const sid of sel.values) {
      const ss = idx.styleSourceById.get(sid);
      if (!ss) lines.push(`  - ${sid} (orphan)`);
      else if (ss.type === "token") lines.push(`  - token "${ss.name ?? "?"}" [${sid}]`);
      else lines.push(`  - local [${sid}]`);
    }
  }

  if (idChildren.length > 0 && opts.childDepth > 0) {
    lines.push(`Child instances (${idChildren.length}):`);
    const visit = (cid: string, depth: number) => {
      if (depth > opts.childDepth) return;
      const ci = idx.instances.get(cid);
      if (!ci) {
        lines.push(`${"  ".repeat(depth)}- [${cid}] (missing)`);
        return;
      }
      const cShort = ci.component.split(":").pop() || ci.component;
      const cTag = ci.tag ? ` <${ci.tag}>` : "";
      const cLabel = ci.label ? ` "${ci.label}"` : "";
      lines.push(`${"  ".repeat(depth)}- [${cid}] ${cShort}${cTag}${cLabel}`);
      for (const c of ci.children ?? []) {
        if (c.type === "id") visit(c.value, depth + 1);
      }
    };
    for (const cid of idChildren) visit(cid, 1);
  }
}
