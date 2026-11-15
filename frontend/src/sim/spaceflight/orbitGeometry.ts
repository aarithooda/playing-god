// Geometry of what the mission layer draws. Pure (no React, no three.js); SI metres in the simulation's axes.
//
// Nothing here advances physics. The osculating conic is drawn from the ELEMENTS THE BACKEND REPORTED for the present state
// (an instantaneous two-body description); the recorded and planned paths are positions the backend supplied, re-expressed
// relative to a body so an orbit about a moving body reads as an orbit.
import type { OrbitDto } from "../../api/types";
import type { HistoryCache } from "../history/historyModel";

export type P3 = [number, number, number];

const RAD = Math.PI / 180;

/** Unit vectors towards periapsis (P) and 90 degrees ahead in the orbit plane (Q), from inclination, node and argument of periapsis. */
export function perifocalAxes(inclinationDeg: number, raanDeg: number, argPeriapsisDeg: number): { p: P3; q: P3 } {
  const i = inclinationDeg * RAD, o = raanDeg * RAD, w = argPeriapsisDeg * RAD;
  const co = Math.cos(o), so = Math.sin(o), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(w), sw = Math.sin(w);
  return {
    p: [co * cw - so * sw * ci, so * cw + co * sw * ci, sw * si],
    q: [-co * sw - so * cw * ci, -so * sw + co * cw * ci, cw * si],
  };
}

/**
 * Points of the osculating conic relative to the reference body. An ellipse is closed (first point repeated); a hyperbola is
 * drawn from the body's surface side out to `maxRadiusM` on both branches of the single physical arc. Returns [] when the
 * backend reported no elements (a degenerate state).
 */
export function conicPoints(orbit: OrbitDto, segments = 180, maxRadiusM?: number): P3[] {
  const { semiMajorAxisM: a, eccentricity: e, inclinationDeg, raanDeg, argPeriapsisDeg } = orbit;
  if (a === null || e === null || inclinationDeg === null || raanDeg === null || argPeriapsisDeg === null) return [];
  const { p, q } = perifocalAxes(inclinationDeg, raanDeg, argPeriapsisDeg);
  const semiLatus = a * (1 - e * e);
  if (!(semiLatus > 0)) return [];
  const at = (nu: number): P3 => {
    const r = semiLatus / (1 + e * Math.cos(nu));
    const x = r * Math.cos(nu), y = r * Math.sin(nu);
    return [p[0] * x + q[0] * y, p[1] * x + q[1] * y, p[2] * x + q[2] * y];
  };
  const out: P3[] = [];
  if (e < 1) {
    // uniform in ECCENTRIC anomaly: points spread evenly along the ellipse (uniform true anomaly would bunch them at periapsis
    // and leave a visibly polygonal apoapsis on a long transfer orbit)
    const b = a * Math.sqrt(1 - e * e);
    for (let k = 0; k <= segments; k += 1) {
      const E = (2 * Math.PI * k) / segments;
      const x = a * (Math.cos(E) - e), y = b * Math.sin(E);
      out.push([p[0] * x + q[0] * y, p[1] * x + q[1] * y, p[2] * x + q[2] * y]);
    }
    return out;
  }
  // hyperbola: true anomaly limited by the asymptote and by the radius worth drawing
  const limitR = maxRadiusM ?? Math.abs(a) * 40;
  const cosLimit = Math.max(-1 / e + 1e-6, (semiLatus / limitR - 1) / e);
  const nuMax = Math.acos(Math.min(1, Math.max(-1, cosLimit)));
  for (let k = 0; k <= segments; k += 1) out.push(at(-nuMax + (2 * nuMax * k) / segments));
  return out;
}

export interface RelativePath {
  /** Positions relative to the frame body, metres. */
  points: P3[];
  timesS: number[];
}

/** Largest angle (seen from the frame body) two consecutive samples may be apart and still be joined by a line. */
export const MAX_SAMPLE_ANGLE_RAD = Math.PI / 5;

/** Keep only the samples taken inside (or outside) a sphere about a body: the part of a flight spent in a sphere of influence. */
export interface SphereFilter {
  bodyId: string;
  radiusM: number;
  side: "inside" | "outside";
}

/**
 * The recorded path of `bodyId` relative to `frameId`, as separate pieces. A piece ends wherever the backend marked a
 * discontinuity, a sample is missing or filtered out, or two consecutive samples are too far apart around the frame body to be
 * joined honestly (a coarse recording of a fast orbit would otherwise be drawn as a polygon of chords through the planet).
 */
