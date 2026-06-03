// MIME type tables and detection for asset uploads.
// Webstudio distinguishes "image" vs "font" in asset metadata.

export const MIME_TO_TYPE: Record<string, "image" | "font"> = {
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/avif": "image",
  "image/gif": "image",
  "image/svg+xml": "image",
  "font/ttf": "font",
  "font/otf": "font",
  "font/woff": "font",
  "font/woff2": "font",
  "application/font-woff": "font",
  "application/font-woff2": "font",
  "application/x-font-ttf": "font",
  "application/x-font-otf": "font",
};

// Filename extension → MIME fallback when not provided explicitly.
export const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

export function detectMime(filename: string, explicit?: string): string | undefined {
  if (explicit) return explicit;
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return EXT_TO_MIME[ext];
}
