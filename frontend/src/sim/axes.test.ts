import { describe, expect, it } from "vitest";
import { AXIS_COLORS, AXIS_HALF_LENGTH_UNITS, axisHalfLengthMeters, axisSegments } from "./axes";
import { toPhysicsPosition, toScenePosition } from "./renderTransform";

const t = { metersPerUnit: 5e9 };
/** Component-wise equality that does not care about -0 versus +0. */
const same = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
const byAxis = () => Object.fromEntries(axisSegments(t).map((s) => [s.axis, s]));

describe("axisSegments", () => {
  it("lies on the simulation frame: physics +x -> scene +X, +y -> scene -Z, +z (up) -> scene +Y", () => {
    const L = AXIS_HALF_LENGTH_UNITS;
    const s = byAxis();
    same(s.x.to, [L, 0, 0]);
    same(s.y.to, [0, 0, -L]);
    same(s.z.to, [0, L, 0]);
  });

  it("every endpoint is toScenePosition of a physics vector, so axes and bodies share one mapping", () => {
    const half = axisHalfLengthMeters(t);
    const s = byAxis();
    same(s.x.from, toScenePosition({ x: -half, y: 0, z: 0 }, t));
    same(s.y.from, toScenePosition({ x: 0, y: -half, z: 0 }, t));
    same(s.z.to, toScenePosition({ x: 0, y: 0, z: half }, t));
    // and the physical coordinate under each +end is recovered by the inverse mapping
    const back = toPhysicsPosition(s.y.to, t);
    same([back.x, back.y, back.z], [0, half, 0]);
  });

  it("passes through the origin and is symmetric", () => {
    for (const seg of axisSegments(t)) {
      seg.from.forEach((v, i) => expect(v + seg.to[i]).toBeCloseTo(0, 12));
    }
  });

  it("spans the same scene length at every display scale (it is the physical length that changes)", () => {
    for (const mpu of [1e3, 5e9, 1e13]) {
      const seg = axisSegments({ metersPerUnit: mpu })[0];
      expect(seg.to[0] - seg.from[0]).toBeCloseTo(2 * AXIS_HALF_LENGTH_UNITS, 9);
      expect(axisHalfLengthMeters({ metersPerUnit: mpu })).toBeCloseTo(AXIS_HALF_LENGTH_UNITS * mpu, 3);
    }
  });

  it("uses distinct conventional colours per axis and puts each label just past the + end", () => {
    expect(new Set(Object.values(AXIS_COLORS)).size).toBe(3);
    for (const seg of axisSegments(t)) {
      const end = Math.hypot(...seg.to);
      const label = Math.hypot(...seg.labelAt);
      expect(label).toBeGreaterThan(end);
      expect(seg.color).toBe(AXIS_COLORS[seg.axis]);
    }
  });
});
