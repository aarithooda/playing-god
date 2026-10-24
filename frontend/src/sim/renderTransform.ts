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

// ---- Body size modes -------------------------------------------------------------------------------------------
// Two explicit, documented ways to size a body. Each depends only on the body itself, the display scale and the camera,
// never on which other bodies exist.
//
//  "physical" (default): the sphere is the TRUE radius in scene units (radiusM / metersPerUnit), so the Sun is ~109x Earth
//     and Earth ~3.7x the Moon, whatever else is loaded. At the overview scale that is far below a pixel, so the renderer
//     enlarges a body on screen only as far as `visibleRadiusPx` (a floor that depends on the body's own radius, grows
//     with it and is the same function for every body), and never beyond half the distance to its moon/primary.
//     Zooming in therefore reveals true proportions; the floor never makes a smaller body bigger than a larger one.
//  "exaggerated": the earlier logarithmic display radius (displayRadiusUnits) plus the crowding shrink
//     (radiusSeparation.ts). Every body is of similar size; the ratios are NOT physical.
export type SizeMode = "physical" | "exaggerated";
export const DEFAULT_SIZE_MODE: SizeMode = "physical";

/** IAU 2015 B3 nominal solar radius, the reference of the visibility floor (same value as the Solar System preset). */
export const SUN_RADIUS_M = 6.957e8;
/** On-screen radius, in CSS pixels, of a Sun-sized body at the overview (the floor's reference size). */
export const VISIBLE_SUN_RADIUS_PX = 8;
/** The floor grows with the square root of the physical radius (a Sun/Earth ratio of ~5 on screen instead of ~109). */
export const VISIBLE_RADIUS_EXPONENT = 0.35;
export const MIN_VISIBLE_RADIUS_PX = 1;
export const MAX_VISIBLE_RADIUS_PX = 24;

/** Scene radius of a body at true scale. */
export function physicalRadiusUnits(radiusM: number, t: RenderTransform): number {
  return radiusM / t.metersPerUnit;
}

/** Smallest on-screen radius (CSS px) a body is drawn with so it stays visible: a function of its own radius only. */
export function visibleRadiusPx(radiusM: number): number {
  if (!(radiusM > 0) || !Number.isFinite(radiusM)) return MIN_VISIBLE_RADIUS_PX;
  const px = VISIBLE_SUN_RADIUS_PX * (radiusM / SUN_RADIUS_M) ** VISIBLE_RADIUS_EXPONENT;
  return Math.min(MAX_VISIBLE_RADIUS_PX, Math.max(MIN_VISIBLE_RADIUS_PX, px));
}
