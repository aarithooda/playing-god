// Which bodies "Show paths" draws. Pure, so it is tested without React.
export const MAX_PATH_BODIES = 20;

/**
 * The selected body's path; otherwise every body's, but only while the scene is small enough to stay readable.
 *
 * A scene with moons (`moonIds`) is different: the planets' orbit paths are the picture and must not vanish because
 * something was selected or because the moons made the scene crowded, so every non-moon body keeps its path, and a
 * selected moon adds its own. (A moon's path from the 5-day history grid is a planet path plus a sub-pixel wiggle.)
 */
export function pathTargets(bodyIds: readonly string[], selectedBodyId: string | undefined, moonIds?: ReadonlySet<string>): string[] {
  if (moonIds && moonIds.size > 0) {
    const planets = bodyIds.filter((id) => !moonIds.has(id));
    const shown = planets.length <= MAX_PATH_BODIES ? planets : [];
    return selectedBodyId && moonIds.has(selectedBodyId) && bodyIds.includes(selectedBodyId) ? [...shown, selectedBodyId] : shown;
  }
  if (selectedBodyId && bodyIds.includes(selectedBodyId)) return [selectedBodyId];
  return bodyIds.length <= MAX_PATH_BODIES ? [...bodyIds] : [];
}

/** A hint when the toggle is on but no path can be drawn because of the crowd. */
export function pathsNote(showPaths: boolean, bodyCount: number, selectedBodyId: string | undefined, hasMoons = false): string | undefined {
  if (showPaths && !hasMoons && !selectedBodyId && bodyCount > MAX_PATH_BODIES) return `Select a body to show its path (more than ${MAX_PATH_BODIES} bodies).`;
  return undefined;
}
