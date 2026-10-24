// On-screen size of celestial bodies (display only).
//
// Bodies are true-scale spheres in scene space, so under perspective their projected radius shrinks like
// 1 / distance and drops below a pixel when zoomed far out, at which point the rasteriser drops them. To keep every body
// visible it is uniformly enlarged (a pure display scale: it stays a sphere, and its position, motion and the physics are
// untouched) only when its projected radius would fall below a minimum number of pixels. Normal-size views are
// unaffected (scale exactly 1). The minimum comes from the active view (renderTransform.SIZE_LAWS) and depends only on
// the body itself and the camera, except for the zoom-in growth limit described at `bodyDisplayScale`.

/** Default minimum on-screen radius, in CSS pixels, for callers that give none (test scenes, tools). */
export const MIN_BODY_SCREEN_RADIUS_PX = 3;

/** Camera distance (scene units) of the default overview: the minimum is exactly its base size there. */
export const OVERVIEW_DISTANCE = 70;

/** While zooming, a body's enlargement stops at this fraction of its moon/primary distance on screen. */
export const SYSTEM_GROWTH_FRACTION_OF_CLEARANCE = 0.35;

/** Projected radius in CSS pixels of a sphere of `radius` at `distance` for a vertical fov in degrees. */
export function projectedRadiusPx(radius: number, distance: number, fovDeg: number, viewportHeightPx: number): number {
  const halfFov = (fovDeg * Math.PI) / 360;
  return (radius * (viewportHeightPx / 2)) / (distance * Math.tan(halfFov));
}

/** Factor (>= 1, <= maxGrowth) by which the minimum grows as the camera closes in: sqrt(OVERVIEW_DISTANCE / distance). */
export function zoomGrowth(distance: number, maxGrowth: number): number {
  if (!(maxGrowth > 1) || !(distance > 0) || !Number.isFinite(distance)) return 1;
  return Math.min(maxGrowth, Math.max(1, Math.sqrt(OVERVIEW_DISTANCE / distance)));
}

export interface BodyScaleOptions {
  /** Minimum on-screen radius (px) at the overview. */
  minPx?: number;
  /** Largest factor the minimum may grow by while zooming in (1 or absent: never). */
  maxGrowth?: number;
  /** Scene distance to the nearest moon (planet) or to the primary (moon) of this body's system. */
  clearance?: number;
  /** Largest minimum (px) among the members of the system: the pair shares one growth factor, so their ratio is kept. */
  systemPx?: number;
}

/**
 * Uniform display scale (>= 1) that lifts a body to its minimum on-screen radius.
 *
 * The minimum is `minPx` at the overview and grows with `zoomGrowth` as the camera approaches. For a moon, the growth is
 * limited so the largest member's disc stays within SYSTEM_GROWTH_FRACTION_OF_CLEARANCE of the planet-moon distance on
 * screen. Parent planets keep their own zoom growth and are never shrunk to satisfy a moon's clearance. The limit only
 * restricts GROWTH: it can never take a moon below `minPx`.
 */
export function bodyDisplayScale(
  radius: number,
  distance: number,
  fovDeg: number,
  viewportHeightPx: number,
  minPxOrOptions: number | BodyScaleOptions = MIN_BODY_SCREEN_RADIUS_PX,
): number {
  const options = typeof minPxOrOptions === "number" ? { minPx: minPxOrOptions } : minPxOrOptions;
  const minPx = options.minPx ?? MIN_BODY_SCREEN_RADIUS_PX;
  if (!(radius > 0) || !Number.isFinite(distance) || distance <= 0) return 1;
  if (!(viewportHeightPx > 0) || !(fovDeg > 0 && fovDeg < 180)) return 1;
  const px = projectedRadiusPx(radius, distance, fovDeg, viewportHeightPx);
  let growth = zoomGrowth(distance, options.maxGrowth ?? 1);
  const { clearance, systemPx } = options;
  if (growth > 1 && clearance !== undefined && clearance > 0) {
    const room = SYSTEM_GROWTH_FRACTION_OF_CLEARANCE * projectedRadiusPx(clearance, distance, fovDeg, viewportHeightPx);
    growth = Math.min(growth, Math.max(1, room / Math.max(minPx, systemPx ?? minPx)));
  }
  const target = minPx * growth;
  return px >= target ? 1 : target / px;
}

/** Fixed world-space multiplier calibrated to a target screen radius at one reference distance. */
export function fixedDisplayScaleAtDistance(
  radius: number,
  referenceDistance: number,
  fovDeg: number,
  viewportHeightPx: number,
  targetRadiusPx: number,
): number {
  if (!(targetRadiusPx > 0) || !(radius > 0) || !(referenceDistance > 0)
    || !(viewportHeightPx > 0) || !(fovDeg > 0 && fovDeg < 180)) return 1;
  return targetRadiusPx / projectedRadiusPx(radius, referenceDistance, fovDeg, viewportHeightPx);
}
