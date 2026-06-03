// Detection rules for the overflow audit scanner.
// Each detector accepts the scan context and pushes Issues into the shared array.

import type { WebstudioBuild } from "../../webstudio-client.js";
import type { Issue, StyleEntry } from "./types.js";
import { hasMobileOverride, hasWrapStyle, instLabel, isInsecure } from "./helpers.js";

type Inst = WebstudioBuild["instances"][number];

type ScanCtx = {
  build: WebstudioBuild;
  stylesByInstance: Map<string, StyleEntry[]>;
  bpById: Map<string, { label?: string }>;
  targetBps: Array<{ slug: string; bp: { label?: string } | undefined; viewport: number }>;
  issues: Issue[];
};

export function scanStyleBasedIssues(ctx: ScanCtx, inst: Inst) {
  const arr = ctx.stylesByInstance.get(inst.id);
  if (!arr) return;

  for (const target of ctx.targetBps) {
    if (!target.bp) continue;
    const targetBpLabel = target.bp.label!;
    const viewport = target.viewport;

    const baseSeen = new Set<string>();
    for (const s of arr) {
      if (s.state !== "") continue;
      const bpLabel = ctx.bpById.get(s.bpId)?.label;
      if (bpLabel !== "Base" && bpLabel !== targetBpLabel) continue;

      const v = s.value as { type?: string; unit?: string; value?: unknown };
      const isPxNumber = v?.type === "unit" && v.unit === "px" && typeof v.value === "number";
      const isUnparsed = v?.type === "unparsed" && typeof v.value === "string";
      const propKey = `${s.property}:${bpLabel}`;
      if (baseSeen.has(propKey)) continue;
      baseSeen.add(propKey);

      // 1. Fixed width/min-width > viewport
      if ((s.property === "width" || s.property === "minWidth") && isPxNumber) {
        const val = v.value as number;
        if (val > viewport) {
          const overridden = bpLabel === "Base" && hasMobileOverride(ctx.stylesByInstance, ctx.bpById, inst.id, s.property, targetBpLabel);
          if (!overridden) {
            ctx.issues.push({
              severity: "🔴",
              instanceId: inst.id,
              label: instLabel(inst),
              property: s.property,
              value: `${val}px`,
              bp: bpLabel === "Base" ? `Base (no ${targetBpLabel} override)` : targetBpLabel,
              reason: `${s.property} ${val}px > ${viewport}px viewport`,
              suggestion: `Add ${s.property}: 100% or smaller px value @ ${targetBpLabel}, or use clamp()`,
            });
          }
        }
      }

      // 2. grid-template-columns with `1fr` not in minmax(0, …)
      if (s.property === "gridTemplateColumns" && isUnparsed) {
        const str = String(v.value);
        if (str.includes("fr") && !/minmax\(\s*0/.test(str)) {
          ctx.issues.push({
            severity: "🔴",
            instanceId: inst.id,
            label: instLabel(inst),
            property: s.property,
            value: str,
            bp: bpLabel,
            reason: `\`1fr\` does not allow children to shrink below their min-content. Long unbreakable content (emails, URLs) busts the grid → scroll-x.`,
            suggestion: `Replace \`1fr\` by \`minmax(0, 1fr)\``,
          });
        }
      }

      // 3. flex-wrap: nowrap
      if (s.property === "flexWrap" && (v as { value?: string }).value === "nowrap") {
        const childCount = (inst.children ?? []).filter((c) => c.type === "id").length;
        if (childCount > 1) {
          ctx.issues.push({
            severity: "🔴",
            instanceId: inst.id,
            label: instLabel(inst),
            property: s.property,
            value: "nowrap",
            bp: bpLabel,
            reason: `flex-wrap: nowrap with ${childCount} children may overflow horizontally on small viewports`,
            suggestion: `Consider \`flex-wrap: wrap\` for responsiveness`,
          });
        }
      }

      // 4. Negative margins
      if (/^margin/.test(s.property) && isPxNumber && (v.value as number) < 0) {
        ctx.issues.push({
          severity: "🔴",
          instanceId: inst.id,
          label: instLabel(inst),
          property: s.property,
          value: `${v.value}px`,
          bp: bpLabel,
          reason: `Negative margin can push content outside the viewport`,
          suggestion: `Use padding instead, or constrain with \`overflow: hidden\` on parent`,
        });
      }

      // 5. Padding/margin px > 32 on Base, no mobile override
      if (/^padding/.test(s.property) && isPxNumber && (v.value as number) > 32 && bpLabel === "Base") {
        if (!hasMobileOverride(ctx.stylesByInstance, ctx.bpById, inst.id, s.property, targetBpLabel)) {
          ctx.issues.push({
            severity: "🟡",
            instanceId: inst.id,
            label: instLabel(inst),
            property: s.property,
            value: `${v.value}px`,
            bp: `Base (no ${targetBpLabel} override)`,
            reason: `Hardcoded padding ${v.value}px on Base, no smaller value at ${targetBpLabel}`,
            suggestion: `Add a smaller ${s.property} @ ${targetBpLabel} or use a CSS var with clamp()`,
          });
        }
      }

      // 6. overflow-x explicit
      if (s.property === "overflowX") {
        const val = (v as { value?: string }).value;
        if (val === "visible" || val === "auto" || val === "scroll") {
          ctx.issues.push({
            severity: "🟡",
            instanceId: inst.id,
            label: instLabel(inst),
            property: s.property,
            value: val,
            bp: bpLabel,
            reason: `\`overflow-x: ${val}\` explicit — may indicate a hack or hide a real overflow source`,
            suggestion: `Investigate: prefer fixing the cause; \`overflow: hidden\` only as last resort`,
          });
        }
      }

      // 7. font-size px > 48 on Base no mobile override
      if (s.property === "fontSize" && isPxNumber && (v.value as number) > 48 && bpLabel === "Base") {
        if (!hasMobileOverride(ctx.stylesByInstance, ctx.bpById, inst.id, s.property, targetBpLabel)) {
          ctx.issues.push({
            severity: "🟡",
            instanceId: inst.id,
            label: instLabel(inst),
            property: s.property,
            value: `${v.value}px`,
            bp: `Base (no ${targetBpLabel} override)`,
            reason: `Large font-size on Base may overflow on ${targetBpLabel}`,
            suggestion: `Use clamp() or add smaller font-size @ ${targetBpLabel}`,
          });
        }
      }

      // 8. Position absolute/fixed with extreme right/left
      if ((s.property === "right" || s.property === "left") && isPxNumber) {
        const val = v.value as number;
        if (val < 0 || val > viewport) {
          ctx.issues.push({
            severity: "🟠",
            instanceId: inst.id,
            label: instLabel(inst),
            property: s.property,
            value: `${val}px`,
            bp: bpLabel,
            reason: `${s.property} ${val}px on positioned element — may push it outside the viewport`,
            suggestion: `Constrain via \`max-width\` on parent or use percent values`,
          });
        }
      }

      // 9. white-space: nowrap on element with long text content
      if (s.property === "whiteSpace" && (v as { value?: string }).value === "nowrap") {
        const text = (inst.children ?? [])
          .filter((c) => c.type === "text" || c.type === "expression")
          .map((c) => String((c as { value: unknown }).value))
          .join(" ");
        if (text.length > 20) {
          ctx.issues.push({
            severity: "🟠",
            instanceId: inst.id,
            label: instLabel(inst),
            property: s.property,
            value: "nowrap",
            bp: bpLabel,
            reason: `white-space: nowrap on element with long text (${text.length} chars)`,
            suggestion: `Remove nowrap or set max-width with text-overflow: ellipsis`,
          });
        }
      }
    }
  }
}

export function scanTextWrapIssues(ctx: ScanCtx, inst: Inst) {
  // 10. Long unbreakable text without overflow-wrap (regardless of breakpoint)
  const staticText = (inst.children ?? [])
    .filter((c) => c.type === "text")
    .map((c) => String((c as { value: unknown }).value))
    .join(" ");

  const expressionResolutions: string[] = [];
  const exprChildren = (inst.children ?? []).filter((c) => c.type === "expression");
  for (const c of exprChildren) {
    const exprStr = String((c as { value: unknown }).value);
    const dsRefs = exprStr.match(/\$ws\$dataSource\$[A-Za-z0-9_]+/g) ?? [];
    for (const ref of dsRefs) {
      const encoded = ref.replace("$ws$dataSource$", "");
      const decoded = encoded.replace(/__DASH__/g, "-");
      const ds = (ctx.build as unknown as { dataSources: Array<{ id: string; type: string; value?: { type: string; value: unknown }; name?: string }> }).dataSources.find((d) => d.id === decoded || d.id === encoded);
      if (ds && ds.type === "variable" && ds.value?.type === "string" && typeof ds.value.value === "string") {
        expressionResolutions.push(ds.value.value);
      }
    }
  }

  const allText = [staticText, ...expressionResolutions].filter(Boolean).join(" ");
  const hasExpressionBinding = exprChildren.length > 0 && (inst.tag === "a" || inst.tag === "p" || inst.tag === "span");

  if (allText && isInsecure(allText) && !hasWrapStyle(ctx.stylesByInstance, inst.id)) {
    if (/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/.test(allText) || /https?:\/\//.test(allText) || allText.split(/\s+/).some((w) => w.length >= 25)) {
      const sourceNote = expressionResolutions.length > 0 ? ` (resolved from binding: "${expressionResolutions[0].slice(0, 60)}…")` : "";
      ctx.issues.push({
        severity: "🟠",
        instanceId: inst.id,
        label: instLabel(inst),
        reason: `Long unbreakable text (${allText.length} chars)${sourceNote}. Email/URL/slug? Without \`overflow-wrap\` it can push parent width.`,
        suggestion: `Add \`overflow-wrap: anywhere\` (or \`word-break: break-word\`) on this instance`,
      });
    }
  } else if (hasExpressionBinding && !hasWrapStyle(ctx.stylesByInstance, inst.id) && expressionResolutions.length === 0) {
    ctx.issues.push({
      severity: "🟠",
      instanceId: inst.id,
      label: instLabel(inst),
      reason: `Dynamic binding on <${inst.tag}> without \`overflow-wrap\`. If the resolved value is long (email, URL, slug), it may push the parent width.`,
      suggestion: `Add \`overflow-wrap: anywhere\` defensively on this instance`,
    });
  }
}

export function scanSvgIssues(ctx: ScanCtx, inst: Inst) {
  // 11. SVG inline with hardcoded px width > viewport
  if (inst.component !== "HtmlEmbed") return;
  const codeProp = ctx.build.props.find((p) => p.instanceId === inst.id && p.name === "code");
  if (!codeProp || typeof codeProp.value !== "string") return;
  const m = codeProp.value.match(/<svg[^>]*\swidth=\"(\d+(?:\.\d+)?)(px)?\"[^>]*>/i);
  if (!m) return;
  const w = parseFloat(m[1]);
  const minViewport = Math.min(...ctx.targetBps.map((t) => t.viewport ?? 9999));
  if (w > minViewport) {
    ctx.issues.push({
      severity: "🔴",
      instanceId: inst.id,
      label: instLabel(inst),
      value: `width="${w}"`,
      reason: `Inline SVG hardcodes width=${w} px > ${minViewport}px viewport`,
      suggestion: `Set SVG width="100%" and control size via CSS on the HtmlEmbed`,
    });
  }
}

export type { ScanCtx };
