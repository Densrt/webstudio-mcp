// Project-token resolution for FragmentBuilder — loads tokens from a
// `projects/{slug}/tokens.json` registry and materializes them inside the
// fragment with their stable IDs.

import type {
  InstanceId,
  StyleDecl,
  StyleSource,
  StyleSourceId,
  StyleSourceSelection,
} from "../types.js";
import type { ProjectConfig } from "../projects.js";
import { loadProject } from "../projects.js";
import { expandShorthand } from "./shorthands.js";
import { attachToken } from "./fragment-styles.js";

type State = {
  styleSources: StyleSource[];
  styleSelections: StyleSourceSelection[];
  styles: StyleDecl[];
};

/** Load a project config or throw a clear error. */
export function loadProjectOrThrow(projectSlug: string): ProjectConfig {
  const project = loadProject(projectSlug);
  if (!project) {
    throw new Error(
      `Project "${projectSlug}" not found. Run webstudio_init_project first or check ${projectSlug}/tokens.json exists.`,
    );
  }
  return project;
}

/**
 * Materialize a project token into the fragment (idempotent — same slug reused
 * across calls returns the same styleSourceId), then attach it to the instance.
 */
export function useProjectToken(
  state: State,
  project: ProjectConfig,
  projectTokenSourceIds: Map<string, StyleSourceId>,
  resolveBreakpoint: (b: string) => string,
  instanceId: InstanceId,
  tokenSlug: string,
): void {
  const def = project.tokens[tokenSlug];
  if (!def) {
    const available = Object.keys(project.tokens).join(", ");
    throw new Error(
      `Token "${tokenSlug}" not found in project "${project.projectSlug}". Available: ${available || "(none)"}`,
    );
  }

  let sourceId = projectTokenSourceIds.get(tokenSlug);
  if (!sourceId) {
    sourceId = def.id;
    state.styleSources.push({ type: "token", id: sourceId, name: def.name });
    const breakpointId = resolveBreakpoint("base");
    for (const [property, value] of Object.entries(def.styles)) {
      const expanded = expandShorthand(property, value);
      for (const [p, v] of expanded) {
        state.styles.push({ styleSourceId: sourceId, breakpointId, property: p, value: v });
      }
    }
    projectTokenSourceIds.set(tokenSlug, sourceId);
  }

  attachToken(state, instanceId, sourceId);
}
