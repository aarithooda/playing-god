import { describe, expect, it } from "vitest";
import { unblendableIds } from "./blendSafety";

const earth = { id: "earth", massKg: 5.972e24, positionM: { x: 1.5e11, y: 0, z: 0 } };
const moon = { id: "moon", massKg: 7.35e22, primaryId: "earth", positionM: { x: 1.5e11 + 3.84e8, y: 0, z: 0 } };
const mars = { id: "mars", massKg: 6.4e23, positionM: { x: 2.2e11, y: 0, z: 0 } };

describe("unblendableIds", () => {
  it("blends a moon system at a slow step (a few hours is a small part of the lunar orbit)", () => {
    expect(unblendableIds([earth, moon, mars], 1e4).size).toBe(0);
  });
  it("keeps the Moon and its planet unblended at a coarse step, and leaves other bodies alone", () => {
    const ids = unblendableIds([earth, moon, mars], 1e6);
    expect([...ids].sort()).toEqual(["earth", "moon"]);
  });
  it("ignores bodies whose mass is unknown and non-positive steps", () => {
    expect(unblendableIds([earth, { ...moon, massKg: undefined }], 1e7).size).toBe(0);
    expect(unblendableIds([earth, moon], 0).size).toBe(0);
  });
});
