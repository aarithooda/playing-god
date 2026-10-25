import { describe, expect, it } from "vitest";
import { disturbGrains, generateRingGrains, intruderCaptureRadius } from "./ringWorld";

describe("ring grains react to an intruder", () => {
  const make = () => {
    const g = generateRingGrains(2000);
    return { orbit: g.orbit.slice(), alive: new Float32Array(g.count).fill(1), n: g.count };
  };
  const count = (a: Float32Array) => a.reduce((s, v) => s + v, 0);

  it("leaves the ring alone with no intruder", () => {
    const { orbit, alive } = make();
    expect(disturbGrains(orbit, alive, 3, [], [], 0.016)).toBe(false);
    expect(count(alive)).toBe(alive.length);
  });

  it("swallows grains inside the capture radius and ejects grains kicked far out", () => {
    const { orbit, alive, n } = make();
    const cap = intruderCaptureRadius(0.3, 1);
    // a big body sitting in the ring plane at 1.8 planet radii
    for (let f = 0; f < 600; f += 1) disturbGrains(orbit, alive, 0, [[1.8, 0, 0]], [cap], 0.016);
    expect(count(alive)).toBeLessThan(n);
    expect(count(alive)).toBeGreaterThan(0);
  });

  it("a far intruder changes nothing", () => {
    const { orbit, alive } = make();
    expect(disturbGrains(orbit, alive, 0, [[50, 0, 0]], [0.12], 0.016)).toBe(false);
  });
});
