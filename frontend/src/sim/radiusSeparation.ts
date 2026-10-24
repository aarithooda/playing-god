// Display-only radius separation.
//
// Display radii (renderTransform.displayRadiusUnits) are logarithmic and exaggerated, while positions are linear. In a
// real planetary system the inner orbits are closer together than those exaggerated radii, so the discs overlap. This
// applies ONE uniform shrink factor (never > 1) to every display radius, just enough that no two drawn spheres touch.
// A uniform factor keeps the relative sizes (the Sun stays larger than Jupiter). It changes nothing but `radius` of the
// scene copy: positions, the backend state and the inspector's true radiusM are untouched. It depends only on the
// current bodies, so it also applies to recorded history frames and custom universes, and never looks at names or ids.
//
// Moons: a moon orbits far closer to its planet than any planet to its neighbour (the Moon is 0.003 scene units from
// Earth, whose exaggerated display radius is ~2), so one factor for everything would shrink the whole scene to dots.
// Instead moons are left out of the planetary factor, and each planet + its moons get their own, smaller factor
// (relative sizes inside the system are kept). The planet keeps `apparentRadius`, the size the planetary factor alone
// gives it, so the renderer can still draw it that large from far away (sim/bodyVisibility.ts). The relationship comes
// only from the backend's `primaryId`; positions are never touched.
import type { SceneBody } from "./viewModel";

/** Two spheres may use at most this fraction of the gap between their centres, which leaves a visible margin. */
export const MAX_RADIUS_FRACTION_OF_GAP = 0.8;
/** Lower bound on the factor so coincident bodies still have a drawable (and pickable) sphere; collision is the backend's job. */
const MIN_FACTOR = 1e-3;
/** Same for a planet + moons: their gap is ~1e-3 of the planetary spacing, and the renderer lifts them to a visible size. */
const MIN_SYSTEM_FACTOR = 1e-7;

export function separationFactor(bodies: readonly SceneBody[], floor: number = MIN_FACTOR): number {
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
  return Math.max(floor, factor);
}

function distance(a: SceneBody, b: SceneBody): number {
  return Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
}

export function separateDisplayRadii(bodies: SceneBody[]): SceneBody[] {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const isMoon = (b: SceneBody) => b.primaryId !== undefined && b.primaryId !== b.id && byId.has(b.primaryId);
  const moons = bodies.filter(isMoon);
  if (moons.length === 0) {
    const factor = separationFactor(bodies);
    return factor >= 1 ? bodies : bodies.map((b) => ({ ...b, radius: b.radius * factor }));
  }

  const planetary = separationFactor(bodies.filter((b) => !isMoon(b)));
  const systems = new Map<string, SceneBody[]>(); // primary id -> its moons
  for (const m of moons) systems.set(m.primaryId!, [...(systems.get(m.primaryId!) ?? []), m]);

  const factor = new Map<string, number>();
  const clearance = new Map<string, number>();
  const note = (id: string, f: number) => factor.set(id, Math.min(factor.get(id) ?? planetary, f));
  const near = (id: string, d: number) => clearance.set(id, Math.min(clearance.get(id) ?? Infinity, d));
  for (const [primaryId, members] of systems) {
    const primary = byId.get(primaryId)!;
    const f = Math.min(planetary, separationFactor([primary, ...members], MIN_SYSTEM_FACTOR));
    for (const b of [primary, ...members]) note(b.id, f);
    for (const m of members) {
      const d = distance(primary, m);
      near(primaryId, d);
      near(m.id, d);
    }
  }

  return bodies.map((b) => {
    const f = factor.get(b.id) ?? planetary;
    const inSystem = factor.has(b.id);
    if (!inSystem && f >= 1) return b;
    return {
      ...b,
      radius: b.radius * f,
      ...(inSystem && !isMoon(b) ? { apparentRadius: b.radius * planetary } : {}),
      ...(clearance.has(b.id) ? { clearance: clearance.get(b.id)! } : {}),
    };
  });
}
