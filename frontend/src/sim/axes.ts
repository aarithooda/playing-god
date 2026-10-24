// Axis geometry for the optional overlay (display only).
//
// Every endpoint is produced by toScenePosition from a physics-frame vector, so the axes cannot disagree with
// where bodies are drawn: physics +x -> scene +X, physics +y -> scene -Z, physics +z (up) -> scene +Y (D-010 frame,
// see renderTransform.ts). The physics x-y plane is the horizontal ground plane the grid lies in.
import type { Vec3 } from "../api/types";
import { FIT_EXTENT_UNITS, toScenePosition, type RenderTransform, type ScenePosition } from "./renderTransform";

export type AxisName = "x" | "y" | "z";

export const AXIS_COLORS: Record<AxisName, string> = { x: "#e0605a", y: "#5ac26b", z: "#5a8fe0" };

export interface AxisSegment {
  axis: AxisName;
  color: string;
  /** Scene-space ends of the line through the origin. */
  from: ScenePosition;
  to: ScenePosition;
  /** Where the axis label sits (the +end). */
  labelAt: ScenePosition;
}

const UNIT: Record<AxisName, Vec3> = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };

/** Half-length of each axis in scene units: the fitted scene extent, so the axes span the usual view. */
export const AXIS_HALF_LENGTH_UNITS = FIT_EXTENT_UNITS;

export function axisHalfLengthMeters(t: RenderTransform): number {
  return AXIS_HALF_LENGTH_UNITS * t.metersPerUnit;
}

export function axisSegments(t: RenderTransform): AxisSegment[] {
  const half = axisHalfLengthMeters(t);
  return (Object.keys(UNIT) as AxisName[]).map((axis) => {
    const u = UNIT[axis];
    const at = (k: number): Vec3 => ({ x: u.x * k * half, y: u.y * k * half, z: u.z * k * half });
    return {
      axis,
      color: AXIS_COLORS[axis],
      from: toScenePosition(at(-1), t),
      to: toScenePosition(at(1), t),
      labelAt: toScenePosition(at(1.04), t),
    };
  });
}
