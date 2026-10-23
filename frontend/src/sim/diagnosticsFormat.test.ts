import { describe, expect, it } from "vitest";
import { diagnostics } from "../test/fixtures";
import {
  UNDEFINED_TEXT,
  formatQuantity,
  formatScalar,
  formatVector,
  kineticPlusPotential,
  orbitalPlusBookedSpin,
} from "./diagnosticsFormat";

describe("formatQuantity / formatScalar / formatVector", () => {
  it("shows 4 significant digits, scientific outside [1e-3, 1e6)", () => {
    expect(formatQuantity(1234.5678)).toBe("1235");
    expect(formatQuantity(0.0123456)).toBe("0.01235");
    expect(formatQuantity(2.6e33)).toBe("2.600e33");
    expect(formatQuantity(-5.3e33)).toBe("-5.300e33");
    expect(formatQuantity(1e6)).toBe("1.000e6");
  });

  it("handles very large and very small finite values without NaN/Infinity text", () => {
    for (const x of [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, 1e-300, 1e300, 5e-324]) {
      const t = formatQuantity(x);
      expect(t).toMatch(/^-?\d\.\d{3}e-?\d+$/);
      expect(t).not.toMatch(/NaN|Infinity/);
    }
  });

  it("zero is the value 0 (also negative zero), not Undefined", () => {
    expect(formatScalar(0, "J")).toBe("0 J");
    expect(formatQuantity(-0)).toBe("0");
  });

  it("null scalars are Undefined, never zero", () => {
    expect(formatScalar(null, "J")).toBe(UNDEFINED_TEXT);
    expect(formatScalar(null, "J")).not.toMatch(/0/);
  });

  it("null vectors are wholly Undefined; a vector is always shown complete", () => {
    expect(formatVector(null, "kg·m/s")).toBe(UNDEFINED_TEXT);
    expect(formatVector({ x: 1, y: 0, z: -2.5e10 }, "kg·m/s")).toBe("(1, 0, -2.500e10) kg·m/s");
  });
});

describe("derived sums", () => {
  it("K + U adds the two backend values", () => {
    expect(kineticPlusPotential({ ...diagnostics, kineticEnergyJ: 5, potentialEnergyJ: -3 })).toBe(2);
  });

  it("K + U is unavailable if either input is null (zero is not substituted)", () => {
    expect(kineticPlusPotential({ ...diagnostics, kineticEnergyJ: null })).toBeNull();
    expect(kineticPlusPotential({ ...diagnostics, potentialEnergyJ: null })).toBeNull();
    expect(kineticPlusPotential({ ...diagnostics, kineticEnergyJ: 0, potentialEnergyJ: 0 })).toBe(0);
  });

  it("K + U is unavailable rather than Infinity when the sum overflows", () => {
    expect(kineticPlusPotential({ ...diagnostics, kineticEnergyJ: Number.MAX_VALUE, potentialEnergyJ: Number.MAX_VALUE })).toBeNull();
  });

  it("orbital L + booked spin adds componentwise", () => {
    const d = {
      ...diagnostics,
      angularMomentumAboutOriginKgM2PerS: { x: 1, y: 2, z: 3 },
      bookedSpinKgM2PerS: { x: 10, y: 20, z: -30 },
    };
    expect(orbitalPlusBookedSpin(d)).toEqual({ x: 11, y: 22, z: -27 });
  });

  it("orbital L + booked spin is unavailable if either vector is null, or on overflow", () => {
    expect(orbitalPlusBookedSpin({ ...diagnostics, angularMomentumAboutOriginKgM2PerS: null })).toBeNull();
    expect(orbitalPlusBookedSpin({ ...diagnostics, bookedSpinKgM2PerS: null })).toBeNull();
    const big = { x: Number.MAX_VALUE, y: 0, z: 0 };
    expect(orbitalPlusBookedSpin({ ...diagnostics, angularMomentumAboutOriginKgM2PerS: big, bookedSpinKgM2PerS: big })).toBeNull();
  });
});
