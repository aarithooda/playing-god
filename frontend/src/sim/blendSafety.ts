// Display-only: decides which bodies must NOT be blended between two snapshots.
//
// CelestialBody eases each body in a straight line from its previous to its next snapshot position. A moon's
// motion is a fast orbit about its planet riding on the planet's slower orbit about the Sun. When one step covers a
// large part of the moon's orbit (high speed), the straight line is a chord that cuts through the planet and the
// two eased positions disagree. Such moon systems (the moon and its primary together) are drawn at the committed
// snapshot instead. Positions are never altered: the blend is simply skipped.
const G = 6.6743e-11;

/** A moon whose orbit advances by more than this many radians per snapshot is not blended. */
export const MAX_BLEND_ORBIT_ANGLE_RAD = 0.35;

interface MassivePoint {
  id: string;
  massKg?: number;
  primaryId?: string;
  positionM: { x: number; y: number; z: number };
}

/** Ids of moons and their primaries whose motion over `stepSeconds` is too large to blend linearly. */
export function unblendableIds(bodies: readonly MassivePoint[], stepSeconds: number): Set<string> {
  const out = new Set<string>();
  if (!(stepSeconds > 0)) return out;
  const byId = new Map(bodies.map((b) => [b.id, b]));
  for (const moon of bodies) {
    const primary = moon.primaryId !== undefined && moon.primaryId !== moon.id ? byId.get(moon.primaryId) : undefined;
    if (!primary || !(moon.massKg !== undefined && primary.massKg !== undefined)) continue;
    const r = Math.hypot(moon.positionM.x - primary.positionM.x, moon.positionM.y - primary.positionM.y, moon.positionM.z - primary.positionM.z);
    if (!(r > 0)) continue;
    const meanMotion = Math.sqrt((G * (moon.massKg + primary.massKg)) / (r * r * r));
    if (meanMotion * stepSeconds > MAX_BLEND_ORBIT_ANGLE_RAD) {
      out.add(moon.id);
      out.add(primary.id);
    }
  }
  return out;
}
