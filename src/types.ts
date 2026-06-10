// WebstudioFragment — transferable subset for copy/paste between projects.
// Based on the official @webstudio-is/sdk data model.
// Real format observed via copy from the Webstudio builder (May 2026):
// - Top-level wrapper: {"@webstudio/instance/v0.1": {...}}
// - styleSourceSelections (camelCase, no underscore)
// - HTML components use {component: "ws:element", tag: "..."}

export type InstanceId = string;
export type StyleSourceId = string;
export type BreakpointId = string;
export type PropId = string;
export type DataSourceId = string;

// Logical labels for breakpoints — mapped to nanoid IDs at build time.
export type BreakpointLabel = "base" | "tablet" | "mobile-landscape" | "mobile-portrait";

// Breakpoint definitions (IDs are generated when the builder is instantiated).
export const DEFAULT_BREAKPOINT_DEFS: { label: BreakpointLabel; displayLabel: string; maxWidth?: number }[] = [
  { label: "base", displayLabel: "Base" },
  { label: "tablet", displayLabel: "Tablet", maxWidth: 991 },
  { label: "mobile-landscape", displayLabel: "Mobile landscape", maxWidth: 767 },
  { label: "mobile-portrait", displayLabel: "Mobile portrait", maxWidth: 479 },
];

export type Breakpoint = {
  id: BreakpointId;
  label: string;
  minWidth?: number;
  maxWidth?: number;
  condition?: string; // ex: "(prefers-color-scheme: dark)"
};

export type InstanceChild =
  | { type: "id"; value: InstanceId }
  | { type: "text"; value: string }
  | { type: "expression"; value: string };

export type Instance = {
  type: "instance";
  id: InstanceId;
  component: string;
  tag?: string;
  label?: string;
  children: InstanceChild[];
};

// Prop types — every variant accepted by Webstudio (cf. packages/sdk/src/schema/props.ts).
export type PropType =
  | "number"
  | "string"
  | "boolean"
  | "json"
  | "asset"
  | "page"
  | "string[]"
  | "parameter"
  | "resource"
  | "expression"
  | "action"
  | "animationAction";

export type Prop = {
  id: PropId;
  instanceId: InstanceId;
  name: string;
  type: PropType;
  value: unknown;
};

// StyleSource — local or token.
export type StyleSource =
  | { type: "local"; id: StyleSourceId }
  | { type: "token"; id: StyleSourceId; name: string; locked?: boolean };

// StyleSourceSelection — instanceId → [styleSourceId, ...] mapping.
export type StyleSourceSelection = {
  instanceId: InstanceId;
  values: StyleSourceId[];
};

// StyleValue — union of types accepted by Webstudio.
// IMPORTANT: "color" uses the extended format (colorSpace + components 0..1 + alpha).
// The simple form {type:"color", value:"#hex"} is REJECTED by the validator.
// IMPORTANT: tuple + function are the canonical shapes Webstudio uses to store CSS function-call
// values like `blur(8px)`, `translate(10px, 5px)`, or each transition layer (one entry per transition).
// Passing these as {type:"unparsed", value:"blur(8px)"} is accepted by the server validator BUT the
// Webstudio UI panel will NOT decode it (the user sees an empty/hidden field). Always use tuple+function
// for: filter, backdropFilter, transform, transitionProperty, transitionDuration, transitionDelay,
// transitionTimingFunction, animation*, willChange (multi-value).
export type StyleValue =
  | { type: "unit"; value: number; unit: string }
  | { type: "keyword"; value: string }
  | { type: "color"; colorSpace: "hex" | "rgb" | "hsl" | "lab" | "lch" | "oklab" | "oklch"; components: number[]; alpha: number }
  | { type: "var"; value: string; fallback?: StyleValue }
  | { type: "unparsed"; value: string }
  | { type: "fontFamily"; value: string[] }
  | { type: "image"; value: { type: "asset"; value: string } | { type: "url"; url: string } }
  | { type: "layers"; value: StyleValue[] }
  | { type: "tuple"; value: StyleValue[] }
  | { type: "function"; name: string; args: StyleValue }
  | { type: "shadow"; position: "outset" | "inset"; offsetX: StyleValue; offsetY: StyleValue; blur: StyleValue; spread: StyleValue; color: StyleValue };

