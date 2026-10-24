import { describe, expect, it } from "vitest";
import { clampPlacementDepth, PLACEMENT_WHEEL_SENSITIVITY, rayPlaneIntersection } from "./placement";
import { toPhysicsPosition, toScenePosition } from "./renderTransform";

describe("rayPlaneIntersection", () => {
  it("hits a plane facing the ray at the expected point", () => {
    const hit = rayPlaneIntersection([0, 0, 10], [0, 0, -1], [0, 0, -1], [0, 0, 0]);
    expect(hit).toEqual([0, 0, 0]);
  });

  it("follows an oblique ray to the plane", () => {
    const d = Math.SQRT1_2;
    const hit = rayPlaneIntersection([0, 0, 10], [d, 0, -d], [0, 0, -1], [0, 0, 0]);
    expect(hit![0]).toBeCloseTo(10, 12);
    expect(hit![2]).toBeCloseTo(0, 12);
  });

  it("returns null for a parallel ray or a plane behind the origin", () => {
    expect(rayPlaneIntersection([0, 0, 10], [1, 0, 0], [0, 0, -1], [0, 0, 0])).toBeNull();
    expect(rayPlaneIntersection([0, 0, 10], [0, 0, 1], [0, 0, -1], [0, 0, 0])).toBeNull();
  });

  it("moving the plane along the view direction moves the hit by the same depth", () => {
    const normal: [number, number, number] = [0, 0, -1];
    const near = rayPlaneIntersection([0, 0, 10], normal, normal, [0, 0, 0]);
    const far = rayPlaneIntersection([0, 0, 10], normal, normal, [0, 0, -3]);
    expect(near![2]).toBeCloseTo(0, 12);
    expect(far![2]).toBeCloseTo(-3, 12);
  });
});

describe("clampPlacementDepth", () => {
  it("scrolls by the sensitivity and clamps to 0.8x toward and 10x away from the target distance", () => {
    expect(clampPlacementDepth(0, 100, 50)).toBeCloseTo(100 * PLACEMENT_WHEEL_SENSITIVITY, 12);
    expect(clampPlacementDepth(0, -1e9, 50)).toBe(-40);
    expect(clampPlacementDepth(0, 1e9, 50)).toBe(500);
  });
});

describe("placement readout coordinates", () => {
  it("a scene point maps back to the physics point it will be created at (round trip)", () => {
    const t = { metersPerUnit: 5e9 };
    const scene: [number, number, number] = [12.5, -3, 7];
    const physics = toPhysicsPosition(scene, t);
    expect(physics).toEqual({ x: 12.5 * 5e9, y: -7 * 5e9, z: -3 * 5e9 });
    const again = toScenePosition(physics, t);
    again.forEach((v, i) => expect(v).toBeCloseTo(scene[i], 9));
  });
});
