// Two-body (Kepler) geometry for the display-only reference orbits (D-064). No React, no three.js.
//
// Elements are heliocentric osculating elements in the ecliptic and mean equinox of J2000.0, the preset frame, so a
// point computed here is a heliocentric physics-frame position (metres) and goes to the scene through the same
// toScenePosition() as the bodies, offset by the Sun's displayed position. Nothing here is simulated: an orbit drawn
// from these elements is the osculating ellipse at its epoch, not an ephemeris, and positions at other times ignore
// every perturbation.
import type { Vec3 } from "../api/types";

/** IAU 2012 Resolution B2 astronomical unit, metres (the value Horizons uses for its au output). */
export const AU_M = 149_597_870_700;
/** The Solar System presets start at J2000.0 = JD 2451545.0 TDB, and simulation time 0 s is that epoch. */
export const J2000_JD = 2451545.0;
export const SECONDS_PER_DAY = 86_400;
const DEG = Math.PI / 180;

/** Elements as committed in src/data (au, degrees, degrees per day, JD TDB). */
export interface SourceElements {
  jdTdb: number;
  e: number;
  aAu: number;
  iDeg: number;
  nodeDeg: number;
  periDeg: number;
  meanAnomalyDeg: number;
  nDegPerDay: number;
}

export interface KeplerElements {
  aM: number;
  e: number;
  /** Mean anomaly at the epoch, radians. */
  meanAnomaly: number;
  /** Mean motion, radians per day. */
  meanMotionPerDay: number;
  epochJd: number;
  /** Unit vector towards perihelion (physics frame). */
  p: Vec3;
  /** Unit vector 90 degrees ahead of p in the orbital plane, in the direction of motion. */
  q: Vec3;
}

/** Perifocal basis from inclination, ascending node and argument of perihelion (all radians). */
export function perifocalBasis(i: number, node: number, peri: number): { p: Vec3; q: Vec3 } {
  const cO = Math.cos(node), sO = Math.sin(node), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(peri), sw = Math.sin(peri);
  return {
    p: { x: cO * cw - sO * sw * ci, y: sO * cw + cO * sw * ci, z: sw * si },
    q: { x: -cO * sw - sO * cw * ci, y: -sO * sw + cO * cw * ci, z: cw * si },
  };
}

export function toKeplerElements(s: SourceElements): KeplerElements {
  return {
    aM: s.aAu * AU_M,
    e: s.e,
    meanAnomaly: s.meanAnomalyDeg * DEG,
    meanMotionPerDay: s.nDegPerDay * DEG,
    epochJd: s.jdTdb,
    ...perifocalBasis(s.iDeg * DEG, s.nodeDeg * DEG, s.periDeg * DEG),
  };
}

/** Eccentric anomaly for mean anomaly m (radians), elliptic orbits (0 <= e < 1). Newton iteration from a safe start. */
export function solveKepler(m: number, e: number): number {
  const mm = m - 2 * Math.PI * Math.floor((m + Math.PI) / (2 * Math.PI)); // wrap to [-pi, pi)
  let E = e < 0.8 ? mm : Math.PI * Math.sign(mm || 1);
  for (let k = 0; k < 30; k += 1) {
    const d = (E - e * Math.sin(E) - mm) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}

/** Heliocentric position (m) at eccentric anomaly E. */
export function positionAtEccentricAnomaly(el: KeplerElements, E: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const xp = el.aM * (Math.cos(E) - el.e);
  const yp = el.aM * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  out.x = xp * el.p.x + yp * el.q.x;
  out.y = xp * el.p.y + yp * el.q.y;
  out.z = xp * el.p.z + yp * el.q.z;
  return out;
}

/** Heliocentric two-body position (m) at a TDB Julian date. `out` lets a frame loop avoid allocating. */
export function positionAtJd(el: KeplerElements, jd: number, out?: Vec3): Vec3 {
  const m = el.meanAnomaly + el.meanMotionPerDay * (jd - el.epochJd);
  return positionAtEccentricAnomaly(el, solveKepler(m, el.e), out);
}

/** Simulation time of a Solar System preset (s since J2000.0) as a TDB Julian date. */
export function simulationTimeToJd(simulationTimeS: number): number {
  return J2000_JD + simulationTimeS / SECONDS_PER_DAY;
}

/**
 * The closed osculating ellipse as heliocentric points (m), sampled uniformly in eccentric anomaly so that the ends of
 * an eccentric orbit stay smooth. The last point repeats the first.
 */
export function orbitPolyline(el: KeplerElements, segments = 256): Vec3[] {
  const points: Vec3[] = [];
  for (let k = 0; k < segments; k += 1) points.push(positionAtEccentricAnomaly(el, (2 * Math.PI * k) / segments));
  points.push({ ...points[0]! }); // closes exactly (E = 2 pi would differ in the last bits)
  return points;
}

export function perihelionM(el: KeplerElements): number {
  return el.aM * (1 - el.e);
}

export function aphelionM(el: KeplerElements): number {
  return el.aM * (1 + el.e);
}
