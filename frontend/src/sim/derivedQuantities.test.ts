import { describe, expect, it } from "vitest";
import { escapeSpeed, magnitude, meanDensity, surfaceGravity } from "./derivedQuantities";

// Earth: 5.9722e24 kg, mean radius 6.371e6 m. Reference values: 5513 kg/m^3, 9.82 m/s^2, 11.19 km/s.
const M = 5.9722e24;
const R = 6.371e6;

describe("derived quantities", () => {
  it("reproduces Earth's textbook mean density, surface gravity and escape speed", () => {
    expect(meanDensity(M, R)!).toBeCloseTo(5513, -1);
    expect(surfaceGravity(M, R)!).toBeCloseTo(9.82, 2);
    expect(escapeSpeed(M, R)! / 1000).toBeCloseTo(11.19, 2);
  });

  it("refuses a radius that is not positive instead of returning Infinity", () => {
    expect(meanDensity(M, 0)).toBeNull();
    expect(surfaceGravity(M, -1)).toBeNull();
    expect(escapeSpeed(M, Number.NaN)).toBeNull();
  });

  it("takes vector magnitudes in three dimensions", () => {
    expect(magnitude({ x: 3, y: 4, z: 12 })).toBe(13);
  });
});
