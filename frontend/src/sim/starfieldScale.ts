// Starfield zoom stability: pure math for keeping the background sphere a stable size on screen.
//
// The starfield is a spherical shell of stars centred on the scene origin. In world space it has a
// fixed radius, so once the camera leaves the shell it recedes and its angular size keeps shrinking.
// Scaling the shell uniformly by d / REFERENCE_DISTANCE beyond a reference camera distance keeps the
// whole configuration geometrically similar to the view from the reference distance, so its apparent
// size, star distribution and depth are constant, while closer than that nothing changes at all.
// The scale is continuous at the threshold (exactly 1 there), so there is no visible jump.
//
// drei's star shader places stars with vec4(position, 0.5): the camera translation is halved, so the
// stars are seen from an effective camera at d / 2, and every clip plane acts at half its nominal
// distance (near / 2, far / 2). The similarity argument still holds (both the shell and the halved
// translation scale with d), and 700 is roughly where that effective camera leaves the shell
// (d / 2 ~ the shell's 330..360 radii). The far plane below must account for the halving.

/** Outer radius of the star shell in scene units (Stars radius + depth). */
export const STARFIELD_OUTER_RADIUS = 360;
/** Camera distance from the origin beyond which the shell grows to hold its apparent size. */
export const STARFIELD_REFERENCE_DISTANCE = 700;
/** Homogeneous w that drei's star vertex shader uses for the star position. */
export const STAR_SHADER_W = 0.5;
/** Smallest far plane the camera ever uses (the original fixed value). */
export const BASE_CAMERA_FAR = 2000;
/** Largest distance the starfield maths follows; keeps scale and far plane finite for any input. */
export const MAX_STARFIELD_DISTANCE = 1e15;

function usableDistance(cameraDistance: number): number {
  if (!Number.isFinite(cameraDistance) || cameraDistance < 0) return 0;
  return Math.min(cameraDistance, MAX_STARFIELD_DISTANCE);
}

/** Uniform scale for the starfield at a camera distance from the shell centre. >= 1. */
export function starfieldScale(cameraDistance: number): number {
  return Math.max(1, usableDistance(cameraDistance) / STARFIELD_REFERENCE_DISTANCE);
}

/**
 * Far plane that keeps the whole (scaled) shell inside the frustum. The farthest star is at view
 * depth w * d + R * s, and the shader's w = 0.5 halves the effective far plane, hence the division by
 * w. Rounded up to a power of two so the projection matrix is only rebuilt a handful of times while
 * zooming, not on every frame.
 */
export function requiredCameraFar(cameraDistance: number): number {
  const d = usableDistance(cameraDistance);
  const needed = (d + (STARFIELD_OUTER_RADIUS * starfieldScale(d)) / STAR_SHADER_W) * 1.05;
  if (needed <= BASE_CAMERA_FAR) return BASE_CAMERA_FAR;
  return 2 ** Math.ceil(Math.log2(needed));
}

export interface StarfieldSyncTargets {
  group: { scale: { x: number; setScalar(s: number): unknown } };
  camera: { position: { length(): number }; far: number; updateProjectionMatrix(): void };
  /** Shader uniform that compensates star point size for the group scale. */
  sizeScale: { value: number };
}

/**
 * Per-frame update: sizes the starfield group, its point-size compensation and the camera far plane
 * for the current camera distance. Writes only what changed (the projection matrix is rebuilt only
 * when the far plane actually changes).
 */
export function syncStarfieldToCamera({ group, camera, sizeScale }: StarfieldSyncTargets): void {
  const distance = camera.position.length();
  const scale = starfieldScale(distance);
  if (group.scale.x !== scale) {
    group.scale.setScalar(scale);
    sizeScale.value = scale;
  }
  const far = requiredCameraFar(distance);
  if (camera.far !== far) {
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}
