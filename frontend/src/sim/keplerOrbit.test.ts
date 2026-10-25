import { describe, expect, it } from "vitest";
import preset from "../../../backend/presets/data/solar-system-j2000.json";
import {
  AU_M, J2000_JD, aphelionM, orbitPolyline, perihelionM, positionAtEccentricAnomaly, positionAtJd, simulationTimeToJd,
  solveKepler,
} from "./keplerOrbit";
import { REFERENCE_ORBITS, referenceOrbitsApply, visibleReferenceOrbits, ORBIT_COLORS, OUTER_WEB_COLOR, orbitColorForBody } from "./referenceOrbits";

const orbit = (id: string) => REFERENCE_ORBITS.find((o) => o.id === id)!;
const norm = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe("Kepler geometry", () => {
  it("solves Kepler's equation to machine precision for every eccentricity used", () => {
    for (const e of [0, 0.0068, 0.2447, 0.52, 0.95]) {
      for (let m = -10; m <= 10; m += 0.37) {
        const E = solveKepler(m, e);
        const wrapped = m - 2 * Math.PI * Math.floor((m + Math.PI) / (2 * Math.PI));
        expect(Math.abs(E - e * Math.sin(E) - wrapped)).toBeLessThan(1e-12);
      }
    }
  });

  it("puts every planet at the preset's own J2000 heliocentric position (frame, epoch and orientation agree)", () => {
    // The preset state is DE441 barycentric vectors; its planet - Sun difference is the heliocentric position, which the
    // independently fetched Horizons heliocentric elements must reproduce. A wrong frame, node or sign would miss by AU.
    const sun = preset.bodies.find((b) => b.id === "body-sun")!.state.positionM;
    for (const o of REFERENCE_ORBITS.filter((r) => r.group === "planet")) {
      const body = preset.bodies.find((b) => b.id === o.bodyId)!;
      const expected = { x: body.state.positionM[0]! - sun[0]!, y: body.state.positionM[1]! - sun[1]!, z: body.state.positionM[2]! - sun[2]! };
      const got = positionAtJd(o.elements, J2000_JD);
      const error = Math.hypot(got.x - expected.x, got.y - expected.y, got.z - expected.z);
      expect(error / norm(expected), o.id).toBeLessThan(1e-9);
    }
  });

  it("returns to the same point after one period, and the ellipse stays between perihelion and aphelion", () => {
    for (const o of REFERENCE_ORBITS) {
      const period = (2 * Math.PI) / o.elements.meanMotionPerDay;
      const a = positionAtJd(o.elements, J2000_JD);
      const b = positionAtJd(o.elements, J2000_JD + period);
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / norm(a), o.id).toBeLessThan(1e-9);
      const line = orbitPolyline(o.elements, 64);
      expect(line).toHaveLength(65);
      expect(line[0]).toEqual(line[64]);
      for (const p of line) {
        const r = norm(p);
        expect(r).toBeGreaterThanOrEqual(perihelionM(o.elements) * (1 - 1e-12));
        expect(r).toBeLessThanOrEqual(aphelionM(o.elements) * (1 + 1e-12));
      }
    }
  });

  it("orients each orbital plane by its inclination (normal = p x q)", () => {
    for (const o of REFERENCE_ORBITS) {
      const { p, q } = o.elements;
      const nz = p.x * q.y - p.y * q.x;
      const source = orbitPolyline(o.elements, 4); // E = 0 is perihelion
      expect(norm(source[0]!)).toBeCloseTo(perihelionM(o.elements), -3);
      expect(nz).toBeGreaterThan(0); // every listed object is prograde
      expect(Math.acos(Math.min(1, nz)) * (180 / Math.PI)).toBeLessThan(40);
    }
    expect(positionAtEccentricAnomaly(orbit("earth").elements, 0).z / AU_M).toBeCloseTo(0, 3);
  });

  it("maps preset simulation time to the TDB Julian date (t = 0 s is J2000.0)", () => {
    expect(simulationTimeToJd(0)).toBe(2451545.0);
    expect(simulationTimeToJd(86400 * 365.25)).toBe(2451545.0 + 365.25);
  });
});

describe("reference orbit set", () => {
  it("contains the eight planets and the eight requested outer bodies", () => {
    expect(REFERENCE_ORBITS.filter((o) => o.group === "planet").map((o) => o.name)).toEqual(
      ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"],
    );
    expect(REFERENCE_ORBITS.filter((o) => o.group === "outer").map((o) => o.name)).toEqual(
      ["Pluto", "Haumea", "Makemake", "Quaoar", "Orcus", "Chiron", "2014 NW65", "Chiminigagua"],
    );
  });

  it("draws Pluto as an orange ellipse that crosses Neptune's radial range and reaches well beyond it", () => {
    const pluto = orbit("pluto");
    const neptune = orbit("neptune");
    expect(pluto.color).toBe(ORBIT_COLORS.pluto);
    expect(perihelionM(pluto.elements)).toBeLessThan(aphelionM(neptune.elements));
    expect(aphelionM(pluto.elements)).toBeGreaterThan(1.5 * aphelionM(neptune.elements));
    expect(pluto.elements.e).toBeGreaterThan(0.2);
  });

  it("uses the requested palette: Neptune blue, Uranus teal, Saturn muted brown, a grey outer web", () => {
    expect(orbit("neptune").color).toBe("#3f6be0");
    expect(orbit("uranus").color).toBe("#3fb5a8");
    expect(orbit("saturn").color).toBe("#9a7651");
    for (const id of ["haumea", "makemake", "quaoar", "orcus", "chiron", "2014-nw65", "chiminigagua"]) {
      expect(orbit(id).color).toBe(OUTER_WEB_COLOR);
    }
    const planetColors = REFERENCE_ORBITS.filter((o) => o.group === "planet").map((o) => o.color);
    expect(new Set(planetColors).size).toBe(8);
    expect(orbitColorForBody("body-neptune")).toBe("#3f6be0");
    expect(orbitColorForBody("body-moon")).toBeUndefined();
  });

  it("is shown only for the Solar System presets with their Sun, and a planet's guide only while the planet exists", () => {
    expect(referenceOrbitsApply("solar-system-j2000", ["body-sun"])).toBe(true);
    expect(referenceOrbitsApply("solar-system-moons-j2000", ["body-sun"])).toBe(true);
    expect(referenceOrbitsApply("solar-system-j2000", ["body-earth"])).toBe(false);
    expect(referenceOrbitsApply(null, ["body-sun"])).toBe(false);
    expect(referenceOrbitsApply("orbit-lab", ["body-sun"])).toBe(false);
    const ids = visibleReferenceOrbits(["body-sun", "body-earth"]).map((o) => o.id);
    expect(ids).toContain("earth");
    expect(ids).not.toContain("jupiter");
    expect(ids).toContain("pluto");
  });
});
