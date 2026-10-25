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

/** Closer default framing: the outer preset bodies fill more of the viewport while remaining inside the fitted extent. */
export const DEFAULT_CAMERA_POSITION: ScenePosition = [0, 0.78 * FIT_EXTENT_UNITS, 1.56 * FIT_EXTENT_UNITS];

/**
 * Solar System overview (D-064): elevation above the ecliptic, azimuth about the scene's up axis (0 = looking from
 * physics -y), and distance from the origin in au, so the framing does not depend on how the fitted scale rounds.
 */
export const SOLAR_SYSTEM_VIEW = { elevationDeg: 52, azimuthDeg: 0, distanceAu: 105, keepInViewAu: 40, maxPullBack: 2.5 };
const AU_M = 149_597_870_700;

/**
 * Overhead but tilted: high enough that the planetary orbits read as near-circles around the Sun, low enough that the
 * inclined outer orbits visibly leave the ecliptic. Display only; the user's own rotate/zoom/pan are unchanged.
 */
export function solarSystemCameraPosition(t: RenderTransform): ScenePosition {
  const el = (SOLAR_SYSTEM_VIEW.elevationDeg * Math.PI) / 180;
  const az = (SOLAR_SYSTEM_VIEW.azimuthDeg * Math.PI) / 180;
  const d = (SOLAR_SYSTEM_VIEW.distanceAu * AU_M) / t.metersPerUnit;
  return [d * Math.cos(el) * Math.sin(az), d * Math.sin(el), d * Math.cos(el) * Math.cos(az)];
}

/** Narrow windows pull back only until this many au fit the free area, and never more than `maxPullBack` times. */
export function solarSystemFraming(t: RenderTransform): { extentUnits: number; maxScale: number } {
  return { extentUnits: (SOLAR_SYSTEM_VIEW.keepInViewAu * AU_M) / t.metersPerUnit, maxScale: SOLAR_SYSTEM_VIEW.maxPullBack };
}

// ---- Rendering views: Universe and Exploration ------------------------------------------------------------------
// Two deliberate ways to DRAW the same simulation. Neither changes a radius, mass, position, force or time; both use the
// TRUE radius for the geometry (radiusM / metersPerUnit) and differ only in how large a body is guaranteed to look on
// screen. Minimum sizes depend on the body's radius and view; exploration limits moon zoom growth by orbital clearance,
// while parent planets keep their own size law.
//
//  "universe"    (Universe View): stars render at 3.9 px radius; non-star bodies have a 3.6 px overview cap.
//  "exploration" (Exploration View, default): the same compact star/body envelope keeps the Sun from covering the inner
//     planets. The body-size curve still uses its own radius reference (23.5 px for the nominal Sun), so Earth remains
//     larger than Mercury and Jupiter remains larger than Earth before the display cap. The Sun uses a fixed world-space
//     visibility boost and follows camera zoom; moons grow up to 8x, limited by their moon-orbit clearance, while
//     planets follow their own size law without a moon-dependent cap.
export type SizeMode = "universe" | "exploration";
export const DEFAULT_SIZE_MODE: SizeMode = "exploration";

/** IAU 2015 B3 nominal solar radius, the reference of both minimum-size laws (same value as the Solar System preset). */
export const SUN_RADIUS_M = 6.957e8;

export interface SizeLaw {
  /** Reference radius (CSS px) used to map physical radii to the non-star size curve. */
  sunPx: number;
  /** On-screen radius (CSS px) for actual stars at the overview. */
  starPx: number;
  /** Maximum overview radius (CSS px) for non-star bodies in the rendered scene. */
  maxBodyPx: number;
  exponent: number;
  minPx: number;
  maxPx: number;
  /** Largest factor the minimum may grow by as the camera approaches (1 = never). */
  maxZoomGrowth: number;
}

export const SIZE_LAWS: Record<SizeMode, SizeLaw> = {
  universe: { sunPx: 18, starPx: 3.9, maxBodyPx: 3.6, exponent: 0.35, minPx: 2.5, maxPx: 30, maxZoomGrowth: 1 },
  exploration: { sunPx: 23.5, starPx: 3.9, maxBodyPx: 3.6, exponent: 0.4, minPx: 2.5, maxPx: 36, maxZoomGrowth: 8 },
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
