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

/** Camera distance (scene units) of the default overview: the visibility floor is exactly its base size there. */
export const OVERVIEW_DISTANCE = 80;
/** Largest enlargement of the visibility floor when zooming in. */
export const MAX_ZOOM_BOOST = 8;

/**
 * Factor on the visibility floor (>= 1): it grows like sqrt(OVERVIEW_DISTANCE / distance) as the camera closes in, so a
 * body that is still sub-pixel at true scale (Earth beside its Moon) stays recognisable in a close view instead of
 * shrinking to one pixel. The same factor applies to every body at a given camera distance, so order and the relation to
 * other bodies are untouched; true size takes over as soon as it exceeds the floor.
 */
export function zoomBoost(distance: number): number {
  if (!(distance > 0) || !Number.isFinite(distance)) return 1;
  return Math.min(MAX_ZOOM_BOOST, Math.max(1, Math.sqrt(OVERVIEW_DISTANCE / distance)));
}

/** A body whose moon/primary is closer than this on screen is still drawn this large. */
export const MIN_CROWDED_BODY_PX = 1;

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
  if (clearance !== undefined && clearance > 0) {
    // Never enlarge a body past half the distance to its moon/primary, but keep it at least this visible.
    const cap = APPARENT_RADIUS_FRACTION_OF_CLEARANCE * projectedRadiusPx(clearance, distance, fovDeg, viewportHeightPx);
    target = Math.min(target, Math.max(MIN_CROWDED_BODY_PX, cap));
  }
  return px >= target ? 1 : target / px;
}
