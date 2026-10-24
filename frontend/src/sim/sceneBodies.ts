// The one place that turns bodies into scene bodies for a size mode (pure, so it is unit-tested).
import { separateDisplayRadii } from "./radiusSeparation";
import type { RenderTransform, SizeMode } from "./renderTransform";
import { toSceneBody, type DisplayBody, type SceneBody } from "./viewModel";

/**
 * Adds `clearance` (scene distance to the nearest moon, or to the primary for a moon) to every body that has one.
 * It only limits how far a body is enlarged on screen, so a planet never hides its moons; it changes no radius.
 */
export function withClearances(bodies: SceneBody[]): SceneBody[] {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const clearance = new Map<string, number>();
  const near = (id: string, d: number) => clearance.set(id, Math.min(clearance.get(id) ?? Infinity, d));
  for (const m of bodies) {
    const primary = m.primaryId !== undefined && m.primaryId !== m.id ? byId.get(m.primaryId) : undefined;
    if (!primary) continue;
    const d = Math.hypot(m.position[0] - primary.position[0], m.position[1] - primary.position[1], m.position[2] - primary.position[2]);
    near(m.id, d);
    near(primary.id, d);
  }
  return clearance.size === 0 ? bodies : bodies.map((b) => (clearance.has(b.id) ? { ...b, clearance: clearance.get(b.id)! } : b));
}

/**
 * "physical": each body's radius is its own physical radius / scale; nothing about the other bodies enters, so adding a
 * moon (or any body) cannot change another body's size. "exaggerated": the earlier logarithmic radii, shrunk
 * together so close bodies do not overlap (that shrink does depend on the neighbours, which is why it is not the default).
 */
export function buildSceneBodies(bodies: readonly DisplayBody[], transform: RenderTransform, sizeMode: SizeMode): SceneBody[] {
  const scene = bodies.map((b) => toSceneBody(b, transform, sizeMode));
  return sizeMode === "physical" ? withClearances(scene) : separateDisplayRadii(scene);
}
