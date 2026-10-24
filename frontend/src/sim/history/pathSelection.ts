// Which bodies "Show paths" draws. Pure, so it is tested without React.
export const MAX_PATH_BODIES = 20;

/** The selected body's path; otherwise every body's, but only while the scene is small enough to stay readable. */
export function pathTargets(bodyIds: readonly string[], selectedBodyId: string | undefined): string[] {
  if (selectedBodyId && bodyIds.includes(selectedBodyId)) return [selectedBodyId];
  return bodyIds.length <= MAX_PATH_BODIES ? [...bodyIds] : [];
}

/** A hint when the toggle is on but no path can be drawn because of the crowd. */
export function pathsNote(showPaths: boolean, bodyCount: number, selectedBodyId: string | undefined): string | undefined {
  if (showPaths && !selectedBodyId && bodyCount > MAX_PATH_BODIES) return `Select a body to show its path (more than ${MAX_PATH_BODIES} bodies).`;
  return undefined;
}
