// Planet + moon relationships for display (labels and focus framing). The relationship is the backend's `primaryId`;
// nothing here changes a position, and nothing looks at names or ids.
import type { SceneBody } from "./viewModel";

type Related = Pick<SceneBody, "id" | "primaryId">;

/** The ids of the selected body's planet system: its primary, that primary's moons and itself. Empty when it has none. */
export function systemIds(bodies: readonly Related[], selectedId: string | undefined): string[] {
  if (selectedId === undefined) return [];
  const known = new Set(bodies.map((b) => b.id));
  const selected = bodies.find((b) => b.id === selectedId);
  if (!selected) return [];
  const primaryId = selected.primaryId !== undefined && known.has(selected.primaryId) ? selected.primaryId : selected.id;
  const moons = bodies.filter((b) => b.primaryId === primaryId && b.id !== primaryId).map((b) => b.id);
  return moons.length === 0 ? [] : [primaryId, ...moons];
}

/** Extra room, as a multiple of the farthest moon's distance, when framing a planet together with its moons. */
export const SYSTEM_FRAMING_MARGIN = 1.1;

/**
 * Display radius to frame when focusing a body. A planet with moons is framed together with them, so double-clicking
 * Jupiter shows the Galilean moons instead of a bare disc; anything else keeps its own display radius.
 */
export function focusRadiusFor(bodies: readonly SceneBody[], id: string): number | undefined {
  const body = bodies.find((b) => b.id === id);
  if (!body) return undefined;
  let farthest = 0;
  for (const m of bodies) {
    if (m.primaryId !== id || m.id === id) continue;
    farthest = Math.max(farthest, Math.hypot(m.position[0] - body.position[0], m.position[1] - body.position[1], m.position[2] - body.position[2]));
  }
  return farthest > 0 ? Math.max(body.radius, farthest * SYSTEM_FRAMING_MARGIN) : body.radius;
}
