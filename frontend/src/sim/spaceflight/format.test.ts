import { describe, expect, it } from "vitest";
import { formatAngle, formatCountdown, formatLength, formatMass, formatSpan, formatSpeed, parseNumber } from "./format";

describe("mission-design formatting", () => {
  it("lengths choose m or km and never invent precision", () => {
    expect(formatLength(0.684)).toBe("0.684 m");
    expect(formatLength(400e3)).toBe("400 km");
    expect(formatLength(99_950)).toBe("99.95 km");
    expect(formatLength(656_728)).toBe("656.7 km");
    expect(formatLength(3.844e8)).toBe("384,400 km");
    expect(formatLength(null)).toBe("—");
    expect(formatLength(Number.NaN)).toBe("—");
  });

  it("speeds switch to km/s at 1 km/s", () => {
    expect(formatSpeed(815.66)).toBe("815.7 m/s");
    expect(formatSpeed(7672.6)).toBe("7.673 km/s");
    expect(formatSpeed(undefined)).toBe("—");
  });

  it("masses and angles", () => {
    expect(formatMass(15000)).toBe("15,000 kg");
    expect(formatMass(11.5)).toBe("11.5 kg");
    expect(formatMass(2.5e6)).toBe("2,500 t");
    expect(formatAngle(51.6)).toBe("51.6°");
    expect(formatAngle(null)).toBe("—");
  });

  it("spans use two parts at most and countdowns say which side of the epoch", () => {
    expect(formatSpan(42)).toBe("42 s");
    expect(formatSpan(5544.9)).toBe("1 h 32 min");
    expect(formatSpan(344_235)).toBe("3 d 24 h");
    expect(formatSpan(250)).toBe("4 min 10 s");
    expect(formatSpan(null)).toBe("—");
    expect(formatCountdown(5000, 0)).toBe("T − 1 h 23 min");
    expect(formatCountdown(0, 250)).toBe("T + 4 min 10 s");
  });

  it("parses what a person types and refuses what is not a number", () => {
    expect(parseNumber(" 12,000 ")).toBe(12000);
    expect(parseNumber("-150.5")).toBe(-150.5);
    expect(parseNumber("1e3")).toBe(1000);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("Infinity")).toBeNull();
  });
});
