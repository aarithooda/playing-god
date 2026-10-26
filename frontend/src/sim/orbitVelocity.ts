import type { Vec3 } from "../api/types";
import { G_SI } from "./derivedQuantities";

interface Primary { name: string; massKg: number; positionM: Vec3; velocityMPerS: Vec3; kind: string }

/** The most massive star, if any: what a new planet is offered to orbit. */
export function pickPrimaryStar<T extends Primary>(bodies: readonly T[]): T | undefined {
  return bodies.filter((b) => b.kind === "star").sort((a, b) => b.massKg - a.massKg)[0];
}

/**
 * Velocity of a circular, counter-clockwise (seen from +z) orbit of a body of `massKg` at `positionM` around `primary`:
 * the primary's own velocity plus the circular speed sqrt(G (M + m) / r), perpendicular to the radius. Undefined when the
 * body sits on the primary (no direction).
 */
export function circularOrbitVelocity(primary: Primary, positionM: Vec3, massKg: number): Vec3 | undefined {
  const r = { x: positionM.x - primary.positionM.x, y: positionM.y - primary.positionM.y, z: positionM.z - primary.positionM.z };
  const dist = Math.hypot(r.x, r.y, r.z);
  if (!(dist > 0)) return undefined;
  // t = z-hat x r, or x-hat x r when r is along z
  let t = { x: -r.y, y: r.x, z: 0 };
  if (Math.hypot(t.x, t.y) < 1e-9 * dist) t = { x: 0, y: -r.z, z: r.y };
  const tl = Math.hypot(t.x, t.y, t.z);
  const speed = Math.sqrt((G_SI * (primary.massKg + massKg)) / dist);
  return {
    x: primary.velocityMPerS.x + (t.x / tl) * speed,
    y: primary.velocityMPerS.y + (t.y / tl) * speed,
    z: primary.velocityMPerS.z + (t.z / tl) * speed,
  };
}
