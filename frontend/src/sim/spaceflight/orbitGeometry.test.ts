import { describe, expect, it } from "vitest";
import type { HistoryCache } from "../history/historyModel";
import { leoOrbit } from "../../test/flightFixtures";
import { conicPoints, perifocalAxes, plannedPaths, relativeRecordedPath, type P3 } from "./orbitGeometry";

const len = (p: readonly number[]) => Math.hypot(p[0]!, p[1]!, p[2]!);

describe("conicPoints: the osculating orbit drawn from the backend's elements", () => {
  it("a circular equatorial orbit is a closed circle of its radius in the x-y plane", () => {
    const pts = conicPoints({ ...leoOrbit, inclinationDeg: 0 }, 72);
    expect(pts).toHaveLength(73);
    for (const p of pts) {
      expect(len(p)).toBeCloseTo(6.771e6, 3);
      expect(p[2]).toBeCloseTo(0, 6);
    }
    expect(pts[0]![0]).toBeCloseTo(pts[72]![0], 3); // closed
  });

  it("an ellipse reaches exactly its periapsis and apoapsis radii, the periapsis along P", () => {
    const a = 2.4e7, e = 0.6;
    const orbit = { ...leoOrbit, semiMajorAxisM: a, eccentricity: e, inclinationDeg: 30, raanDeg: 40, argPeriapsisDeg: 70 };
    const pts = conicPoints(orbit, 360);
    const radii = pts.map(len);
    expect(Math.min(...radii)).toBeCloseTo(a * (1 - e), 3);
    expect(Math.max(...radii)).toBeCloseTo(a * (1 + e), 3);
    const { p } = perifocalAxes(30, 40, 70);
    expect(pts[0]!.map((c) => c / (a * (1 - e)))).toEqual(p.map((c) => expect.closeTo(c, 9)));
    // sampled evenly along the ellipse: no long chord at apoapsis (uniform true anomaly would give one 10x the mean)
    const steps = pts.slice(1).map((q, k) => len([q[0] - pts[k]![0], q[1] - pts[k]![1], q[2] - pts[k]![2]]));
    expect(Math.max(...steps) / (steps.reduce((s, x) => s + x, 0) / steps.length)).toBeLessThan(1.6);
  });

  it("inclination tilts the orbit out of the x-y plane by exactly that angle", () => {
    const pts = conicPoints({ ...leoOrbit, inclinationDeg: 51.6 }, 360);
    const maxZ = Math.max(...pts.map((p) => Math.abs(p[2])));
    expect(maxZ / 6.771e6).toBeCloseTo(Math.sin((51.6 * Math.PI) / 180), 4);
  });

  it("a hyperbola is one open arc through its periapsis, cut at the radius worth drawing", () => {
    const orbit = { ...leoOrbit, regime: "escape" as const, semiMajorAxisM: -9e6, eccentricity: 1.5, inclinationDeg: 0, apoapsisRadiusM: null, periodS: null };
    const pts = conicPoints(orbit, 100, 6e7);
    const radii = pts.map(len);
    expect(Math.min(...radii)).toBeCloseTo(4.5e6, 0); // |a| (e - 1)
    expect(radii[0]!).toBeCloseTo(6e7, -3);
    expect(radii[radii.length - 1]!).toBeCloseTo(6e7, -3);
    expect(len([pts[0]![0] - pts[100]![0], pts[0]![1] - pts[100]![1], 0])).toBeGreaterThan(1e7); // open: the ends are far apart
  });

  it("draws nothing when the backend reported no elements", () => {
    expect(conicPoints({ ...leoOrbit, regime: "degenerate", semiMajorAxisM: null, eccentricity: null })).toEqual([]);
  });
});

function cache(samples: { t: number; segment?: number; index?: number; positions: Record<string, P3> }[]): HistoryCache {
  return {
    universeId: "u", generation: 1, mode: "grid", sampleIntervalS: 60, bodies: {}, nextIndex: samples.length, droppedBefore: 0, truncated: false,
    gaps: [], clientTrimmed: false,
    samples: samples.map((s, i) => ({ index: s.index ?? i, simulationTimeS: s.t, segment: s.segment ?? 0, positionsM: s.positions })),
  };
}
/** A craft on a circle of radius r about a body that itself moves along +x. */
const orbiting = (n: number, stepDeg: number, r = 7e6, drift = 1e6): { t: number; positions: Record<string, P3> }[] =>
  Array.from({ length: n }, (_, k) => {
    const a = (k * stepDeg * Math.PI) / 180;
    return { t: k * 60, positions: { earth: [k * drift, 0, 0] as P3, craft: [k * drift + r * Math.cos(a), r * Math.sin(a), 0] as P3 } };
  });

