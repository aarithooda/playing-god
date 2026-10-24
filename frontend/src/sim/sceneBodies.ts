// The one place that turns bodies into scene bodies for a view (pure, so it is unit-tested).
import type { RenderTransform, SizeMode } from "./renderTransform";
import { toSceneBody, type DisplayBody, type SceneBody } from "./viewModel";

/**
 * Describes each planet + moons system for the zoom-in growth limit: `clearance` is the smallest planet-moon distance of
 * the system and `systemPx` the largest minimum radius among its members, shared by all of them so their ratio is kept.
 * A body outside any system is returned untouched. The relationship is the backend's `primaryId`; a primary that is not in
 * the scene is ignored. Nothing here changes a radius or a position.
 */
export function withSystems(bodies: SceneBody[]): SceneBody[] {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const systems = new Map<string, { members: SceneBody[]; clearance: number }>();
  for (const m of bodies) {
    const primary = m.primaryId !== undefined && m.primaryId !== m.id ? byId.get(m.primaryId) : undefined;
    if (!primary) continue;
    const d = Math.hypot(m.position[0] - primary.position[0], m.position[1] - primary.position[1], m.position[2] - primary.position[2]);
    const sys = systems.get(primary.id) ?? { members: [primary], clearance: Infinity };
    sys.members.push(m);
    sys.clearance = Math.min(sys.clearance, d);
    systems.set(primary.id, sys);
  }
  if (systems.size === 0) return bodies;
  const info = new Map<string, { clearance: number; systemPx: number }>();
  for (const { members, clearance } of systems.values()) {
    const systemPx = Math.max(...members.map((b) => b.visiblePx ?? 0));
    for (const b of members) info.set(b.id, { clearance, systemPx });
  }
  return bodies.map((b) => (info.has(b.id) ? { ...b, ...info.get(b.id)! } : b));
}

/**
 * Both views draw the true radius; they differ only in the minimum on-screen size and zoom growth (renderTransform.ts).
 * A body's entry depends on that body, the scale and the view - never on how many other bodies exist.
 */
export function buildSceneBodies(bodies: readonly DisplayBody[], transform: RenderTransform, view: SizeMode): SceneBody[] {
  return withSystems(bodies.map((b) => toSceneBody(b, transform, view)));
}
