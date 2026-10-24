// Default-view framing that respects the sidebars (display only).
//
// DEFAULT_CAMERA_POSITION frames a fitted scene (extent FIT_EXTENT_UNITS) as if the whole canvas were free.
// With sidebars covering part of it, a narrow window leaves only a slice of the canvas visible, and bodies at the
// fitted extent can end up underneath a panel. This scales the default camera distance up, never down, just
// enough that the fitted extent fits the visible horizontal slice. On a normal laptop or desktop window the
// scale is 1 and the default view is unchanged.
import { DEFAULT_CAMERA_POSITION, FIT_EXTENT_UNITS } from "./renderTransform";

/** Room kept beyond the fitted extent: perspective makes nearer bodies spread wider than their x suggests. */
export const FRAMING_MARGIN = 1.2;

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
