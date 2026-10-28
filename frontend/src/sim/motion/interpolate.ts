// Display-time interpolation between two AUTHORITATIVE backend states (pure; no React, no three.js; SI units, physics frame).
//
// What this is: the backend integrates the physics and returns one state per step request. To draw the bodies at every
// animation frame the renderer needs their positions at times in between. This module computes them from the two states that
// bracket the displayed time, using the positions AND velocities the backend reported. It never runs a second integrator and
// never produces anything outside [A, B]: at the end points the result is exactly the reported state.
//
// How: bodies are treated hierarchically (a moon about its planet, a planet about its star), because the motion of a satellite
// is a small fast orbit riding on the slow orbit of its host.
//  - the relative state (satellite - host) is interpolated and added to the host's DISPLAYED position, so a moon never drifts
//    off its planet whatever the host's own interpolation error;
//  - when the step spans little of the relative orbit (< KEPLER_ANGLE_RAD) a cubic Hermite curve through (position, velocity) at both
//    ends is used, which is accurate and cannot overshoot;
//  - when it spans a large part (or several revolutions) of the orbit, a curve through two points cannot follow it, so the
//    relative orbit is propagated as a two-body (Kepler) orbit forward from A and backward from B and the two are cross-faded.
//    That is exact for an unperturbed orbit and, for a perturbed one, spreads the small phase error over the step instead of
//    leaving a jump at the end;
//  - a body that took part in a discontinuity (a collision, an edit) is NOT interpolated: it is shown at its B state.
import { angularRate, propagatePosition, type V3 } from "./kepler";

const G = 6.6743e-11;

/** Above this many radians of relative orbit per step, Hermite is replaced by Kepler propagation. */
export const KEPLER_ANGLE_RAD = 0.6;

export interface MotionBody {
  id: string;
  massKg: number;
  /** Position, m. */
  p: V3;
  /** Velocity, m/s. */
  v: V3;
  /** The body this one orbits, when the backend says so. Used as the host when it is valid; otherwise the host is inferred. */
  primaryId?: string;
}

export interface MotionSample {
  /** Simulation time of this state, s. */
  t: number;
  bodies: readonly MotionBody[];
  /** Ids that are discontinuous from the PREVIOUS sample (they took part in a collision during the step). */
  cut?: ReadonlySet<string>;
}

type Mode = "cut" | "hermite" | "kepler";

interface BodyPlan {
  id: string;
  mode: Mode;
  /** Index (in `order`) of the host, or -1 for a top-level body. */
  host: number;
  a: MotionBody;
  b: MotionBody;
  mu: number;
  /** Relative state of the body about its host at A and B (hosted bodies only). */
  rA: V3;
  vA: V3;
  rB: V3;
  vB: V3;
}

export interface SegmentPlan {
  a: MotionSample;
  b: MotionSample;
  order: BodyPlan[];
}

const sub = (x: V3, y: V3): V3 => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
const dist = (x: V3, y: V3) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);

/**
 * The host of every body: the primary the backend named when it is in the sample and heavier; otherwise the closest heavier body whose
 * Hill sphere contains it (a moon is inside its planet's, not the star's); otherwise the heavier body that attracts it most (a
 * planet's star). Strictly heavier only, so equal masses and the heaviest body are top-level (interpolated on their own).
 */
export function findHosts(bodies: readonly MotionBody[]): Map<string, string | null> {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const dominant = (i: MotionBody): MotionBody | null => {
    let best: MotionBody | null = null;
    let bestPull = 0;
    for (const j of bodies) {
      if (j === i || !(j.massKg > i.massKg)) continue;
      const d = dist(i.p, j.p);
      if (!(d > 0)) continue;
      const pull = j.massKg / (d * d);
      if (pull > bestPull) {
        bestPull = pull;
        best = j;
      }
    }
    return best;
  };
  const hill = new Map<string, number>();
  for (const j of bodies) {
    const k = dominant(j);
    if (k) hill.set(j.id, dist(j.p, k.p) * Math.cbrt(j.massKg / (3 * k.massKg)));
  }
  const hosts = new Map<string, string | null>();
  for (const i of bodies) {
    const named = i.primaryId !== undefined ? byId.get(i.primaryId) : undefined;
    if (named && named.massKg > i.massKg) {
      hosts.set(i.id, named.id);
      continue;
    }
    let inside: MotionBody | null = null;
    let insideD = Infinity;
    for (const j of bodies) {
      if (j === i || !(j.massKg > i.massKg)) continue;
      const d = dist(i.p, j.p);
      const h = hill.get(j.id);
      if (h !== undefined && d < h && d < insideD) {
        inside = j;
        insideD = d;
      }
    }
    hosts.set(i.id, (inside ?? dominant(i))?.id ?? null);
  }
  return hosts;
}