export function relativeRecordedPath(cache: HistoryCache, bodyId: string, frameId: string, filter?: SphereFilter, maxPoints = 6000): RelativePath[] {
  const pieces: RelativePath[] = [];
  let current: RelativePath | null = null;
  let last: { index: number; segment: number; p: P3 } | null = null;
  const first = Math.max(0, cache.samples.length - maxPoints);
  for (let k = first; k < cache.samples.length; k += 1) {
    const s = cache.samples[k]!;
    const b = s.positionsM[bodyId];
    const f = s.positionsM[frameId];
    const c = filter ? s.positionsM[filter.bodyId] : undefined;
    const kept = !filter || (b && c && (Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]) <= filter.radiusM) === (filter.side === "inside"));
    if (!b || !f || !kept) {
      current = null;
      last = null;
      continue;
    }
    const p: P3 = [b[0] - f[0], b[1] - f[1], b[2] - f[2]];
    let joined = last !== null && s.index === last.index + 1 && s.segment === last.segment;
    if (joined && last) {
      const dot = p[0] * last.p[0] + p[1] * last.p[1] + p[2] * last.p[2];
      const n = Math.hypot(...p) * Math.hypot(...last.p);
      joined = n > 0 && Math.acos(Math.min(1, Math.max(-1, dot / n))) <= MAX_SAMPLE_ANGLE_RAD;
    }
    if (!joined || !current) {
      current = { points: [], timesS: [] };
      pieces.push(current);
    }
    current.points.push(p);
    current.timesS.push(s.simulationTimeS);
    last = { index: s.index, segment: s.segment, p };
  }
  return pieces.filter((piece) => piece.points.length >= 2);
}

export interface PlannedPaths {
  /** The planned path relative to the ORIGIN body, up to the arrival. */
  aboutOrigin: P3[];
  /** The planned path relative to the DESTINATION, from where it comes within `nearM` of it. */
  aboutDestination: P3[];
  /** Where the destination will be at the arrival, relative to the origin body (null without an arrival). */
  destinationAtArrival: P3 | null;
  /** Planned positions relative to the origin at the given node times (nearest sample). */
  nodes: { timeS: number; aboutOrigin: P3; aboutDestination: P3 }[];
}

/** Splits a planned trajectory (inertial samples of craft, origin, destination) into the two body-relative views it is drawn in. */
export function plannedPaths(
  trajectory: { timesS: number[]; spacecraftM: P3[]; originM: P3[]; destinationM: P3[] },
  arrivalS: number,
  nearM: number,
  nodeTimesS: number[] = [],
  fromS = -Infinity,
): PlannedPaths {
  const aboutOrigin: P3[] = [];
  const aboutDestination: P3[] = [];
  let destinationAtArrival: P3 | null = null;
  let bestArrival = Infinity;
  const n = trajectory.timesS.length;
  for (let k = 0; k < n; k += 1) {
    const t = trajectory.timesS[k]!;
    const c = trajectory.spacecraftM[k]!, o = trajectory.originM[k]!, d = trajectory.destinationM[k]!;
    const relO: P3 = [c[0] - o[0], c[1] - o[1], c[2] - o[2]];
    const relD: P3 = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
    if (Math.abs(t - arrivalS) < bestArrival) {
      bestArrival = Math.abs(t - arrivalS);
      destinationAtArrival = [d[0] - o[0], d[1] - o[1], d[2] - o[2]];
    }
    if (t < fromS) continue;
    if (t <= arrivalS) aboutOrigin.push(relO);
    if (Math.hypot(...relD) <= nearM) aboutDestination.push(relD);
  }
  const nodes = nodeTimesS.map((timeS) => {
    let best = 0;
    for (let k = 1; k < n; k += 1) if (Math.abs(trajectory.timesS[k]! - timeS) < Math.abs(trajectory.timesS[best]! - timeS)) best = k;
    const c = trajectory.spacecraftM[best] ?? [0, 0, 0], o = trajectory.originM[best] ?? [0, 0, 0], d = trajectory.destinationM[best] ?? [0, 0, 0];
    return { timeS, aboutOrigin: [c[0] - o[0], c[1] - o[1], c[2] - o[2]] as P3, aboutDestination: [c[0] - d[0], c[1] - d[1], c[2] - d[2]] as P3 };
  });
  return { aboutOrigin, aboutDestination, destinationAtArrival: n > 0 ? destinationAtArrival : null, nodes };
}
