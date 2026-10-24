// Which bodies "Show paths" draws. Pure, so it is tested without React.
export const MAX_PATH_BODIES = 20;

/**
 * The selected body's path; otherwise every body's, but only while the scene is small enough to stay readable.
 *
 * A scene with moons keeps every body's path visible together so each satellite can be compared with its planet and
 * the Sun. The planet-relative orbital curves are shown separately in the selected planet's inset.
 */
export function pathTargets(bodyIds: readonly string[], selectedBodyId: string | undefined, moonIds?: ReadonlySet<string>): string[] {
  if (moonIds && moonIds.size > 0) {
    return bodyIds.slice();
  }
  if (selectedBodyId && bodyIds.includes(selectedBodyId)) return [selectedBodyId];
  return bodyIds.length <= MAX_PATH_BODIES ? [...bodyIds] : [];
}

/** A hint when the toggle is on but no path can be drawn because of the crowd. */
export function pathsNote(showPaths: boolean, bodyCount: number, selectedBodyId: string | undefined, hasMoons = false): string | undefined {
  if (showPaths && !hasMoons && !selectedBodyId && bodyCount > MAX_PATH_BODIES) return `Select a body to show its path (more than ${MAX_PATH_BODIES} bodies).`;
  return undefined;
}
