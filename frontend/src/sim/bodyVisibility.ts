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

/** Uniform display scale (>= 1) that lifts a body to the minimum on-screen radius. */
export function bodyDisplayScale(
  radius: number,
  distance: number,
  fovDeg: number,
  viewportHeightPx: number,
  minPx: number = MIN_BODY_SCREEN_RADIUS_PX,
): number {
  if (!(radius > 0) || !Number.isFinite(distance) || distance <= 0) return 1;
  if (!(viewportHeightPx > 0) || !(fovDeg > 0 && fovDeg < 180)) return 1;
  const px = projectedRadiusPx(radius, distance, fovDeg, viewportHeightPx);
  return px >= minPx ? 1 : minPx / px;
}
