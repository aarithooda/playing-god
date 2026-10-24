// Display-only radius separation.
//
// Display radii (renderTransform.displayRadiusUnits) are logarithmic and exaggerated, while positions are linear. In a
// real planetary system the inner orbits are closer together than those exaggerated radii, so the discs overlap. This
// applies ONE uniform shrink factor (never > 1) to every display radius, just enough that no two drawn spheres touch.
// A uniform factor keeps the relative sizes (the Sun stays larger than Jupiter). It changes nothing but `radius` of the
// scene copy: positions, the backend state and the inspector's true radiusM are untouched. It depends only on the
// current bodies, so it also applies to recorded history frames and custom universes, and never looks at names or ids.
import type { SceneBody } from "./viewModel";

/** Two spheres may use at most this fraction of the gap between their centres, which leaves a visible margin. */
export const MAX_RADIUS_FRACTION_OF_GAP = 0.8;
/** Lower bound on the factor so coincident bodies still have a drawable (and pickable) sphere; collision is the backend's job. */
const MIN_FACTOR = 1e-3;

export function separationFactor(bodies: readonly SceneBody[]): number {
  let factor = 1;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const sum = a.radius + b.radius;
      if (!(sum > 0)) continue;
      const d = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
      factor = Math.min(factor, (MAX_RADIUS_FRACTION_OF_GAP * d) / sum);
    }
  }
  return Math.max(MIN_FACTOR, factor);
}

export function separateDisplayRadii(bodies: SceneBody[]): SceneBody[] {
  const factor = separationFactor(bodies);
  return factor >= 1 ? bodies : bodies.map((b) => ({ ...b, radius: b.radius * factor }));
}
