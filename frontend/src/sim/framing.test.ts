import { describe, expect, it } from "vitest";
import { FRAMING_MARGIN, framingDistanceScale, nearPlaneFor } from "./framing";
import { FIT_EXTENT_UNITS } from "./renderTransform";

const base = { fovDeg: 50, leftInset: 40, rightInset: 320 };

describe("framingDistanceScale", () => {
  it("is exactly 1 when the free area has room, and at most a small pull-back on common laptop/desktop windows", () => {
    expect(framingDistanceScale({ ...base, width: 1920, height: 1080 })).toBe(1); // Controls open on a 1080p window
    expect(framingDistanceScale({ ...base, width: 1280, height: 720 })).toBeLessThan(1.02);
    expect(framingDistanceScale({ ...base, width: 1440, height: 900 })).toBeLessThan(1.1);
    // both sidebars open on a 1080p window is tighter than the margin: a small pull-back, not a jump
    const both = framingDistanceScale({ ...base, width: 1920, height: 1080, leftInset: 320 });
    expect(both).toBeGreaterThanOrEqual(1);
    expect(both).toBeLessThan(1.1);
  });

  it("pulls the camera back on a narrow, nearly square window so the fitted extent stays in the free area", () => {
    const s = framingDistanceScale({ ...base, width: 771, height: 762 });
    expect(s).toBeGreaterThan(1.5);
    // after scaling, the visible half-width of the free area covers the fitted extent plus the margin
    const halfHeight = Math.tan((50 * Math.PI) / 360) * Math.hypot(0, 36, 72) * s;
    const halfWidthFree = halfHeight * (771 / 762) * ((771 - 360) / 771);
    expect(halfWidthFree).toBeGreaterThanOrEqual(FIT_EXTENT_UNITS * FRAMING_MARGIN - 1e-9);
  });

  it("never zooms in, and a wider free area never needs more distance than a narrower one", () => {
    const narrow = framingDistanceScale({ ...base, width: 700, height: 700 });
    const wide = framingDistanceScale({ ...base, width: 700, height: 700, leftInset: 40, rightInset: 40 });
    expect(wide).toBeGreaterThanOrEqual(1);
    expect(narrow).toBeGreaterThan(wide);
  });

  it("opening a sidebar can only increase the scale", () => {
    const one = framingDistanceScale({ fovDeg: 50, width: 900, height: 700, leftInset: 40, rightInset: 320 });
    const two = framingDistanceScale({ fovDeg: 50, width: 900, height: 700, leftInset: 320, rightInset: 320 });
    expect(two).toBeGreaterThanOrEqual(one);
  });

  it("falls back to 1 for degenerate input instead of producing NaN or Infinity", () => {
    expect(framingDistanceScale({ ...base, width: 0, height: 0 })).toBe(1);
    expect(framingDistanceScale({ ...base, width: 500, height: 500, leftInset: 300, rightInset: 300 })).toBe(1);
    expect(framingDistanceScale({ ...base, fovDeg: 0, width: 800, height: 600 })).toBe(1);
  });
});

describe("nearPlaneFor", () => {
  it("keeps the default for normal-size bodies", () => {
    expect(nearPlaneFor(2)).toBe(0.1);
    expect(nearPlaneFor(0.3)).toBeCloseTo(0.075);
  });
  it("pulls the near plane inside a very small focused body, within bounds", () => {
    expect(nearPlaneFor(0.004)).toBeCloseTo(0.001);
    expect(nearPlaneFor(1e-9)).toBe(1e-5);
  });
  it("falls back to the default for empty or invalid input", () => {
    for (const v of [0, -1, NaN, Infinity]) expect(nearPlaneFor(v)).toBe(0.1);
  });
});
