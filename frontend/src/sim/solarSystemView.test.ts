import { describe, expect, it } from "vitest";
import belt from "../data/mainBelt.json";
import { AU_M, J2000_JD, positionAtJd, toKeplerElements } from "./keplerOrbit";
import { framingDistanceScale } from "./framing";
import { buildMainBeltAttributes } from "./mainBelt";
import { DEFAULT_CAMERA_POSITION, SOLAR_SYSTEM_VIEW, solarSystemCameraPosition, solarSystemFraming } from "./renderTransform";

const t = { metersPerUnit: 1e11 };

describe("Solar System overview camera (D-064)", () => {
  it("looks down on the ecliptic at the documented tilt, from the documented distance in au", () => {
    const [x, y, z] = solarSystemCameraPosition(t);
    const d = Math.hypot(x, y, z);
    expect(d * t.metersPerUnit / AU_M).toBeCloseTo(SOLAR_SYSTEM_VIEW.distanceAu, 6);
    const elevation = Math.asin(y / d) * (180 / Math.PI);
    expect(elevation).toBeCloseTo(SOLAR_SYSTEM_VIEW.elevationDeg, 6);
    // steeper than the generic default view, but still tilted enough to show inclinations
    const defaultElevation = Math.asin(DEFAULT_CAMERA_POSITION[1] / Math.hypot(...DEFAULT_CAMERA_POSITION)) * (180 / Math.PI);
    expect(elevation).toBeGreaterThan(defaultElevation);
    expect(elevation).toBeLessThan(75);
  });

  it("does not depend on how the fitted scale rounds: the same au distance at any metersPerUnit", () => {
    const a = solarSystemCameraPosition({ metersPerUnit: 1e11 });
    const b = solarSystemCameraPosition({ metersPerUnit: 2e11 });
    expect(a.map((v) => v / 2)).toEqual(b.map((v) => expect.closeTo(v, 9)));
  });

  it("pulls back on narrow windows only as far as its own framing needs, and never more than the cap", () => {
    const distance = Math.hypot(...solarSystemCameraPosition(t));
    const framing = { distance, ...solarSystemFraming(t) };
    expect(framingDistanceScale({ fovDeg: 50, width: 1440, height: 900, leftInset: 40, rightInset: 320, ...framing })).toBe(1);
    const phone = framingDistanceScale({ fovDeg: 50, width: 390, height: 844, leftInset: 40, rightInset: 300, ...framing });
    expect(phone).toBe(SOLAR_SYSTEM_VIEW.maxPullBack);
    const tablet = framingDistanceScale({ fovDeg: 50, width: 820, height: 1180, leftInset: 40, rightInset: 40, ...framing });
    expect(tablet).toBeGreaterThan(1);
    expect(tablet).toBeLessThan(SOLAR_SYSTEM_VIEW.maxPullBack);
  });
});

describe("main-belt sample (display only)", () => {
  it("builds one set of GPU attributes per asteroid, between Mars and Jupiter", () => {
    const attrs = buildMainBeltAttributes(belt);
    expect(attrs.count).toBe(10000);
    expect(attrs.ae).toHaveLength(20000);
    expect(attrs.p).toHaveLength(30000);
    for (let k = 0; k < attrs.count; k += 1) {
      const a = attrs.ae[2 * k]!;
      expect(a).toBeGreaterThan(1.7);
      expect(a).toBeLessThan(3.3);
      expect(Math.hypot(attrs.p[3 * k]!, attrs.p[3 * k + 1]!, attrs.p[3 * k + 2]!)).toBeCloseTo(1, 5);
    }
  });

  it("propagates like the guides: Ceres from its SBDB epoch back to J2000 stays on its own ellipse", () => {
    const ceres = toKeplerElements({
      jdTdb: belt.epochJdTdb[0]!, e: belt.e[0]!, aAu: belt.a[0]!, iDeg: belt.i[0]!, nodeDeg: belt.om[0]!, periDeg: belt.w[0]!,
      meanAnomalyDeg: belt.ma[0]!, nDegPerDay: belt.n[0]!,
    });
    const r = positionAtJd(ceres, J2000_JD);
    const rAu = Math.hypot(r.x, r.y, r.z) / AU_M;
    expect(rAu).toBeGreaterThan(belt.a[0]! * (1 - belt.e[0]!) - 1e-9);
    expect(rAu).toBeLessThan(belt.a[0]! * (1 + belt.e[0]!) + 1e-9);
  });
});
