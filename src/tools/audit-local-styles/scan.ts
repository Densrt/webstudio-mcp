// Scan project-wide local style declarations and group them by (property, value).

import type { WebstudioBuild } from "../../webstudio-client.js";

export type ScanArgs = {
  property?: string;
  family: "spacing" | "color" | "typography" | "radius" | "layout" | "all";
  pageId?: string;
  pagePath?: string;
  instanceLabel?: string;
  component?: string;
  tag?: string;
  breakpoint?: string;
  minCount: number;
  topN: number;
  /** Filter out keyword-only values (display:flex, position:relative, alignItems:center, …) that
   *  can't be tokenized and only pollute the output. Also filters semantic zero values (0px on
   *  reset borders/paddings) and pure layout keywords. Default: true (cleaner reports). */
  excludeKeywords?: boolean;
};

export type Group = {
  property: string;
  valueStr: string;
  rawValue: unknown;
  hardcoded: boolean;
  count: number;
  samples: Array<{ instanceId: string; instanceLabel: string; breakpoint: string }>;
};

export type ScanResult = {
  sorted: Group[];
  totalGroups: number;
  recurringGroups: number;
  hardcodedRecurring: number;
  totalScanned: number;
};

export const FAMILY_PROPS: Record<string, string[]> = {
  spacing: [
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "marginTop", "marginRight", "marginBottom", "marginLeft",
    "rowGap", "columnGap", "gap",
  ],
  color: ["color", "backgroundColor", "borderColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outlineColor", "fill", "stroke"],
  typography: ["fontSize", "fontWeight", "fontFamily", "lineHeight", "letterSpacing", "textTransform", "textDecoration"],
  radius: ["borderRadius", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"],
  layout: ["display", "flexDirection", "justifyContent", "alignItems", "flexWrap", "flexGrow", "flexShrink", "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight"],
};

/** Properties whose value is intrinsically a layout/structure keyword — never tokenizable. */
const NOISE_LAYOUT_PROPS = new Set([
  "display", "position", "flexDirection", "justifyContent", "alignItems", "alignSelf",
  "alignContent", "justifyItems", "justifySelf", "flexWrap", "flexGrow", "flexShrink",
  "flexBasis", "objectFit", "objectPosition", "overflow", "overflowX", "overflowY",
  "visibility", "boxSizing", "pointerEvents", "userSelect", "cursor", "textAlign",
  "verticalAlign", "whiteSpace", "wordBreak", "wordWrap", "textOverflow", "writingMode",
  "direction", "isolation", "resize", "scrollBehavior", "appearance", "listStyleType",
  "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle",
  "background", "backgroundRepeat", "backgroundSize", "backgroundPosition", "backgroundClip",
]);

/** True if `value` is a pure-layout keyword OR a semantic-zero on a "reset" property — i.e.
 *  noise that pollutes the audit. */
function isNoiseValue(value: unknown, property: string): boolean {
  const o = value as { type?: string; value?: unknown; unit?: string } | null;
  if (!o || typeof o !== "object") return false;
  // Layout keywords (display:flex, position:relative, etc.)
  if (o.type === "keyword" && NOISE_LAYOUT_PROPS.has(property)) return true;
  // Semantic zeros: 0px on resets, common helper output (margin:0, padding:0, border:0)
  if (o.type === "unit" && o.value === 0) return true;
  // Empty layers/tuples
  if ((o.type === "layers" || o.type === "tuple") && Array.isArray(o.value) && o.value.length === 0) {
    return true;
  }
  return false;
}

export function valueToString(v: unknown): string {
  const o = v as { type?: string; value?: unknown; unit?: string; alpha?: number; r?: number; g?: number; b?: number; fallback?: unknown };
  if (!o || typeof o !== "object") return JSON.stringify(v);
  switch (o.type) {
    case "unit": return `${String(o.value)}${o.unit ?? ""}`;
    case "var": return `var(--${String(o.value)})`;
    case "keyword": return String(o.value);
    case "rgb": return `rgb(${o.r},${o.g},${o.b}${o.alpha != null && o.alpha !== 1 ? `,${o.alpha}` : ""})`;
    case "fontFamily": return Array.isArray(o.value) ? o.value.join(", ") : JSON.stringify(o.value);
    default: return JSON.stringify(v);
  }
}

export function isHardcoded(v: unknown): boolean {
  const o = v as { type?: string };
  if (!o || typeof o !== "object") return false;
  return o.type !== "var";
}

function collectPageInstanceIds(build: WebstudioBuild, args: ScanArgs): Set<string> | null {
  if (!args.pageId && !args.pagePath) return null;
  const page = build.pages.pages.find(
    (p) => (args.pageId && p.id === args.pageId) || (args.pagePath && p.path === args.pagePath),
  );
  if (!page) throw new Error(`Page not found: ${args.pageId ?? args.pagePath}`);
  const out = new Set<string>();
  const stack = [page.rootInstanceId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    const inst = build.instances.find((i) => i.id === id);
    for (const c of inst?.children ?? []) if (c.type === "id") stack.push(c.value);
  }
  return out;
}

export function scanLocalStyles(build: WebstudioBuild, args: ScanArgs): ScanResult {
  const pageInstanceIds = collectPageInstanceIds(build, args);

  let allowedBpId: string | undefined;
  if (args.breakpoint) {
    const bp = build.breakpoints.find((b) => b.label === args.breakpoint || b.id === args.breakpoint);
    if (!bp) throw new Error(`Breakpoint not found: ${args.breakpoint}`);
    allowedBpId = bp.id;
  }

  const propertyFilter = args.property
    ? new Set([args.property])
    : args.family !== "all"
      ? new Set(FAMILY_PROPS[args.family])
      : null;

  const localSourceIds = new Set<string>();
  for (const ss of build.styleSources) if (ss.type === "local") localSourceIds.add(ss.id);
  const sourceToInstances = new Map<string, string[]>();
  for (const sel of build.styleSourceSelections) {
    for (const v of sel.values ?? []) {
      if (!localSourceIds.has(v)) continue;
      if (!sourceToInstances.has(v)) sourceToInstances.set(v, []);
      sourceToInstances.get(v)!.push(sel.instanceId);
    }
  }

  const instMatch = (instanceId: string): boolean => {
    if (pageInstanceIds && !pageInstanceIds.has(instanceId)) return false;
    if (!args.instanceLabel && !args.component && !args.tag) return true;
    const inst = build.instances.find((i) => i.id === instanceId);
    if (!inst) return false;
    if (args.instanceLabel && inst.label !== args.instanceLabel) return false;
    if (args.component && inst.component !== args.component) return false;
    if (args.tag && inst.tag !== args.tag) return false;
    return true;
  };

  const bpLabels = new Map(build.breakpoints.map((b) => [b.id, b.label]));
  const groups = new Map<string, Group>();
  let scanned = 0;

  const excludeKw = args.excludeKeywords !== false; // default true
  for (const d of build.styles) {
    if (!localSourceIds.has(d.styleSourceId)) continue;
    if (propertyFilter && !propertyFilter.has(d.property)) continue;
    if (allowedBpId && d.breakpointId !== allowedBpId) continue;
    const instanceIds = sourceToInstances.get(d.styleSourceId) ?? [];
    if (!instanceIds.some(instMatch)) continue;
    if (excludeKw && isNoiseValue(d.value, d.property)) continue;
    scanned++;
    const valueStr = valueToString(d.value);
    const key = `${d.property}|${valueStr}|${d.state ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        property: d.property,
        valueStr: valueStr + (d.state ?? ""),
        rawValue: d.value,
        hardcoded: isHardcoded(d.value),
        count: 0,
        samples: [],
      };
      groups.set(key, g);
    }
    g.count += 1;
    if (g.samples.length < 5) {
      const firstInst = build.instances.find((i) => instanceIds.includes(i.id) && instMatch(i.id));
      g.samples.push({
        instanceId: firstInst?.id ?? instanceIds[0],
        instanceLabel: firstInst?.label ?? "(unknown)",
        breakpoint: bpLabels.get(d.breakpointId) ?? d.breakpointId,
      });
    }
  }

  const sorted = [...groups.values()]
    .filter((g) => g.count >= args.minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, args.topN);

  return {
    sorted,
    totalGroups: groups.size,
    recurringGroups: sorted.length,
    hardcodedRecurring: sorted.filter((g) => g.hardcoded).reduce((s, g) => s + g.count, 0),
    totalScanned: scanned,
  };
}
