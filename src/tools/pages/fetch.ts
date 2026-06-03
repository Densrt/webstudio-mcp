// Tool: webstudio_fetch_pages — list pages in a Webstudio Cloud project.

import { z } from "zod";
import type { ToolModule } from "../types.js";
import { textResult, errorResult, authErrorResult, runtimeErrorResult } from "../types.js";
import { requireAuth } from "../../auth.js";
import { fetchBuild } from "../../webstudio-client.js";

export const fetchPagesInputSchema = z.object({ projectSlug: z.string() }).strict();

export const fetchPagesTool: ToolModule = {
  definition: {
    name: "webstudio_fetch_pages",
    description: `Use when: list every page in a Webstudio Cloud project — typically to resolve a pageId / rootInstanceId before push_fragment, update_page, or to populate type="page" prop values for internal links.
Do NOT use when: you need the folder hierarchy (slugs, nesting) — use webstudio_list_folders (interleaves pages + folders as a tree). For a page's tree of instances, use webstudio_list_instances.
Returns: list of {id, name, path, rootInstanceId} with the HOME page marked + build version.
Side effects: none (read-only).

Example: { projectSlug: "acme" }`,
    inputSchema: {
      type: "object",
      properties: { projectSlug: { type: "string" } },
      required: ["projectSlug"],
      additionalProperties: false,
    },
    annotations: {
      title: "Fetch project pages",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  handler: async (args) => {
    const parsed = fetchPagesInputSchema.safeParse(args);
    if (!parsed.success) return errorResult("VALIDATION_FAILED", `Validation error: ${parsed.error.message}`);
    try {
      const auth = requireAuth(parsed.data.projectSlug);
      const build = await fetchBuild(auth);
      const lines = build.pages.pages.map((p) => {
        const isHome = p.id === build.pages.homePageId;
        return `- ${p.path || "/"} (${p.name})${isHome ? " [HOME]" : ""}\n    pageId: ${p.id}\n    rootInstanceId: ${p.rootInstanceId}`;
      });
      return textResult(`Build "${parsed.data.projectSlug}" — version ${build.version} — ${build.pages.pages.length} page(s):\n${lines.join("\n")}`);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("auth not configured")) return authErrorResult(err);
      return runtimeErrorResult(err, "Error");
    }
  },
};
