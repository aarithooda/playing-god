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

// ---- Rendering views: Universe and Exploration ------------------------------------------------------------------
// Two deliberate ways to DRAW the same simulation. Neither changes a radius, mass, position, force or time; both use the
// TRUE radius for the geometry (radiusM / metersPerUnit) and differ only in how large a body is guaranteed to look on
// screen. Each size depends on the body itself, the display scale and the camera - never on which other bodies exist
// (Exploration only limits how far a body GROWS while the camera zooms in, so a planet cannot swallow its moons).
//
//  "universe"    (Universe View, default): the scale of the real Solar System. Bodies are true-scale spheres; where that is
//     below a pixel (everything but the Sun at the overview) a body is drawn with a small fixed minimum of
//     `universeRadiusPx(radiusM)`: 8 px for the Sun, ~1.6 px for Earth, 1 px for the smallest. The minimum depends only
//     on the body's own radius, so the Sun dominates and Earth stays a visible dot. This is a visibility treatment, not
//     a physical size: below the minimum the picture is not to scale.
//  "exploration" (Exploration View): planets are enlarged to be easy to see and select (`explorationRadiusPx`: 12 px for
//     the Sun, ~3.7 px for Earth, ~2.7 px for the Moon), grow up to 8x more as the camera closes in on a system (so Earth
//     and Moon separate and read as spheres), and that growth is limited to 35 % of the planet-moon distance on screen
//     so moons stay distinguishable. The limit never reduces a body below its overview size.
export type SizeMode = "universe" | "exploration";
export const DEFAULT_SIZE_MODE: SizeMode = "universe";

/** IAU 2015 B3 nominal solar radius, the reference of both minimum-size laws (same value as the Solar System preset). */
export const SUN_RADIUS_M = 6.957e8;

export interface SizeLaw {
  /** On-screen radius (CSS px) of a Sun-sized body. */
  sunPx: number;
  exponent: number;
  minPx: number;
  maxPx: number;
  /** Largest factor the minimum may grow by as the camera approaches (1 = never). */
  maxZoomGrowth: number;
}

export const SIZE_LAWS: Record<SizeMode, SizeLaw> = {
  universe: { sunPx: 8, exponent: 0.35, minPx: 1, maxPx: 24, maxZoomGrowth: 1 },
  exploration: { sunPx: 12, exponent: 0.25, minPx: 2.5, maxPx: 30, maxZoomGrowth: 8 },
};

/** Scene radius of a body at true scale: the only geometry either view uses. */
export function physicalRadiusUnits(radiusM: number, t: RenderTransform): number {
  return radiusM / t.metersPerUnit;
}

/** Minimum on-screen radius (CSS px, at the overview) of a body in a view: a function of its own radius only. */
export function minimumRadiusPx(radiusM: number, mode: SizeMode): number {
  const law = SIZE_LAWS[mode];
  if (!(radiusM > 0) || !Number.isFinite(radiusM)) return law.minPx;
  return Math.min(law.maxPx, Math.max(law.minPx, law.sunPx * (radiusM / SUN_RADIUS_M) ** law.exponent));
}
