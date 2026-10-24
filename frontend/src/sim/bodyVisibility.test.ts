import { describe, expect, it } from "vitest";
import { bodyDisplayScale, MIN_BODY_SCREEN_RADIUS_PX, projectedRadiusPx } from "./bodyVisibility";

const FOV = 50;
const H = 800;

describe("body display scale", () => {
  it("leaves bodies at their true size while they are large enough on screen", () => {
    expect(bodyDisplayScale(2, 80, FOV, H)).toBe(1);
    expect(bodyDisplayScale(0.3, 20, FOV, H)).toBe(1);
  });

  it("is continuous at the threshold", () => {
    const r = 2;
    // distance at which the projected radius is exactly the minimum
    const d = (r * (H / 2)) / (MIN_BODY_SCREEN_RADIUS_PX * Math.tan((FOV * Math.PI) / 360));
    expect(bodyDisplayScale(r, d * 0.999, FOV, H)).toBe(1);
    expect(bodyDisplayScale(r, d * 1.001, FOV, H)).toBeCloseTo(1.001, 3);
  });

  it("holds the projected radius at the minimum at any distance beyond it", () => {
    for (const d of [1e3, 1e5, 1e9, 1e14]) {
      const px = projectedRadiusPx(2 * bodyDisplayScale(2, d, FOV, H), d, FOV, H);
      expect(px).toBeCloseTo(MIN_BODY_SCREEN_RADIUS_PX, 6);
    }
  });

  it("preserves relative size between bodies of different radius that are not clamped", () => {
    expect(bodyDisplayScale(1, 100, FOV, H)).toBe(1);
    expect(bodyDisplayScale(6, 100, FOV, H)).toBe(1);
  });

  it("only ever enlarges, and never decreases as the camera moves out", () => {
    let prev = 0;
    for (let d = 1; d < 1e9; d *= 1.2) {
      const s = bodyDisplayScale(0.5, d, FOV, H);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("keeps a very small body visible while preserving a larger body's size", () => {
    const smallRadius = 0.3;
    const largeRadius = 6;
    const distance = 1_000;
    const smallScale = bodyDisplayScale(smallRadius, distance, FOV, H);
    const largeScale = bodyDisplayScale(largeRadius, distance, FOV, H);
    const smallPixels = projectedRadiusPx(smallRadius * smallScale, distance, FOV, H);
    const largePixels = projectedRadiusPx(largeRadius * largeScale, distance, FOV, H);

    expect(smallScale).toBeGreaterThan(1);
    expect(smallPixels).toBeCloseTo(MIN_BODY_SCREEN_RADIUS_PX, 6);
    expect(largeScale).toBe(1);
    expect(largePixels).toBeGreaterThan(smallPixels);
  });

  it("falls back to scale 1 for degenerate input", () => {
    for (const [r, d, fov, h] of [[0, 10, FOV, H], [1, 0, FOV, H], [1, NaN, FOV, H], [1, Infinity, FOV, H], [1, 10, 0, H], [1, 10, FOV, 0]]) {
      expect(bodyDisplayScale(r, d, fov, h)).toBe(1);
    }
  });
});
