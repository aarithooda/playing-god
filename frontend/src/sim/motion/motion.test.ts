import { describe, expect, it } from "vitest";
import { angularRate, orbitalPeriod, propagatePosition, type V3 } from "./kepler";
import { evaluateSegment, findHosts, KEPLER_ANGLE_RAD, planSegment, type MotionBody, type MotionSample } from "./interpolate";
import { INTERVAL_PADDING, MAX_BACKLOG_STEPS, MAX_INTERVAL_S, MotionBuffer, SINGLE_STEP_MAX_S } from "./MotionBuffer";

const G = 6.6743e-11;
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---- an analytic hierarchical system: every body's exact state is known at every time -----------------------------------
interface Spec { id: string; m: number; host?: string; R: number; phase: number }
const SPECS: Spec[] = [
  { id: "sun", m: 1.989e30, R: 0, phase: 0 },
  { id: "earth", m: 5.972e24, host: "sun", R: 1.496e11, phase: 0.3 },
  { id: "moon", m: 7.342e22, host: "earth", R: 3.844e8, phase: 1.1 },
  { id: "mars", m: 6.417e23, host: "sun", R: 2.279e11, phase: 2.0 },
  { id: "phobos", m: 1.066e16, host: "mars", R: 9.376e6, phase: 0.7 },
  { id: "jupiter", m: 1.898e27, host: "sun", R: 7.785e11, phase: 4.0 },
  { id: "io", m: 8.932e22, host: "jupiter", R: 4.217e8, phase: 2.5 },
  { id: "saturn", m: 5.683e26, host: "sun", R: 1.4335e12, phase: 5.2 },
  { id: "titan", m: 1.345e23, host: "saturn", R: 1.2218e9, phase: 3.3 },
];
const spec = new Map(SPECS.map((s) => [s.id, s]));

function truth(id: string, t: number): { p: V3; v: V3 } {
  const s = spec.get(id)!;
  if (!s.host) return { p: [0, 0, 0], v: [0, 0, 0] };
  const host = truth(s.host, t);
  const mu = G * (s.m + spec.get(s.host)!.m);
  const n = Math.sqrt(mu / s.R ** 3);
  const a = s.phase + n * t;
  return {
    p: [host.p[0] + s.R * Math.cos(a), host.p[1] + s.R * Math.sin(a), host.p[2]],
    v: [host.v[0] - s.R * n * Math.sin(a), host.v[1] + s.R * n * Math.cos(a), host.v[2]],
  };
}
function sampleAt(t: number, cut?: string[], named = false): MotionSample {
  const bodies: MotionBody[] = SPECS.map((s) => {
    const st = truth(s.id, t);
    return { id: s.id, massKg: s.m, p: st.p, v: st.v, ...(named && s.host ? { primaryId: s.host } : {}) };
  });
  return { t, bodies, ...(cut ? { cut: new Set(cut) } : {}) };
}
const hostOf = (id: string) => spec.get(id)!.host!;

describe("kepler propagation", () => {
  const mu = G * 5.972e24;
  const R = 7.0e6;
  const vc = Math.sqrt(mu / R);

  it("moves a circular orbit through the right angle, forwards and backwards, over many revolutions", () => {
    const period = orbitalPeriod([R, 0, 0], [0, vc, 0], mu)!;
    expect(period).toBeCloseTo(2 * Math.PI * Math.sqrt(R ** 3 / mu), 3);
    for (const k of [0.25, 0.5, 1.3, 7.75, -0.25, -3.4]) {
      const p = propagatePosition([R, 0, 0], [0, vc, 0], mu, k * period)!;
      const angle = 2 * Math.PI * k;
      expect(dist(p, [R * Math.cos(angle), R * Math.sin(angle), 0])).toBeLessThan(1e-6 * R);
    }
    expect(angularRate([R, 0, 0], [0, vc, 0], mu)).toBeCloseTo((2 * Math.PI) / period, 12);
  });

  it("puts an eccentric orbit at the opposite apse after half a period", () => {
    const e = 0.4;
    const a = R;
    const rp = a * (1 - e);
    const vp = Math.sqrt(mu * (1 + e) / rp);
    const half = orbitalPeriod([rp, 0, 0], [0, vp, 0], mu)! / 2;
    const p = propagatePosition([rp, 0, 0], [0, vp, 0], mu, half)!;
    expect(dist(p, [-a * (1 + e), 0, 0])).toBeLessThan(1e-6 * a);
  });

  it("propagates an unbound (hyperbolic) state and refuses a degenerate one", () => {
    const p = propagatePosition([R, 0, 0], [0, 1.5 * vc, 0], mu, 600)!;
    expect(p.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...p)).toBeGreaterThan(R);
    expect(propagatePosition([0, 0, 0], [0, 1, 0], mu, 10)).toBeNull();
    expect(propagatePosition([R, 0, 0], [0, vc, 0], mu, Number.NaN)).toBeNull();
  });
});

