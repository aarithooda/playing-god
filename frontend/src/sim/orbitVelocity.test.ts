import { describe, expect, it } from "vitest";
import { circularOrbitVelocity, pickPrimaryStar } from "./orbitVelocity";

const sun = { name: "Sun", massKg: 1.989e30, positionM: { x: 0, y: 0, z: 0 }, velocityMPerS: { x: 0, y: 0, z: 0 }, kind: "star" };

describe("circularOrbitVelocity", () => {
  it("gives Earth about 29.8 km/s, perpendicular to the radius", () => {
    const v = circularOrbitVelocity(sun, { x: 1.496e11, y: 0, z: 0 }, 5.97e24)!;
    expect(Math.hypot(v.x, v.y, v.z)).toBeGreaterThan(29_700);
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(29_900);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeGreaterThan(0);
  });
  it("adds the star's own velocity and handles a position along z", () => {
    const moving = { ...sun, velocityMPerS: { x: 100, y: 0, z: 0 } };
    const v = circularOrbitVelocity(moving, { x: 0, y: 0, z: 1e11 }, 1)!;
    expect(v.x).toBeCloseTo(100, 6);
    expect(Math.hypot(v.y, v.z)).toBeGreaterThan(1000);
  });
  it("refuses a body on the star and picks the most massive star", () => {
    expect(circularOrbitVelocity(sun, sun.positionM, 1)).toBeUndefined();
    expect(pickPrimaryStar([{ ...sun, massKg: 1 }, sun, { ...sun, kind: "planet", massKg: 9e99 }])?.massKg).toBe(sun.massKg);
  });
});
