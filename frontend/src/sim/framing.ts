// Default-view framing that respects the sidebars (display only).
//
// DEFAULT_CAMERA_POSITION frames a fitted scene (extent FIT_EXTENT_UNITS) as if the whole canvas were free.
// With sidebars covering part of it, a narrow window leaves only a slice of the canvas visible, and bodies at the
// fitted extent can end up underneath a panel. This scales the default camera distance up, never down, just
// enough that the fitted extent fits the visible horizontal slice. The closer default camera leaves more room
// around outer preset bodies on ordinary screens; narrow windows pull back only as much as their free area needs.
import { DEFAULT_CAMERA_POSITION, FIT_EXTENT_UNITS } from "./renderTransform";

/** Room kept beyond the fitted extent: perspective makes nearer bodies spread wider than their x suggests. */
export const FRAMING_MARGIN = 1.05;

const DEFAULT_DISTANCE = Math.hypot(...DEFAULT_CAMERA_POSITION);

export interface FramingInput {
  fovDeg: number;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  /** Pixels of the canvas covered by the sidebars. */
  leftInset: number;
  rightInset: number;
}

/** Factor (>= 1) to multiply the default camera offset by. */
export function framingDistanceScale({ fovDeg, width, height, leftInset, rightInset }: FramingInput): number {
  if (!(width > 0) || !(height > 0) || !(fovDeg > 0 && fovDeg < 180)) return 1;
  const freeFraction = Math.min(1, Math.max(0, (width - leftInset - rightInset) / width));
  if (freeFraction === 0) return 1;
  const halfHeight = Math.tan((fovDeg * Math.PI) / 360) * DEFAULT_DISTANCE;
  const halfWidthFree = halfHeight * (width / height) * freeFraction;
  return Math.max(1, (FIT_EXTENT_UNITS * FRAMING_MARGIN) / halfWidthFree);
}

/** Default camera near plane, in scene units. */
export const DEFAULT_NEAR = 0.1;
/** Never closer than this: keeps depth precision usable against the far plane. */
export const MIN_NEAR = 1e-5;
/** The near plane is this fraction of the smallest displayed radius, so a focused body is never clipped. */
export const NEAR_FRACTION_OF_MIN_RADIUS = 0.25;

/** The near plane is at most this fraction of the distance to the nearest body centre, so that body is never clipped. */
export const NEAR_FRACTION_OF_NEAREST_DISTANCE = 0.1;

/**
 * Near-plane distance from how close the camera is to the closest body centre. Tiny display radii (a planet with moons)
 * would otherwise pull the near plane to ~1e-4 even for a far camera, which wrecks depth precision for the whole scene
 * and makes a moon flicker against its planet. Display only.
 */
export function nearPlaneForDistance(nearestBodyDistance: number): number {
  if (!(nearestBodyDistance > 0) || !Number.isFinite(nearestBodyDistance)) return DEFAULT_NEAR;
  return Math.min(DEFAULT_NEAR, Math.max(MIN_NEAR, nearestBodyDistance * NEAR_FRACTION_OF_NEAREST_DISTANCE));
}

/**
 * Near-plane distance for the current scene. Displayed radii can be very small when a close pair of bodies forces the
 * radii down (sim/radiusSeparation.ts); focusing such a body puts the camera closer than the default near plane, which
 * would clip the whole body away. Display only.
 */
export function nearPlaneFor(minDisplayRadius: number): number {
  if (!(minDisplayRadius > 0) || !Number.isFinite(minDisplayRadius)) return DEFAULT_NEAR;
  return Math.min(DEFAULT_NEAR, Math.max(MIN_NEAR, minDisplayRadius * NEAR_FRACTION_OF_MIN_RADIUS));
}
