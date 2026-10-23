// Display helpers for the backend `diagnostics` object. Values are shown as the backend sent them (rounded only for
// display, to 4 significant digits); `null` is "Undefined", never zero. The two derived sums are plain additions of
// backend values (no physics) and are unavailable whenever an input is.
import type { DiagnosticsDto, Vec3 } from "../api/types";

export const UNDEFINED_TEXT = "Undefined";

/** 4 significant digits; plain decimal for 1e-3 <= |x| < 1e6, otherwise scientific. Zero is a real value: "0". */
export function formatQuantity(x: number): string {
  if (x === 0) return "0"; // also -0
  const abs = Math.abs(x);
  if (abs >= 1e-3 && abs < 1e6) return String(Number(x.toPrecision(4)));
  return x.toExponential(3).replace("e+", "e");
}

export function formatScalar(x: number | null, unit: string): string {
  return x === null ? UNDEFINED_TEXT : `${formatQuantity(x)} ${unit}`;
}

/** A vector is shown whole or not at all. */
export function formatVector(v: Vec3 | null, unit: string): string {
  if (v === null) return UNDEFINED_TEXT;
  return `(${formatQuantity(v.x)}, ${formatQuantity(v.y)}, ${formatQuantity(v.z)}) ${unit}`;
}

/** K + U, only when both are valid and the sum is finite. Not conserved across mergers. */
export function kineticPlusPotential(d: DiagnosticsDto): number | null {
  if (d.kineticEnergyJ === null || d.potentialEnergyJ === null) return null;
  const sum = d.kineticEnergyJ + d.potentialEnergyJ;
  return Number.isFinite(sum) ? sum : null;
}

/** Angular momentum about the origin + booked spin, only when both vectors are valid and the sum is finite. */
export function orbitalPlusBookedSpin(d: DiagnosticsDto): Vec3 | null {
  const a = d.angularMomentumAboutOriginKgM2PerS;
  const b = d.bookedSpinKgM2PerS;
  if (a === null || b === null) return null;
  const sum = { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  return Number.isFinite(sum.x) && Number.isFinite(sum.y) && Number.isFinite(sum.z) ? sum : null;
}
