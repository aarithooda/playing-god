// Two-body (Kepler) propagation by universal variables (Bate, Mueller & White; Vallado). Pure, no React, no three.js.
//
// DISPLAY ONLY. The simulation is integrated by the backend; this is used to draw a satellite between two authoritative
// snapshots when the step spans a large part of its orbit (a straight or cubic interpolation would cut the corner). Positions
// at the snapshots are never produced here, only the ones in between.
export type V3 = [number, number, number];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3) => Math.sqrt(dot(a, a));

function stumpffC(z: number): number {
  if (Math.abs(z) < 1e-8) return 0.5 - z / 24;
  return z > 0 ? (1 - Math.cos(Math.sqrt(z))) / z : (Math.cosh(Math.sqrt(-z)) - 1) / -z;
}
function stumpffS(z: number): number {
  if (Math.abs(z) < 1e-8) return 1 / 6 - z / 120;
  if (z > 0) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  const s = Math.sqrt(-z);
  return (Math.sinh(s) - s) / (s * s * s);
}

/** Orbital period (s) of a bound two-body state, or null when the orbit is not a bound ellipse. */
export function orbitalPeriod(r0: V3, v0: V3, mu: number): number | null {
  const alpha = 2 / norm(r0) - dot(v0, v0) / mu;
  return alpha > 1e-30 ? (2 * Math.PI) / (Math.sqrt(mu) * Math.pow(alpha, 1.5)) : null;
}

/** Mean angular rate (rad/s) of the relative motion: the mean motion if bound, otherwise |v| / r. */
export function angularRate(r0: V3, v0: V3, mu: number): number {
  const period = orbitalPeriod(r0, v0, mu);
  return period !== null ? (2 * Math.PI) / period : norm(v0) / norm(r0);
}

/**
 * Position after `dt` seconds (negative = backwards) of a body with relative state (r0, v0) about a mass with gravitational
 * parameter `mu`. Returns null when the solver does not converge or the state is degenerate; the caller then falls back to
 * another interpolation. A bound orbit is first reduced modulo its period, so many revolutions cost nothing and lose no precision.
 */
export function propagatePosition(r0: V3, v0: V3, mu: number, dt: number): V3 | null {
  const r0n = norm(r0);
  if (!(r0n > 0) || !(mu > 0) || !Number.isFinite(dt)) return null;
  const alpha = 2 / r0n - dot(v0, v0) / mu;
  let t = dt;
  if (alpha > 1e-30) {
    const period = (2 * Math.PI) / (Math.sqrt(mu) * Math.pow(alpha, 1.5));
    t = dt - period * Math.floor(dt / period);
  }
  if (t === 0) return [r0[0], r0[1], r0[2]];
  const sqrtMu = Math.sqrt(mu);
  const vr0 = dot(r0, v0) / r0n;
  // Initial guess: the elliptic one for a bound orbit, the radial-drift one otherwise (Newton then finishes the job).
  let chi = alpha > 1e-30 ? sqrtMu * alpha * t : (sqrtMu * t) / r0n;
  let converged = false;
  for (let i = 0; i < 60; i++) {
    const z = alpha * chi * chi;
    const c = stumpffC(z);
    const s = stumpffS(z);
    const f = ((r0n * vr0) / sqrtMu) * chi * chi * c + (1 - alpha * r0n) * chi * chi * chi * s + r0n * chi - sqrtMu * t;
    const df = ((r0n * vr0) / sqrtMu) * chi * (1 - z * s) + (1 - alpha * r0n) * chi * chi * c + r0n;
    if (!(Math.abs(df) > 0) || !Number.isFinite(f)) return null;
    const step = f / df;
    chi -= step;
    if (!Number.isFinite(chi)) return null;
    if (Math.abs(step) <= 1e-12 * Math.max(1, Math.abs(chi))) {
      converged = true;
      break;
    }
  }
  if (!converged) return null;
  const z = alpha * chi * chi;
  const fCoef = 1 - ((chi * chi) / r0n) * stumpffC(z);
  const gCoef = t - ((chi * chi * chi) / sqrtMu) * stumpffS(z);
  const out: V3 = [
    fCoef * r0[0] + gCoef * v0[0],
    fCoef * r0[1] + gCoef * v0[1],
    fCoef * r0[2] + gCoef * v0[2],
  ];
  return out.every(Number.isFinite) ? out : null;
}
