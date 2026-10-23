// Render transform: physical SI values -> Three.js scene coordinates.
//
// This is a DISPLAY choice only. The backend's SI state is never altered, and values shown in the
// inspector or sent to the API are always metres / m/s / kg, never scene units.
//
// Positions: sceneUnits = metres / metersPerUnit (one uniform scale, so geometry and distance
//   ratios are preserved). metersPerUnit is chosen by fitTransform() when the layout changes
//   (load, create, delete, reset, "Fit view") and then held fixed, so bodies do not jitter.
// Axes: the physics frame is right-handed Cartesian (x, y, z). Three.js is right-handed Y-up.
//   scene = (x, z, -y), a proper rotation (-90 deg about x): the physics x-y plane (where orbits
//   usually lie) becomes the horizontal ground plane and physics +z points up.
// Radii: planetary radii are ~1e-4 of orbital distances and would be invisible at true scale, so
//   radii use a separate logarithmic display size (displayRadiusUnits), independent of
//   metersPerUnit. It is a visual exaggeration, not a physical radius; the inspector shows the
//   true radiusM.
import type { Vec3 } from "../api/types";

export type ScenePosition = [number, number, number];

export interface RenderTransform {
  metersPerUnit: number;
}

/** Fitted scene half-extent, in scene units, of the farthest body coordinate. */
export const FIT_EXTENT_UNITS = 40;
/** Used when there is nothing to fit (about 1 AU ~ 30 units). */
export const DEFAULT_METERS_PER_UNIT = 5e9;
/** Extents below this (e.g. a lone body drifting a few km from the origin) are not worth fitting to. */
export const MIN_FIT_EXTENT_M = 1e7;
export const MIN_DISPLAY_RADIUS = 0.3;
export const MAX_DISPLAY_RADIUS = 6;

export function toScenePosition(p: Vec3, t: RenderTransform): ScenePosition {
  const s = 1 / t.metersPerUnit;
  return [p.x * s, p.z * s, -p.y * s];
}

/** Inverse of toScenePosition (used for tests and camera focus bookkeeping). */
export function toPhysicsPosition(s: ScenePosition, t: RenderTransform): Vec3 {
  return { x: s[0] * t.metersPerUnit, y: -s[2] * t.metersPerUnit, z: s[1] * t.metersPerUnit };
}

/** Logarithmic display radius: 1 km -> 0.3, ~6.4e6 m (Earth) -> ~2.1, ~7e8 m (Sun) -> ~3.4 (clamped 0.3..6). */
export function displayRadiusUnits(radiusM: number): number {
  const r = 0.3 + 0.45 * (Math.log10(Math.max(radiusM, 1)) - 3);
  return Math.min(MAX_DISPLAY_RADIUS, Math.max(MIN_DISPLAY_RADIUS, r));
}

/** Rounds up to 1, 2 or 5 times a power of ten so the scale is stable and readable. */
function niceCeil(x: number): number {
  const exp = Math.floor(Math.log10(x));
  const m = x / 10 ** exp;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

export function fitTransform(positions: Vec3[]): RenderTransform {
  let extent = 0;
  for (const p of positions) extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
  if (!(extent > MIN_FIT_EXTENT_M)) return { metersPerUnit: DEFAULT_METERS_PER_UNIT };
  return { metersPerUnit: niceCeil(extent / FIT_EXTENT_UNITS) };
}

/** Camera placement matching a fitted scene (extent ~FIT_EXTENT_UNITS), kept in one place. */
export const DEFAULT_CAMERA_POSITION: ScenePosition = [0, 0.9 * FIT_EXTENT_UNITS, 1.8 * FIT_EXTENT_UNITS];
