// Quantities the inspector derives from a body's confirmed backend state. Each is a textbook formula on values the
// backend supplied; none is a simulation output, and each is labelled as derived where it is shown.
import type { Vec3 } from "../api/types";

/** CODATA 2018, the value the backend engine and the presets use (context/PRESETS.md). */
export const G_SI = 6.6743e-11;

export const magnitude = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);

/** Mean density of a uniform sphere, kg/m^3; null for a non-positive radius. */
export function meanDensity(massKg: number, radiusM: number): number | null {
  if (!(radiusM > 0) || !(massKg >= 0)) return null;
  return massKg / ((4 / 3) * Math.PI * radiusM ** 3);
}

/** Gravitational acceleration at the surface of a spherically symmetric body, m/s^2 (no rotation). */
export function surfaceGravity(massKg: number, radiusM: number): number | null {
  if (!(radiusM > 0) || !(massKg >= 0)) return null;
  return (G_SI * massKg) / radiusM ** 2;
}

/** Speed needed to escape from the surface, m/s (point-mass gravity, no atmosphere or rotation). */
export function escapeSpeed(massKg: number, radiusM: number): number | null {
  if (!(radiusM > 0) || !(massKg >= 0)) return null;
  return Math.sqrt((2 * G_SI * massKg) / radiusM);
}
