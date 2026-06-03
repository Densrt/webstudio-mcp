// Shared types and constants for the overflow audit.

export const VIEWPORT_BY_BP: Record<string, number> = {
  "mobile-portrait": 479,
  "mobile-landscape": 767,
  tablet: 991,
};

export const BP_LABEL_MAP: Record<string, string> = {
  "mobile-portrait": "Mobile portrait",
  "mobile-landscape": "Mobile landscape",
  tablet: "Tablet",
};

export type Severity = "🔴" | "🟡" | "🟠";
export const SEV_RANK: Record<Severity, number> = { "🔴": 3, "🟡": 2, "🟠": 1 };
export const MIN_SEV_RANK: Record<string, number> = { critical: 3, warning: 2, hint: 1 };

export type Issue = {
  severity: Severity;
  instanceId: string;
  label: string;
  property?: string;
  value?: string;
  bp?: string;
  reason: string;
  suggestion?: string;
};

export type StyleEntry = {
  property: string;
  value: unknown;
  bpId: string;
  state: string;
  ssId: string;
};
