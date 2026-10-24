import type { BodyView } from "./viewModel";

const G = 6.6743e-11;
const ORBIT_SAMPLES = 160;

export interface MoonRelativeOrbit {
  id: string;
  name: string;
  colorHex: string;
  /** Current moon position relative to its primary, projected onto the system's x-y view. */
  current: [number, number];
  /** Current osculating two-body orbit, projected onto the system's x-y view. */
  points: [number, number][];
}

const dot = (a: [number, number, number], b: [number, number, number]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const magnitude = (a: [number, number, number]) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: [number, number, number], length: number): [number, number, number] => [a[0] / length, a[1] / length, a[2] / length];

/**
 * Reconstructs each moon's current osculating orbit from its live relative position and velocity.
 * This gives the inset a complete orbit immediately, without waiting for the preset's sparse history samples.
 */
export function moonRelativeOrbits(parent: BodyView, bodies: readonly BodyView[]): MoonRelativeOrbit[] {
  const moons = bodies.filter((body) => body.primaryId === parent.id && body.id !== parent.id);
  return moons.flatMap((moon) => {
    const r: [number, number, number] = [
      moon.positionM.x - parent.positionM.x,
      moon.positionM.y - parent.positionM.y,
      moon.positionM.z - parent.positionM.z,
    ];
    const v: [number, number, number] = [
      moon.velocityMPerS.x - parent.velocityMPerS.x,
      moon.velocityMPerS.y - parent.velocityMPerS.y,
      moon.velocityMPerS.z - parent.velocityMPerS.z,
    ];
    const radius = magnitude(r);
    const mu = G * (parent.massKg + moon.massKg);
    if (!(radius > 0) || !(mu > 0)) return [];

    const angularMomentum = cross(r, v);
    const h = magnitude(angularMomentum);
    if (!(h > 0)) return [];
    const hHat = unit(angularMomentum, h);
    const eccentricityVector = cross(v, angularMomentum).map((value, i) => value / mu - r[i]! / radius) as [number, number, number];
    const eccentricity = magnitude(eccentricityVector);
    const specificEnergy = 0.5 * dot(v, v) - mu / radius;
    if (!(specificEnergy < 0) || !(eccentricity < 1)) return [];
    const semiMajorAxis = -mu / (2 * specificEnergy);
    const pHat = eccentricity > 1e-8 ? unit(eccentricityVector, eccentricity) : unit(r, radius);
    const qHat = cross(hHat, pHat);
    const semiLatusRectum = semiMajorAxis * (1 - eccentricity * eccentricity);
    const points: [number, number][] = [];

    for (let i = 0; i <= ORBIT_SAMPLES; i += 1) {
      const theta = (i / ORBIT_SAMPLES) * Math.PI * 2;
      const distance = semiLatusRectum / (1 + eccentricity * Math.cos(theta));
      const x = distance * (pHat[0] * Math.cos(theta) + qHat[0] * Math.sin(theta));
      const y = distance * (pHat[1] * Math.cos(theta) + qHat[1] * Math.sin(theta));
      points.push([x, y]);
    }
    return [{ id: moon.id, name: moon.name, colorHex: moon.colorHex, current: [r[0], r[1]] as [number, number], points }];
  });
}
