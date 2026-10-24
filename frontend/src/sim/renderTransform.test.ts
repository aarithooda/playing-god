import { describe, expect, it } from "vitest";
import {
  DEFAULT_METERS_PER_UNIT,
  displayRadiusUnits,
  fitTransform,
  FIT_EXTENT_UNITS,
  toPhysicsPosition,
  toScenePosition,
} from "./renderTransform";

describe("render transform", () => {
  it("maps physics (x,y,z) to scene (x, z, -y) and divides by metersPerUnit", () => {
    expect(toScenePosition({ x: 1e11, y: 2e11, z: 3e11 }, { metersPerUnit: 1e10 })).toEqual([10, 30, -20]);
  });

  it("is invertible and preserves handedness", () => {
    const t = { metersPerUnit: 5e9 };
    const p = { x: 1.496e11, y: -2e10, z: 7e9 };
    const back = toPhysicsPosition(toScenePosition(p, t), t);
    expect(back.x).toBeCloseTo(p.x, 0);
    expect(back.y).toBeCloseTo(p.y, 0);
    expect(back.z).toBeCloseTo(p.z, 0);
    // x cross y = z in physics must still hold for the mapped basis vectors.
    const one = { metersPerUnit: 1 };
    const ex = toScenePosition({ x: 1, y: 0, z: 0 }, one);
    const ey = toScenePosition({ x: 0, y: 1, z: 0 }, one);
    const ez = toScenePosition({ x: 0, y: 0, z: 1 }, one);
    const cross = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
    expect(cross.map((v) => v + 0)).toEqual(ez.map((v) => v + 0));
  });

  it("fits the farthest coordinate to at most FIT_EXTENT_UNITS with a stable 1/2/5 scale", () => {
    const t = fitTransform([{ x: 0, y: 0, z: 0 }, { x: 1.496e11, y: 0, z: 0 }]);
    expect(t.metersPerUnit).toBe(5e9);
    const units = 1.496e11 / t.metersPerUnit;
    expect(units).toBeLessThanOrEqual(FIT_EXTENT_UNITS);
    expect(units).toBeGreaterThan(FIT_EXTENT_UNITS / 2.5);
  });

  it("fits a large 200-body system into the overview extent", () => {
    const positions = Array.from({ length: 200 }, (_, i) => {
      const angle = (2 * Math.PI * i) / 200;
      const distance = 1e11 + i * 5e11;
      return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        z: (i - 100) * 7e11,
      };
    });
    const t = fitTransform(positions);
    const farthestCoordinate = Math.max(...positions.flatMap((p) => [Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)]));
    const fittedExtent = farthestCoordinate / t.metersPerUnit;
    expect(t.metersPerUnit).toBeGreaterThan(0);
    expect(fittedExtent).toBeLessThanOrEqual(FIT_EXTENT_UNITS);
    expect(fittedExtent).toBeGreaterThan(FIT_EXTENT_UNITS / 2.5);
  });

  it("falls back to the default scale when there is nothing to fit", () => {
    expect(fitTransform([]).metersPerUnit).toBe(DEFAULT_METERS_PER_UNIT);
    expect(fitTransform([{ x: 0, y: 0, z: 0 }]).metersPerUnit).toBe(DEFAULT_METERS_PER_UNIT);
    // A lone body that has drifted a few km from the origin must not collapse the scale to ~1 m/unit.
    expect(fitTransform([{ x: 4_000, y: -2_500, z: 0 }]).metersPerUnit).toBe(DEFAULT_METERS_PER_UNIT);
  });

  it("keeps small bodies visible: display radius is log-scaled and clamped", () => {
    const earthR = displayRadiusUnits(6.371e6);
    const sunR = displayRadiusUnits(6.957e8);
    expect(earthR).toBeGreaterThan(1);
    expect(sunR).toBeGreaterThan(earthR);
    expect(displayRadiusUnits(1)).toBe(0.3);
    expect(displayRadiusUnits(1e15)).toBeCloseTo(5.7, 10);
    expect(displayRadiusUnits(1e30)).toBe(6);
  });
});
