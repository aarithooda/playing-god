// Pure geometry for the 3D placement preview (no Three.js types, so it is unit-testable).
//
// While placing a body, the cursor ray is intersected with a plane that faces the camera and passes
// through the orbit target pushed along the view direction by `depth`. Scrolling changes `depth`.
// This only chooses where the new body will be created; the backend still owns all physics.

export type Vec3Tuple = [number, number, number];

/** Scene-units of depth change per wheel delta unit. */
export const PLACEMENT_WHEEL_SENSITIVITY = 0.013;

const dot = (a: Vec3Tuple, b: Vec3Tuple) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Point where the ray meets the plane, or null if parallel or behind the ray origin. */
export function rayPlaneIntersection(
  origin: Vec3Tuple,
  direction: Vec3Tuple,
  planeNormal: Vec3Tuple,
  planePoint: Vec3Tuple,
): Vec3Tuple | null {
  const denom = dot(direction, planeNormal);
  if (Math.abs(denom) < 1e-9) return null;
  const toPlane: Vec3Tuple = [planePoint[0] - origin[0], planePoint[1] - origin[1], planePoint[2] - origin[2]];
  const t = dot(toPlane, planeNormal) / denom;
  if (!(t > 0)) return null;
  return [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t];
}

/** New placement depth after a wheel event: at most 0.8x the target distance toward the camera, 10x away. */
export function clampPlacementDepth(depth: number, wheelDeltaY: number, targetDistance: number): number {
  const next = depth + wheelDeltaY * PLACEMENT_WHEEL_SENSITIVITY;
  return Math.max(-targetDistance * 0.8, Math.min(targetDistance * 10, next));
}
