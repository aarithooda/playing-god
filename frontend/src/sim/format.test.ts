import { describe, expect, it } from "vitest";
import { formatReadout } from "./format";

describe("formatReadout", () => {
  it("keeps three significant figures in plain notation for everyday magnitudes", () => {
    expect(formatReadout(9.8203)).toBe("9.82");
    expect(formatReadout(5513.4)).toBe("5,510");
    expect(formatReadout(0.0123)).toBe("0.0123");
  });

  it("switches to powers of ten with superscript exponents for very large and very small values", () => {
    expect(formatReadout(5.9722e24)).toBe("5.97 × 10²⁴");
    expect(formatReadout(1.2e-7)).toBe("1.20 × 10⁻⁷");
  });

  it("shows a dash for values that are not finite", () => {
    expect(formatReadout(Number.NaN)).toBe("—");
    expect(formatReadout(0)).toBe("0");
  });
});