describe("relativeRecordedPath: the flown path about a body", () => {
  it("removes the body's own motion: an orbit about a moving body is a circle again", () => {
    const [piece] = relativeRecordedPath(cache(orbiting(40, 9)), "craft", "earth");
    expect(piece!.points).toHaveLength(40);
    for (const p of piece!.points) expect(len(p)).toBeCloseTo(7e6, 3);
    expect(piece!.timesS[39]).toBe(39 * 60);
  });

  it("does not join samples that are too far apart around the body (a coarse recording is not drawn as chords)", () => {
    expect(relativeRecordedPath(cache(orbiting(12, 80)), "craft", "earth")).toEqual([]);
    expect(relativeRecordedPath(cache(orbiting(12, 30)), "craft", "earth")).toHaveLength(1);
  });

  it("breaks the path at a backend discontinuity, at a missing sample and where a body is absent", () => {
    const samples = orbiting(30, 5);
    samples[10] = { ...samples[10]!, positions: { earth: samples[10]!.positions.earth! } }; // the craft is absent here
    const withSegments = samples.map((s, k) => ({ ...s, segment: k >= 20 ? 1 : 0, index: k >= 25 ? k + 3 : k }));
    const pieces = relativeRecordedPath(cache(withSegments), "craft", "earth");
    expect(pieces.map((p) => p.points.length)).toEqual([10, 9, 5, 5]);
  });

  it("can keep only the leg inside, or only the leg outside, a sphere about a body", () => {
    const samples = Array.from({ length: 21 }, (_, k) => ({ t: k * 60, positions: { earth: [0, 0, 0] as P3, moon: [100, 0, 0] as P3, craft: [10 + 4 * k, 1, 0] as P3 } }));
    const near = relativeRecordedPath(cache(samples), "craft", "moon", { bodyId: "moon", radiusM: 30, side: "inside" });
    const far = relativeRecordedPath(cache(samples), "craft", "earth", { bodyId: "moon", radiusM: 30, side: "outside" });
    expect(near).toHaveLength(1);
    expect(far).toHaveLength(1);
    expect(near[0]!.points.every((p) => len(p) <= 30)).toBe(true);
    expect(near[0]!.points.length + far[0]!.points.length).toBe(21);
    expect(far[0]!.points[0]).toEqual([10, 1, 0]);
  });
});

describe("plannedPaths: the planner's samples in the two views they are drawn in", () => {
  const n = 11;
  const trajectory = {
    timesS: Array.from({ length: n }, (_, k) => k * 100),
    originM: Array.from({ length: n }, (_, k) => [k, 0, 0] as P3),
    destinationM: Array.from({ length: n }, (_, k) => [1000 + k, 50 * k, 0] as P3),
    spacecraftM: Array.from({ length: n }, (_, k) => [k + 100 * k, 50 * k, 0] as P3),
  };

  it("draws the leg up to the arrival about the origin and the approach about the destination", () => {
    const paths = plannedPaths(trajectory, 800, 250, [0, 800]);
    expect(paths.aboutOrigin).toHaveLength(9); // t = 0 .. 800
    expect(paths.aboutOrigin[3]).toEqual([300, 150, 0]);
    expect(paths.aboutDestination.every((p) => len(p) <= 250)).toBe(true);
    expect(paths.aboutDestination.length).toBeGreaterThan(0);
    expect(paths.destinationAtArrival).toEqual([1000, 400, 0]); // where the destination WILL be, seen from the origin
    expect(paths.nodes.map((x) => x.timeS)).toEqual([0, 800]);
    expect(paths.nodes[1]!.aboutDestination).toEqual([-200, 0, 0]);
  });

  it("keeps only what is still ahead when given the present time", () => {
    expect(plannedPaths(trajectory, 800, 250, [], 500).aboutOrigin).toHaveLength(4); // t = 500 .. 800
  });

  it("an empty trajectory gives empty paths and no arrival marker", () => {
    const empty = plannedPaths({ timesS: [], spacecraftM: [], originM: [], destinationM: [] }, 0, 1);
    expect(empty).toEqual({ aboutOrigin: [], aboutDestination: [], destinationAtArrival: null, nodes: [] });
  });
});
