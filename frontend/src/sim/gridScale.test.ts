import { describe, expect, it } from "vitest";
import { GRID_SECTION_EVERY, GRID_TARGET_CELL_UNITS, gridCell, nearestNice } from "./gridScale";
import { DEFAULT_METERS_PER_UNIT, fitTransform } from "./renderTransform";

describe("nearestNice", () => {
  it("snaps to 1, 2 or 5 times a power of ten", () => {
    expect(nearestNice(1)).toBe(1);
    expect(nearestNice(1.4)).toBe(1);
    expect(nearestNice(1.5)).toBe(2);
    expect(nearestNice(3.1)).toBe(2);
    expect(nearestNice(3.3)).toBe(5);
    expect(nearestNice(7)).toBe(5);
    expect(nearestNice(8)).toBe(10);
    expect(nearestNice(2.5e10)).toBe(2e10);
    expect(nearestNice(4e-3)).toBeCloseTo(5e-3, 15);
  });

  it("scales exactly with powers of ten", () => {
    for (const raw of [1.7, 3.7, 6.2]) expect(nearestNice(raw * 1e9)).toBeCloseTo(nearestNice(raw) * 1e9, 3);
  });
});

describe("gridCell", () => {
  it("gives a readable metre value whose scene size stays near the target across display scales", () => {
    for (const mpu of [1e3, 2e5, 5e9, DEFAULT_METERS_PER_UNIT, 1e12, 3e14]) {
      const cell = gridCell(mpu);
      expect(nearestNice(cell.cellMeters)).toBe(cell.cellMeters); // already a 1-2-5 value
      expect(cell.cellUnits).toBeCloseTo(cell.cellMeters / mpu, 12);
      expect(cell.cellUnits).toBeGreaterThan(GRID_TARGET_CELL_UNITS / 2.2);
      expect(cell.cellUnits).toBeLessThan(GRID_TARGET_CELL_UNITS * 2.2);
      expect(cell.sectionUnits).toBeCloseTo(cell.cellUnits * GRID_SECTION_EVERY, 12);
    }
  });

  it("follows the fitted display scale: a 1 AU system gets a cell of a few 1e10 m", () => {
    const t = fitTransform([{ x: 1.496e11, y: 0, z: 0 }]);
    const { cellMeters } = gridCell(t.metersPerUnit);
    expect(cellMeters).toBeGreaterThanOrEqual(1e10);
    expect(cellMeters).toBeLessThanOrEqual(5e10);
  });

  it("is stable while the scale is held: the same scale gives the same cell", () => {
    expect(gridCell(5e9)).toEqual(gridCell(5e9));
  });
});