/** Everything about the step A -> B that does not depend on the displayed time (computed once per sample pair). */
export function planSegment(a: MotionSample, b: MotionSample): SegmentPlan {
  const dt = b.t - a.t;
  const inB = new Map(b.bodies.map((x) => [x.id, x]));
  const hosts = findHosts(a.bodies);
  const common = [...a.bodies].filter((x) => inB.has(x.id)).sort((x, y) => y.massKg - x.massKg);
  const index = new Map(common.map((x, i) => [x.id, i]));
  const aById = new Map(a.bodies.map((x) => [x.id, x]));
  const order: BodyPlan[] = common.map((bodyA) => {
    const bodyB = inB.get(bodyA.id)!;
    const hostId = hosts.get(bodyA.id) ?? null;
    const hostIdx = hostId === null ? -1 : (index.get(hostId) ?? -1);
    const plan: BodyPlan = { id: bodyA.id, mode: "hermite", host: -1, a: bodyA, b: bodyB, mu: 0, rA: bodyA.p, vA: bodyA.v, rB: bodyB.p, vB: bodyB.v };
    if (b.cut?.has(bodyA.id) || !(dt > 0)) return { ...plan, mode: "cut" };
    if (hostIdx < 0 || hostId === null) return plan;
    const hostA = aById.get(hostId)!;
    const hostB = inB.get(hostId)!;
    if (b.cut?.has(hostId)) return { ...plan, mode: "cut" };
    plan.host = hostIdx;
    plan.mu = G * (bodyA.massKg + hostA.massKg);
    plan.rA = sub(bodyA.p, hostA.p);
    plan.vA = sub(bodyA.v, hostA.v);
    plan.rB = sub(bodyB.p, hostB.p);
    plan.vB = sub(bodyB.v, hostB.v);
    const theta = angularRate(plan.rA, plan.vA, plan.mu) * dt;
    plan.mode = theta > KEPLER_ANGLE_RAD ? "kepler" : "hermite";
    return plan;
  });
  return { a, b, order };
}

function hermite(p0: V3, v0: V3, p1: V3, v1: V3, dt: number, u: number): V3 {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return [0, 1, 2].map((k) => h00 * p0[k]! + h10 * dt * v0[k]! + h01 * p1[k]! + h11 * dt * v1[k]!) as V3;
}

/**
 * Displayed positions (SI) of every body present in both samples at simulation time `t` (clamped to [A, B]). With `wanted`, only those
 * bodies and the hosts they ride on are computed (a hosted body is placed relative to its host's DISPLAYED position, so the chain is
 * needed); the others are absent from the result. The values are identical to a full evaluation.
 */
export function evaluateSegment(plan: SegmentPlan, t: number, wanted?: ReadonlySet<string>): Map<string, V3> {
  const { a, b, order } = plan;
  // A host is always heavier than the body riding on it, so it comes earlier in `order`: one backwards pass closes the set.
  let need: boolean[] | null = null;
  if (wanted) {
    need = order.map((body) => wanted.has(body.id));
    for (let i = order.length - 1; i >= 0; i--) if (need[i] && order[i]!.host >= 0) need[order[i]!.host] = true;
  }
  const dt = b.t - a.t;
  const out = new Map<string, V3>();
  const shown: V3[] = new Array(order.length);
  const clamped = Math.min(b.t, Math.max(a.t, t));
  const u = dt > 0 ? (clamped - a.t) / dt : 1;
  order.forEach((body, i) => {
    if (need && !need[i]) return;
    let p: V3;
    if (body.mode === "cut" || u >= 1) {
      p = body.b.p;
    } else if (u <= 0) {
      p = body.a.p;
    } else if (body.host < 0) {
      p = hermite(body.a.p, body.a.v, body.b.p, body.b.v, dt, u);
    } else {
      let rel: V3 | null = null;
      if (body.mode === "kepler") {
        const forward = propagatePosition(body.rA, body.vA, body.mu, clamped - a.t);
        const backward = propagatePosition(body.rB, body.vB, body.mu, clamped - b.t);
        if (forward && backward) rel = [0, 1, 2].map((k) => (1 - u) * forward[k]! + u * backward[k]!) as V3;
      }
      rel ??= hermite(body.rA, body.vA, body.rB, body.vB, dt, u);
      const host = shown[body.host]!;
      p = [host[0] + rel[0], host[1] + rel[1], host[2] + rel[2]];
    }
    shown[i] = p;
    out.set(body.id, p);
  });
  return out;
}
