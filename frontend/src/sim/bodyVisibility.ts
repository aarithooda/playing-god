// Minimum on-screen size for celestial bodies.
//
// Bodies are real spheres in scene space, so under perspective their projected radius shrinks like
// 1 / distance and drops below a pixel when zoomed far out, at which point the rasteriser drops them.
// To keep every body visible we uniformly enlarge a body (a pure display scale, so it stays a sphere
// and its position, motion and the physics are untouched) only when its projected radius would fall
// below MIN_BODY_SCREEN_RADIUS_PX. Normal-size views are unaffected (scale exactly 1).

/** Smallest projected radius, in CSS pixels, a body is allowed to have on screen. */
export const MIN_BODY_SCREEN_RADIUS_PX = 3;

/** Projected radius in CSS pixels of a sphere of `radius` at `distance` for a vertical fov in degrees. */
export function projectedRadiusPx(radius: number, distance: number, fovDeg: number, viewportHeightPx: number): number {
  const halfFov = (fovDeg * Math.PI) / 360;
  return (radius * (viewportHeightPx / 2)) / (distance * Math.tan(halfFov));
}

/** A planet drawn larger than its stored display size keeps at least this fraction of its moon distance clear. */
export const APPARENT_RADIUS_FRACTION_OF_CLEARANCE = 0.5;

export interface BodyScaleOptions {
  minPx?: number;
  /**
   * Radius (scene units) the body should appear to have from far away. A planet with moons is stored small so its moons
   * are not inside it; from afar it is enlarged towards this size, but never past `clearance`.
   */
  apparentRadius?: number;
  /** Scene distance to the nearest moon/primary: the enlargement stops at a fraction of this distance on screen. */
  clearance?: number;
}

/** Uniform display scale (>= 1) that lifts a body to the minimum on-screen radius (or its apparent size). */
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
  let target = minPx;
  const { apparentRadius, clearance } = options;
  if (apparentRadius !== undefined && apparentRadius > radius) {
    let apparentPx = projectedRadiusPx(apparentRadius, distance, fovDeg, viewportHeightPx);
    if (clearance !== undefined && clearance > 0) {
      apparentPx = Math.min(
        apparentPx,
        APPARENT_RADIUS_FRACTION_OF_CLEARANCE * projectedRadiusPx(clearance, distance, fovDeg, viewportHeightPx),
      );
    }
    target = Math.max(target, apparentPx);
  }
  return px >= target ? 1 : target / px;
}
