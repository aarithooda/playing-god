// Pure maths for camera focus (no Three.js types, so it is unit-testable).
//
// Focusing eases the orbit target onto a body and frames it at a fixed fraction of the viewport height.
// While the body is then "tracked", the camera and orbit target are carried along with the body's
// displayed position, so orbiting and zooming stay centred on it as the simulation runs. Tracking ends
// as soon as the user pans the target away, or the body disappears. Display only: no physics here.
import type { ScenePosition } from "./renderTransform";

/** A focused body's silhouette fills this fraction of the viewport height. */
export const FOCUS_SCREEN_HEIGHT_FRACTION = 0.25;
export const FOCUS_ANIMATION_S = 0.65;
/** Scene units: the orbit target moving more than this from where tracking left it means the user panned. */
export const TARGET_MOVED_EPS = 1e-4;

/**
 * Camera-to-body distance at which a sphere of `radius` (scene units) has a silhouette of
 * FOCUS_SCREEN_HEIGHT_FRACTION of the viewport height: r / (sqrt(d² - r²) tan(fov/2)) = fraction.
 * Independent of the displayed size, so every focused body appears the same size.
 */
export function focusDistanceForScreenHeight(radius: number, fovDeg: number): number {
  const halfFov = (fovDeg * Math.PI) / 360;
  const scaled = FOCUS_SCREEN_HEIGHT_FRACTION * Math.tan(halfFov);
  return radius * Math.sqrt(1 + 1 / (scaled * scaled));
}

/** Ease-in-out from 0 to 1 (clamped). */
export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export interface TrackingState {
  /** Body position the camera was last carried to. */
  lastBodyPosition: ScenePosition;
  /** Orbit target as tracking last left it. */
  expectedTarget: ScenePosition;
}

/**
 * One tracking step. `released` when the target is no longer where tracking left it (the user panned);
 * otherwise `delta` is how far the body moved since the last step, to be added to both camera and target.
 */
export function stepTracking(
  state: TrackingState,
  bodyPosition: ScenePosition,
  target: ScenePosition,
): { released: boolean; delta: ScenePosition } {
  const drift = Math.hypot(
    target[0] - state.expectedTarget[0],
    target[1] - state.expectedTarget[1],
    target[2] - state.expectedTarget[2],
  );
  if (drift > TARGET_MOVED_EPS) return { released: true, delta: [0, 0, 0] };
  return {
    released: false,
    delta: [
      bodyPosition[0] - state.lastBodyPosition[0],
      bodyPosition[1] - state.lastBodyPosition[1],
      bodyPosition[2] - state.lastBodyPosition[2],
    ],
  };
}