describe("which body hosts which", () => {
  it("finds each planet's star and each moon's planet from positions and masses alone", () => {
    const hosts = findHosts(sampleAt(0).bodies);
    expect(hosts.get("sun")).toBeNull();
    for (const id of ["earth", "mars", "jupiter", "saturn"]) expect(hosts.get(id)).toBe("sun");
    for (const id of ["moon", "phobos", "io", "titan"]) expect(hosts.get(id)).toBe(hostOf(id));
  });

  it("trusts a valid primaryId, ignores an invalid one, and leaves equal masses top-level", () => {
    const named = findHosts(sampleAt(0, undefined, true).bodies);
    expect(named.get("titan")).toBe("saturn");
    const bodies: MotionBody[] = [
      { id: "a", massKg: 1e24, p: [0, 0, 0], v: [0, 0, 0] },
      { id: "b", massKg: 1e24, p: [1e8, 0, 0], v: [0, 0, 0] },
      { id: "c", massKg: 1e20, p: [2e8, 0, 0], v: [0, 0, 0], primaryId: "nobody" },
    ];
    const hosts = findHosts(bodies);
    expect(hosts.get("a")).toBeNull();
    expect(hosts.get("b")).toBeNull();
    expect(hosts.get("c")).toBe("b");
  });
});

