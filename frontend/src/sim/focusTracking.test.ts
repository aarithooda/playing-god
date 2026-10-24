import { describe, expect, it } from "vitest";
import {
  FOCUS_SCREEN_HEIGHT_FRACTION,
  TARGET_MOVED_EPS,
  focusDistanceForScreenHeight,
  smoothstep,
  stepTracking,
} from "./focusTracking";

describe("focusDistanceForScreenHeight", () => {
  it("frames any radius at the same fraction of the viewport height", () => {
    const fov = 50;
    for (const radius of [0.3, 2, 6]) {
      const d = focusDistanceForScreenHeight(radius, fov);
      const fraction = radius / (Math.sqrt(d * d - radius * radius) * Math.tan((fov * Math.PI) / 360));
      expect(fraction).toBeCloseTo(FOCUS_SCREEN_HEIGHT_FRACTION, 12);
    }
  });

  it("scales linearly with the radius", () => {
    expect(focusDistanceForScreenHeight(4, 50)).toBeCloseTo(2 * focusDistanceForScreenHeight(2, 50), 12);
  });
});

describe("smoothstep", () => {
  it("runs 0 to 1 with zero slope at the ends and clamps outside", () => {
    expect([smoothstep(-1), smoothstep(0), smoothstep(0.5), smoothstep(1), smoothstep(2)]).toEqual([0, 0, 0.5, 1, 1]);
    expect(smoothstep(0.01)).toBeLessThan(0.001);
  });
});

describe("stepTracking", () => {
  const state = { lastBodyPosition: [1, 2, 3] as [number, number, number], expectedTarget: [1, 2, 3] as [number, number, number] };

  it("carries the camera by the body's displacement while the target is where tracking left it", () => {
    expect(stepTracking(state, [1.5, 2, 2], [1, 2, 3])).toEqual({ released: false, delta: [0.5, 0, -1] });
  });

  it("no displacement is a no-op", () => {
    expect(stepTracking(state, [1, 2, 3], [1, 2, 3])).toEqual({ released: false, delta: [0, 0, 0] });
  });

  it("releases (and moves nothing) once the user has panned the target away", () => {
    expect(stepTracking(state, [9, 9, 9], [1 + 10 * TARGET_MOVED_EPS, 2, 3])).toEqual({ released: true, delta: [0, 0, 0] });
  });

  it("ignores float-level jitter below the release threshold", () => {
    expect(stepTracking(state, [1, 2, 3], [1 + TARGET_MOVED_EPS / 10, 2, 3]).released).toBe(false);
  });
});
