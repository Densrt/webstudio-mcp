// Shared types for the audit-scripts tool.

export type Severity = "critical" | "warn" | "info";

export type FindingKind =
  | "render-blocking-script"
  | "google-fonts-external"
  | "inline-script"
  | "external-css"
  | "tracker";

export type Finding = {
  kind: FindingKind;
  severity: Severity;
  source: string;
  snippet: string;
  extra?: string; // e.g. tracker name
};

export type HtmlSource = {
  label: string;
  html: string;
};