describe("interpolating between two backend states", () => {
  it("returns exactly the reported state at both ends", () => {
    const a = sampleAt(0), b = sampleAt(1e6);
    const plan = planSegment(a, b);
    const atA = evaluateSegment(plan, 0), atB = evaluateSegment(plan, 1e6);
    for (const body of a.bodies) expect(atA.get(body.id)).toEqual(body.p);
    for (const body of b.bodies) expect(atB.get(body.id)).toEqual(body.p);
  });

  it("follows free motion exactly and never overshoots", () => {
    const mk = (t: number): MotionSample => ({
      t,
      bodies: [
        { id: "x", massKg: 1e24, p: [1e6 * t, 0, 0], v: [1e6, 0, 0] },
        { id: "y", massKg: 1e24, p: [0, -2e6 * t, 5], v: [0, -2e6, 0] },
      ],
    });
    const plan = planSegment(mk(0), mk(10));
    let previous = -Infinity;
    for (let t = 0; t <= 10; t += 0.5) {
      const out = evaluateSegment(plan, t);
      expect(out.get("x")![0]).toBeCloseTo(1e6 * t, 3);
      expect(out.get("y")![1]).toBeCloseTo(-2e6 * t, 3);
      expect(out.get("x")![0]).toBeGreaterThanOrEqual(previous);
      previous = out.get("x")![0];
    }
  });

  for (const step of [1e5, 1e6, 1e7]) {
    it(`reproduces the motion of every planet and moon between states ${step.toExponential(0)} s apart`, () => {
      const plan = planSegment(sampleAt(0), sampleAt(step));
      for (let k = 1; k < 40; k++) {
        const t = (step * k) / 40;
        const out = evaluateSegment(plan, t);
        for (const s of SPECS) {
          if (!s.host) continue;
          const want = truth(s.id, t).p, hostWant = truth(s.host, t).p;
          // Relative to the host (what the eye compares), as a fraction of the orbit radius.
          const relErr = dist(sub(out.get(s.id)!, out.get(s.host)!), sub(want, hostWant)) / s.R;
          expect(relErr, `${s.id} at step ${step}, t=${t}`).toBeLessThan(5e-3);
          // A satellite never leaves its orbit radius (a circular orbit stays at R).
          const radius = dist(out.get(s.id)!, out.get(s.host)!);
          expect(radius / s.R).toBeGreaterThan(0.985);
          expect(radius / s.R).toBeLessThan(1.015);
        }
      }
    });
  }

  it("switches to Kepler propagation exactly when the step spans a large part of the relative orbit", () => {
    const small = planSegment(sampleAt(0), sampleAt(1e4)), big = planSegment(sampleAt(0), sampleAt(1e7));
    const mode = (p: ReturnType<typeof planSegment>, id: string) => p.order.find((b) => b.id === id)!.mode;
    expect(mode(small, "io")).toBe("hermite");
    expect(mode(big, "io")).toBe("kepler");
    expect(mode(big, "earth")).toBe("kepler"); // 1e7 s is a third of a year: ~2 rad
    expect(mode(small, "saturn")).toBe("hermite");
    expect(KEPLER_ANGLE_RAD).toBeGreaterThan(0.3);
  });

  it("is continuous across the boundary between two consecutive segments, at every step size", () => {
    for (const step of [1e5, 1e6, 1e7]) {
      const s0 = sampleAt(0), s1 = sampleAt(step), s2 = sampleAt(2 * step);
      const first = planSegment(s0, s1), second = planSegment(s1, s2);
      const exactA = evaluateSegment(first, step), exactB = evaluateSegment(second, step);
      for (const s of SPECS) expect(exactA.get(s.id)).toEqual(exactB.get(s.id));
      // And just either side of it the bodies have moved only by what their speed allows (no jump).
      const eps = 2;
      const before = evaluateSegment(first, step - eps), after = evaluateSegment(second, step + eps);
      for (const s of SPECS) {
        const v = truth(s.id, step).v;
        expect(dist(before.get(s.id)!, after.get(s.id)!), `${s.id} at ${step}`).toBeLessThan(4 * Math.hypot(...v) * 2 * eps + 1e3);
      }
    }
  });

  it("does not interpolate a body that collided: it shows its new state at once, while the others keep moving", () => {
    const a = sampleAt(0), b = sampleAt(1e6, ["mars"]);
    const out = evaluateSegment(planSegment(a, b), 5e5);
    expect(out.get("mars")).toEqual(b.bodies.find((x) => x.id === "mars")!.p);
    expect(out.get("earth")).not.toEqual(b.bodies.find((x) => x.id === "earth")!.p);
    // A satellite of the collided body is cut with it (its host's displayed position is its new state).
    const withMoon = evaluateSegment(planSegment(a, sampleAt(1e6, ["earth"])), 5e5);
    expect(withMoon.get("moon")).toEqual(sampleAt(1e6).bodies.find((x) => x.id === "moon")!.p);
  });

  it("copes with bodies that exist in only one of the two states", () => {
    const a = sampleAt(0);
    const b: MotionSample = { t: 1e6, bodies: [...sampleAt(1e6).bodies.filter((x) => x.id !== "phobos"), { id: "new", massKg: 1e20, p: [7, 8, 9], v: [0, 0, 0] }] };
    const out = evaluateSegment(planSegment(a, b), 5e5);
    expect(out.has("phobos")).toBe(false); // gone in the newer state (merged away): not interpolated, the scene no longer draws it
    expect(out.has("new")).toBe(false); // no past: MotionBuffer shows it where it is
    expect(out.get("earth")!.every(Number.isFinite)).toBe(true);
  });
});

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// ---- the buffer and the display clock ---------------------------------------------------------------------------------------
describe("MotionBuffer display clock", () => {
  const at = (t: number) => sampleAt(t);

  it("shows a flushed state immediately and exactly", () => {
    const buf = new MotionBuffer();
    expect(buf.sample(0)).toBeNull();
    buf.push(at(100), { wallMs: 1000, flush: true });
    const s = buf.sample(1000)!;
    expect(s.timeS).toBe(100);
    for (const b of at(100).bodies) expect(s.positions.get(b.id)).toEqual(b.p);
  });

  it("advances smoothly to each new state over the measured interval, one step behind, and never past the newest", () => {
    const buf = new MotionBuffer();
    buf.push(at(0), { wallMs: 0, flush: true });
    buf.push(at(1e5), { wallMs: 300, playing: true });
    // 0.3 s per 1e5 s measured, padded: the displayed time reaches the new state after about 0.33 s.
    const interval = 300 * INTERVAL_PADDING;
    expect(buf.displayTime(300)).toBe(0);
    expect(buf.displayTime(300 + interval / 2)).toBeCloseTo(5e4, -1);
    expect(buf.displayTime(300 + interval)).toBeCloseTo(1e5, -1);
    expect(buf.displayTime(1e9)).toBe(1e5);
    let last = -1;
    for (let w = 300; w < 800; w += 7) {
      const t = buf.displayTime(w);
      expect(t).toBeGreaterThanOrEqual(last);
      expect(t).toBeLessThanOrEqual(1e5);
      last = t;
    }
  });

  it("stalls (holds the newest state) when the backend is late, and resumes without a jump", () => {
    const buf = new MotionBuffer();
    buf.push(at(0), { wallMs: 0, flush: true });
    buf.push(at(1e5), { wallMs: 300, playing: true });
    expect(buf.displayTime(5000)).toBe(1e5); // exhausted: holds, nothing is invented
    expect(buf.sample(5000)!.timeS).toBe(1e5);
    const before = buf.displayTime(5000);
    buf.push(at(2e5), { wallMs: 5000, playing: true });
    expect(buf.displayTime(5000)).toBeCloseTo(before, 6); // continuous at the push
    expect(buf.displayTime(5000 + 100)).toBeGreaterThan(before);
  });

  it("keeps the displayed time continuous when the step size changes by orders of magnitude", () => {
    const buf = new MotionBuffer();
    buf.push(at(0), { wallMs: 0, flush: true });
    buf.push(at(1e5), { wallMs: 150, playing: true, nextStepS: 1e5 });
    buf.push(at(2e5), { wallMs: 300, playing: true, nextStepS: 1e5 });
    const wall = 300 + 160;
    const before = buf.displayTime(wall);
    buf.push(at(2e5 + 1e7), { wallMs: wall, playing: true, nextStepS: 1e7 });
    expect(buf.displayTime(wall)).toBeCloseTo(before, 6);
    // 1e7 s costs ~100x more: the display must not race through it in the old interval, and is capped at MAX_INTERVAL_S.
    const rate = (buf.displayTime(wall + 1000) - buf.displayTime(wall)) / 1000;
    expect(rate).toBeLessThan(1e7 / (MAX_INTERVAL_S * 0.5));
    expect(rate).toBeGreaterThan(0);
  });

  it("does not keep replaying a long backlog: it catches up to within a few steps of the newest state", () => {
    const buf = new MotionBuffer();
    buf.push(at(0), { wallMs: 0, flush: true });
    buf.push(at(1e6), { wallMs: 100, playing: true });
    buf.push(at(1.1e6), { wallMs: 110, playing: true });
    expect(buf.displayTime(110)).toBeGreaterThanOrEqual(1.1e6 - MAX_BACKLOG_STEPS * 1e5 - 1);
  });

  it("flushes when the simulation time does not advance (reset, restore, edit) so no stale state is replayed", () => {
    const buf = new MotionBuffer();
    buf.push(at(0), { wallMs: 0, flush: true });
    buf.push(at(1e6), { wallMs: 100, playing: true });
    buf.push(at(5e5), { wallMs: 200, playing: true });
    expect(buf.size).toBe(1);
    expect(buf.displayTime(200)).toBe(5e5);
    buf.push(at(1e6), { wallMs: 300, playing: true });
    buf.push(at(2e6), { wallMs: 400, playing: true });
    buf.push(at(3e6), { wallMs: 450, flush: true }); // an explicit flush
    expect(buf.size).toBe(1);
    expect(buf.sample(450)!.timeS).toBe(3e6);
  });

  it("animates a manual single step over a short time, however long the backend took", () => {
    const buf = new MotionBuffer();
    buf.push(at(0), { wallMs: 0, flush: true });
    buf.push(at(1e7), { wallMs: 9000, playing: false });
    expect(buf.displayTime(9000 + SINGLE_STEP_MAX_S * 1000 + 1)).toBe(1e7);
  });

  it("holds a paused simulation still: once the last step has been shown nothing moves", () => {
    const buf = new MotionBuffer();
    buf.push(at(0), { wallMs: 0, flush: true });
    buf.push(at(1e5), { wallMs: 200, playing: true });
    const settled = buf.sample(5000)!;
    const later = buf.sample(60000)!;
    expect(later.timeS).toBe(settled.timeS);
    for (const [id, p] of settled.positions) expect(later.positions.get(id)).toEqual(p);
  });

  it("evaluates every body at the displayed time, with bodies cut by an event shown at their new state", () => {
    const buf = new MotionBuffer();
    buf.push(at(0), { wallMs: 0, flush: true });
    buf.push(sampleAt(1e6, ["jupiter"]), { wallMs: 500, playing: true });
    const mid = buf.sample(500 + 275)!;
    expect(mid.timeS).toBeGreaterThan(0);
    expect(mid.timeS).toBeLessThan(1e6);
    expect(mid.positions.get("jupiter")).toEqual(sampleAt(1e6).bodies.find((b) => b.id === "jupiter")!.p);
    expect(mid.positions.get("saturn")).not.toEqual(sampleAt(1e6).bodies.find((b) => b.id === "saturn")!.p);
    expect(mid.positions.size).toBe(SPECS.length);
  });

  it("shows a body created between two states where it is", () => {
    const buf = new MotionBuffer();
    buf.push(at(0), { wallMs: 0, flush: true });
    const newcomer: MotionBody = { id: "probe", massKg: 1e3, p: [1, 2, 3], v: [0, 0, 0] };
    buf.push({ t: 1e5, bodies: [...at(1e5).bodies, newcomer] }, { wallMs: 200, playing: true });
    expect(buf.sample(250)!.positions.get("probe")).toEqual([1, 2, 3]);
  });
});