export type StyleDecl = {
  styleSourceId: StyleSourceId;
  breakpointId: BreakpointId;
  state?: string; // ":hover", "::before", etc.
  property: string;
  value: StyleValue;
  listed?: boolean;
};

// DataSource — variable or parameter.
export type DataSource =
  | { type: "variable"; id: DataSourceId; scopeInstanceId: InstanceId; name: string; value: { type: string; value: unknown } }
  | { type: "parameter"; id: DataSourceId; scopeInstanceId: InstanceId; name: string };

// Internal fragment payload (without the wrapper).
export type WebstudioFragmentPayload = {
  instanceSelector: InstanceId[];
  children: InstanceChild[];
  instances: Instance[];
  styleSourceSelections: StyleSourceSelection[];
  styleSources: StyleSource[];
  breakpoints: Breakpoint[];
  styles: StyleDecl[];
  dataSources: DataSource[];
  resources: unknown[];
  props: Prop[];
  assets: unknown[];
};

// WebstudioFragment — the actual paste format, with the version wrapper.
export type WebstudioFragment = {
  "@webstudio/instance/v0.1": WebstudioFragmentPayload;
};

// Radix UI namespace inside Webstudio.
export const RADIX_NS = "@webstudio-is/sdk-components-react-radix";

// Every Radix component exposed by Webstudio — addInstance() prefixes them automatically.
export const RADIX_COMPONENTS = new Set([
  "Collapsible", "CollapsibleTrigger", "CollapsibleContent",
  "Dialog", "DialogTrigger", "DialogOverlay", "DialogContent", "DialogClose", "DialogTitle", "DialogDescription",
  "Popover", "PopoverTrigger", "PopoverContent", "PopoverClose",
  "Tooltip", "TooltipTrigger", "TooltipContent",
  "Tabs", "TabsList", "TabsTrigger", "TabsContent",
  "Label",
  "NavigationMenu", "NavigationMenuList", "NavigationMenuItem",
  "NavigationMenuTrigger", "NavigationMenuContent", "NavigationMenuLink", "NavigationMenuViewport",
  "Select", "SelectTrigger", "SelectValue", "SelectViewport",
  "SelectContent", "SelectItem", "SelectItemIndicator", "SelectItemText",
  "Switch", "SwitchThumb",
  "Checkbox", "CheckboxIndicator",
  "RadioGroup", "RadioGroupItem", "RadioGroupIndicator",
]);

// Maps our component aliases to ws:element + HTML tag.
// Components left as-is are real Webstudio React components with their own
// runtime: Image (srcset, lazy, asset-bound dims), HtmlEmbed, Form, Input,
// Textarea, Select, Video, YouTube, Vimeo, etc. For images, ALWAYS use the
// first-class "Image" component — src accepts asset | URL string | expression
// (pattern image-component) — NEVER ws:element tag="img" (the push boundary
// auto-converts those, coerce:image-component). For HTML5 video, always use
// the first-class "Video" component — NEVER ws:element tag="video".
export const COMPONENT_TO_TAG: Record<string, { component: string; defaultTag: string }> = {
  Box: { component: "ws:element", defaultTag: "div" },
  Heading: { component: "ws:element", defaultTag: "h1" },
  Paragraph: { component: "ws:element", defaultTag: "p" },
  Button: { component: "ws:element", defaultTag: "button" },
  Link: { component: "ws:element", defaultTag: "a" },
  Text: { component: "ws:element", defaultTag: "span" },
  Span: { component: "ws:element", defaultTag: "span" },
  Section: { component: "ws:element", defaultTag: "section" },
};
