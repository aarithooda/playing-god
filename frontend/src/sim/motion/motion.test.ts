import { describe, expect, it } from "vitest";
import { angularRate, orbitalPeriod, propagatePosition, type V3 } from "./kepler";
import { evaluateSegment, findHosts, KEPLER_ANGLE_RAD, planSegment, type MotionBody, type MotionSample } from "./interpolate";
import { INTERVAL_PADDING, MAX_BACKLOG_STEPS, MAX_BUFFERED_STATES, MAX_INTERVAL_S, MotionBuffer, SINGLE_STEP_MAX_S } from "./MotionBuffer";

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

describe("MotionBuffer with a paced release (the Play loop's steady cadence)", () => {
  it("lags the released state by one interval and does not fall further behind with every state", () => {
    const buf = new MotionBuffer();
    buf.push(sampleAt(0), { wallMs: 0, flush: true });
    let lag = 0;
    for (let k = 1; k <= 60; k++) {
      const wall = k * 100;
      buf.push(sampleAt(k * 1e5), { wallMs: wall, playing: true, intervalS: 0.1 });
      // just before the next release the displayed time has reached the state released now
      expect(buf.displayTime(wall + 99.9)).toBeCloseTo(k * 1e5, -3);
      lag = Math.max(lag, k * 1e5 - buf.displayTime(wall));
    }
    expect(lag).toBeLessThanOrEqual(1e5 + 1);
  });

  it("stays bounded when nothing samples it (no canvas mounted)", () => {
    const buf = new MotionBuffer();
    buf.push(sampleAt(0), { wallMs: 0, flush: true });
    for (let k = 1; k <= 500; k++) buf.push(sampleAt(k * 1e5), { wallMs: k * 100, playing: true, intervalS: 0.1 });
    expect(buf.size).toBeLessThanOrEqual(MAX_BUFFERED_STATES);
    const frame = buf.sample(500 * 100 + 50)!;
    expect(frame.timeS).toBeLessThanOrEqual(500 * 1e5);
    expect(frame.timeS).toBeGreaterThan(499 * 1e5 - 1e5);
  });
});

// ---- the trail head: recorded history up to the displayed segment's start + the displayed interpolation up to the body ----------
describe("MotionBuffer.samplePath (the trail head): the trail ends exactly at the drawn body, at any playback speed", () => {
  // 3.19 h and 10.2 d of simulated time per real second, released every 150 ms (one Play-loop tick), plus a much faster one.
  const cases = [["3.19 h/s", 3.19 * 3600], ["10.2 d/s", 10.2 * 86400], ["60 d/s", 60 * 86400]] as const;
  for (const [label, simPerWallS] of cases) {
    it(`${label}: head starts where the recorded history ends, ends at the displayed position, and never passes the displayed time`, () => {
      const tickS = 0.15;
      const stepS = simPerWallS * tickS;
      const buf = new MotionBuffer();
      const history: { t: number; p: V3 }[] = [{ t: 0, p: truth("earth", 0).p }];
      buf.push(sampleAt(0), { wallMs: 0, flush: true });
      for (let k = 1; k <= 40; k++) {
        const wall = k * tickS * 1000;
        buf.push(sampleAt(k * stepS), { wallMs: wall, playing: true, intervalS: tickS });
        history.push({ t: k * stepS, p: truth("earth", k * stepS).p });
        for (const frac of [0.1, 0.5, 0.9, 1.0]) {
          const at = wall + frac * tickS * 1000;
          const path = buf.samplePath(at, 16)!;
          const frame = buf.sample(at)!;
          const earthPath = path.paths.get("earth")!;
          // the head ends exactly where the body is drawn
          expect(dist(earthPath[earthPath.length - 1]!, frame.positions.get("earth")!)).toBe(0);
          // time order: history cut <= displayed time <= newest released state
          expect(path.startS).toBeLessThanOrEqual(path.timeS);
          expect(path.timeS).toBeLessThanOrEqual(k * stepS + 1e-6);
          // the recorded history clipped to the segment start meets the head's first point
          const recorded = history.filter((h) => h.t <= path.startS);
          expect(dist(recorded[recorded.length - 1]!.p, earthPath[0]!)).toBeLessThan(1e-3 * 1.496e11 * 1e-6 + 1);
          // every head point is on the interpolated path, close to the true orbit
          for (const p of earthPath) expect(Math.hypot(p[0], p[1])).toBeGreaterThan(0.99 * 1.496e11);
          if (frac < 1) {
            // ending the trail at the newest RELEASED state (the old behaviour) would lead the drawn body
            const released = history[history.length - 1]!.p;
            expect(dist(released, frame.positions.get("earth")!)).toBeGreaterThan(0);
          }
        }
      }
    });
  }

  it("is a single point while only one state is buffered (nothing to interpolate) and null when empty", () => {
    const buf = new MotionBuffer();
    expect(buf.samplePath(0, 16)).toBeNull();
    buf.push(sampleAt(5), { wallMs: 0, flush: true });
    const path = buf.samplePath(10, 16)!;
    expect(path.startS).toBe(5);
    expect(path.paths.get("earth")).toHaveLength(1);
  });

  it("a flush (edit, reset) leaves no head from before it", () => {
    const buf = new MotionBuffer();
    buf.push(sampleAt(0), { wallMs: 0, flush: true });
    buf.push(sampleAt(1e6), { wallMs: 100, playing: true, intervalS: 0.1 });
    buf.push(sampleAt(3e6), { wallMs: 5000, flush: true });
    const path = buf.samplePath(5001, 16)!;
    expect(path.startS).toBe(3e6);
    expect(path.timeS).toBe(3e6);
  });
});

describe("MotionBuffer when the states arrive slower than the release pace (a backend that cannot keep up, e.g. the maximum speed)", () => {
  it("spreads the motion over the measured gap instead of racing to the newest state and standing still", () => {
    const buf = new MotionBuffer();
    buf.push(sampleAt(0), { wallMs: 0, flush: true });
    // states arrive 1 s apart although the caller paces at 0.15 s
    for (let k = 1; k <= 5; k++) buf.push(sampleAt(k * 1e6), { wallMs: k * 1000, playing: true, intervalS: 0.15 });
    const wall = 5 * 1000;
    // half a second after the last arrival the display is about half way through the newest segment, not already at its end
    const t = buf.displayTime(wall + 500);
    expect(t).toBeGreaterThan(4e6 + 0.3e6);
    expect(t).toBeLessThan(4e6 + 0.7e6);
    // and it keeps moving smoothly: strictly increasing over the gap
    let previous = buf.displayTime(wall);
    for (let ms = 100; ms <= 900; ms += 100) {
      const now = buf.displayTime(wall + ms);
      expect(now).toBeGreaterThan(previous);
      previous = now;
    }
  });
});

describe("MotionBuffer.hold (Pause): the picture stops at once and Resume carries on from where it stopped", () => {
  const stepS = 1e5;
  function playing(steps: number) {
    const buf = new MotionBuffer();
    buf.push(sampleAt(0), { wallMs: 0, flush: true });
    for (let k = 1; k <= steps; k++) buf.push(sampleAt(k * stepS), { wallMs: k * 150, playing: true, intervalS: 0.15 });
    return buf;
  }

  it("freezes the displayed time and the drawn positions at the instant of the hold, however long it is left", () => {
    const buf = playing(6);
    const at = 6 * 150 + 80;
    const before = buf.sample(at)!;
    buf.hold(at);
    for (const later of [0, 1, 150, 5000, 600000]) {
      const frame = buf.sample(at + later)!;
      expect(frame.timeS).toBe(before.timeS);
      expect(frame.positions.get("earth")).toEqual(before.positions.get("earth"));
    }
  });

  it("states pushed while held (look-ahead released at Pause) do not move the picture; they are kept for Resume", () => {
    const buf = playing(4);
    const at = 4 * 150 + 60;
    const frozen = buf.sample(at)!.timeS;
    // Pause: three more computed states are buffered, then the picture is frozen
    for (let k = 5; k <= 7; k++) buf.push(sampleAt(k * stepS), { wallMs: at, flush: false, playing: false });
    buf.hold(at);
    expect(buf.sample(at + 10000)!.timeS).toBe(frozen);
    expect(buf.latestTimeS).toBe(7 * stepS);
    // the trail has the dense points of the held states too
    const trail = buf.trail.pointsFor("earth");
    expect(trail[trail.length - 1]!.t).toBe(7 * stepS);
  });

  it("Resume: the first state pushed after a hold starts from the frozen time (no jump) and moves at the normal pace, not racing through the held states", () => {
    const buf = playing(4);
    const at = 4 * 150 + 60;
    const frozen = buf.sample(at)!.timeS;
    for (let k = 5; k <= 7; k++) buf.push(sampleAt(k * stepS), { wallMs: at, flush: false, playing: false });
    buf.hold(at);
    const resume = at + 5000;
    buf.push(sampleAt(8 * stepS), { wallMs: resume, playing: true, intervalS: 0.15 });
    expect(buf.displayTime(resume)).toBe(frozen);
    // one interval later it has advanced by one step (the paced speed), not by the whole backlog
    expect(buf.displayTime(resume + 150)).toBeCloseTo(frozen + stepS, -2);
    let previous = frozen;
    for (let ms = 10; ms <= 1500; ms += 10) {
      const t = buf.displayTime(resume + ms);
      expect(t).toBeGreaterThanOrEqual(previous);
      previous = t;
    }
    expect(previous).toBeLessThanOrEqual(8 * stepS);
  });
});

describe("MotionBuffer.hold freezes what the user last SAW, and held pushes cannot move it", () => {
  const stepS = 1e5;
  function playing(steps: number) {
    const buf = new MotionBuffer();
    buf.push(sampleAt(0), { wallMs: 0, flush: true });
    for (let k = 1; k <= steps; k++) buf.push(sampleAt(k * stepS), { wallMs: k * 150, playing: true, intervalS: 0.15 });
    return buf;
  }

  it("a hold placed a frame (or several) after the last drawn frame freezes at that frame's time, not at the click's time", () => {
    const buf = playing(5);
    const lastFrameWall = 5 * 150 + 40;
    const drawn = buf.sample(lastFrameWall)!; // the last frame the user saw
    const click = lastFrameWall + 90; // the click, one slow frame period later
    expect(buf.displayTime(click)).toBeGreaterThan(drawn.timeS); // the clock had moved on since that frame
    buf.hold(click);
    const frozen = buf.sample(click + 1)!;
    expect(frozen.timeS).toBe(drawn.timeS);
    expect(frozen.positions.get("earth")).toEqual(drawn.positions.get("earth"));
    expect(buf.sample(click + 60000)!.timeS).toBe(drawn.timeS);
  });

  it("states pushed with hold: true change nothing the user sees: not the time, the positions, nor the pace of a later resume", () => {
    const buf = playing(5);
    const at = 5 * 150 + 40;
    const shown = buf.sample(at)!;
    buf.hold(at + 10);
    for (let k = 6; k <= 9; k++) buf.push(sampleAt(k * stepS), { wallMs: at + 20 + k, playing: false, hold: true }); // 3 look-ahead + 1 in flight
    for (const later of [0, 100, 5000]) {
      const f = buf.sample(at + 100 + later)!;
      expect(f.timeS).toBe(shown.timeS);
      expect(f.positions.get("earth")).toEqual(shown.positions.get("earth"));
    }
    expect(buf.latestTimeS).toBe(9 * stepS);
    // resuming after a long pause carries on from the same time at the normal pace
    const resume = at + 600000;
    buf.push(sampleAt(10 * stepS), { wallMs: resume, playing: true, intervalS: 0.15 });
    expect(buf.displayTime(resume)).toBe(shown.timeS);
    expect(buf.displayTime(resume + 150)).toBeCloseTo(shown.timeS + stepS, -2);
  });
});

describe("Pause stress: once held, nothing may move the picture until an explicit resume (randomised sequences)", () => {
  // The real failure (seen in a browser as the planet jumping forward after a Pause click, about one click in ten): the buffer's size cap
  // dropped its OLDEST segment while held look-ahead states were being added, and when that segment was the one on screen the next frame was
  // evaluated from a later segment: the same displayed TIME, a different (later) position.
  function rng(seed: number) {
    let x = seed >>> 0;
    return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  }

  it("a held buffer reaching its size cap keeps showing the segment it was frozen in", () => {
    const stepS = 1e5;
    const buf = new MotionBuffer();
    buf.push(sampleAt(0), { wallMs: 0, flush: true });
    // a backlog: states released faster than the display has moved
    for (let k = 1; k <= MAX_BUFFERED_STATES - 1; k++) buf.push(sampleAt(k * stepS), { wallMs: k * 10, playing: true, intervalS: 0.15 });
    const at = 120;
    const shown = buf.sample(at)!;
    const segmentStart = buf.segmentStartS;
    buf.hold(at);
    // three look-ahead steps computed before the click arrive afterwards
    for (let k = MAX_BUFFERED_STATES; k < MAX_BUFFERED_STATES + 3; k++) buf.push(sampleAt(k * stepS), { wallMs: at + 5 * k, playing: false, hold: true });
    for (const later of [0, 50, 1000, 100000]) {
      const f = buf.sample(at + later)!;
      expect(f.timeS).toBe(shown.timeS);
      expect(f.positions.get("earth")).toEqual(shown.positions.get("earth"));
      expect(f.positions.get("moon")).toEqual(shown.positions.get("moon"));
    }
    expect(buf.segmentStartS).toBe(segmentStart);
  });

  it("1500 random Play / Pause / late-response / Resume sequences: the frame never changes while held", () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const r = rng(seed);
      const stepS = [1e3, 1e5, 3e5, 1e7][Math.floor(r() * 4)]!;
      const buf = new MotionBuffer();
      buf.trail.setWanted(new Set()); // this test is about the displayed frame; recording trails for 9 bodies would only make it slow
      let wall = 0;
      let k = 0;
      let held: { timeS: number; earth: V3 | undefined; moon: V3 | undefined } | null = null;
      buf.push(sampleAt(0), { wallMs: wall, flush: true });
      for (let op = 0; op < 60; op++) {
        const roll = r();
        wall += Math.floor(r() * (r() < 0.1 ? 4000 : 160));
        if (roll < 0.35) {
          // a state is released while playing (this is a resume if the buffer was held)
          k++;
          buf.push(sampleAt(k * stepS), { wallMs: wall, playing: true, intervalS: 0.15 });
          held = null;
        } else if (roll < 0.6) {
          const f = buf.sample(wall)!; // a frame is drawn
          if (held) {
            expect(f.timeS).toBe(held.timeS);
            expect(f.positions.get("earth")).toEqual(held.earth);
            expect(f.positions.get("moon")).toEqual(held.moon);
          }
        } else if (roll < 0.8) {
          // Pause: the click freezes the picture at the last drawn frame, then the already-computed (and in-flight) steps arrive
          buf.sample(wall); // a frame is drawn just before
          wall += Math.floor(r() * 120);
          const alreadyHeld: boolean = held !== null;
          buf.hold(wall);
          const f = buf.sample(wall)!;
          held = alreadyHeld ? held : { timeS: f.timeS, earth: f.positions.get("earth"), moon: f.positions.get("moon") };
          // only a pause that stops a RUNNING loop has computed/in-flight steps still to arrive (3 look-ahead + 1 in flight)
          const late = alreadyHeld ? 0 : Math.floor(r() * 5);
          for (let i = 0; i < late; i++) {
            k++;
            wall += Math.floor(r() * 300);
            buf.push(sampleAt(k * stepS), { wallMs: wall, playing: false, hold: true });
          }
        } else if (held) {
          const f = buf.sample(wall)!;
          expect(f.timeS).toBe(held.timeS);
          expect(f.positions.get("earth")).toEqual(held.earth);
        }
      }
      expect(buf.size).toBeLessThanOrEqual(MAX_BUFFERED_STATES + 4); // the cap, plus the look-ahead and in-flight steps held at a pause
    }
  });
});

describe("Pause at the PHYSICAL press: the frozen picture is the last frame finished before the press", () => {
  // Measured in headed Chrome with the GPU at the maximum speed: the browser dispatched the pointerdown 1-17 ms after the press, behind the
  // frame that was being computed, and that frame (sampled before or even just after the press, not yet on screen when the button went down)
  // was the one Pause froze: the picture ended up one frame further on than what the user saw, 1-6 orbits at that speed. `frameDrawn` marks
  // when a frame's drawing finished; `hold(now, pressedAtMs)` freezes at the last frame finished before the press.
  const stepS = 1e5;
  function playing(steps: number) {
    const buf = new MotionBuffer();
    buf.push(sampleAt(0), { wallMs: 0, flush: true });
    for (let k = 1; k <= steps; k++) buf.push(sampleAt(k * stepS), { wallMs: k * 150, playing: true, intervalS: 0.15 });
    return buf;
  }

  it("a frame still being drawn when the button went down is not the frozen one: the frame before it is", () => {
    const buf = playing(5);
    const seen = buf.sample(790)!; // on screen when the button goes down
    buf.frameDrawn(797);
    const press = 801;
    const inProgress = buf.sample(806)!; // the next frame: the press waits behind it
    buf.frameDrawn(815);
    expect(inProgress.timeS).toBeGreaterThan(seen.timeS);
    buf.hold(816, press); // the handler runs after that frame
    for (const later of [817, 900, 60000]) {
      const f = buf.sample(later)!;
      expect(f.timeS).toBe(seen.timeS);
      expect(f.positions.get("earth")).toEqual(seen.positions.get("earth"));
      expect(f.positions.get("moon")).toEqual(seen.positions.get("moon"));
    }
  });

  it("the same when that frame crossed into the next segment (the segment the user saw is kept for it)", () => {
    // states released faster than the display moves, so it then crosses several segment boundaries at the paced speed
    const buf = new MotionBuffer();
    buf.push(sampleAt(0), { wallMs: 0, flush: true });
    for (let k = 1; k <= 5; k++) buf.push(sampleAt(k * stepS), { wallMs: k * 10, playing: true, intervalS: 0.15 });
    const seg = (x: number) => Math.floor(buf.displayTime(x) / stepS);
    let w = 50;
    const inside = (x: number) => buf.displayTime(x) % stepS !== 0; // strictly inside a segment, not on a state's time
    while (w < 5000 && (seg(w + 16) === seg(w) || !inside(w) || !inside(w + 16) || buf.displayTime(w + 16) >= buf.latestTimeS!)) w++; // the last frame before a boundary
    expect(w).toBeLessThan(5000);
    const seen = buf.sample(w)!;
    buf.frameDrawn(w + 6);
    const startSeen = buf.segmentStartS;
    const inProgress = buf.sample(w + 16)!;
    buf.frameDrawn(w + 28);
    expect(buf.segmentStartS).toBeGreaterThan(startSeen!); // the in-progress frame is in the next segment
    buf.hold(w + 29, w + 20);
    const f = buf.sample(w + 40)!;
    expect(inProgress.timeS).toBeGreaterThan(seen.timeS);
    expect(f.timeS).toBe(seen.timeS);
    expect(f.positions.get("earth")).toEqual(seen.positions.get("earth"));
    expect(f.positions.get("moon")).toEqual(seen.positions.get("moon"));
    expect(buf.segmentStartS).toBe(startSeen);
    // Resume carries on from that frame
    buf.push(sampleAt(6 * stepS), { wallMs: 5000, playing: true, intervalS: 0.15 });
    expect(buf.displayTime(5000)).toBe(seen.timeS);
    expect(buf.displayTime(5100)).toBeGreaterThan(seen.timeS);
  });

  it("a press while the page was idle (the last frame finished before it) freezes that last frame, as before", () => {
    const buf = playing(5);
    buf.sample(780);
    buf.frameDrawn(784);
    const last = buf.sample(796)!;
    buf.frameDrawn(800);
    buf.hold(806, 803);
    expect(buf.sample(820)!.timeS).toBe(last.timeS);
  });

  it("without a press time (entering history, a restore) it freezes the last drawn frame, as before", () => {
    const buf = playing(5);
    const last = buf.sample(796)!;
    buf.hold(880);
    expect(buf.sample(900)!.timeS).toBe(last.timeS);
  });
});

describe("a display stalled at the newest state keeps its segment when a held state arrives (the trail's cut must not move after Pause)", () => {
  // At the maximum speed the backend is often slower than the display, which then stands at the newest state: its time is a segment's END.
  // The next state (held at a pause) made that same time count as the START of the new segment, so the trail's cut moved forward and the
  // recorded line was rebuilt and redrawn (measured: about 5,500 pixels changed 100 ms after the Pause handler).
  it("the same frozen time stays in the segment ending there: same cut, same head", () => {
    const stepS = 1e5;
    const buf = new MotionBuffer();
    buf.push(sampleAt(0), { wallMs: 0, flush: true });
    for (let k = 1; k <= 3; k++) buf.push(sampleAt(k * stepS), { wallMs: k * 150, playing: true, intervalS: 0.15 });
    const stalled = buf.samplePath(10000, 16)!; // long after the newest state: standing at it
    expect(stalled.timeS).toBe(3 * stepS);
    const cut = buf.segmentStartS;
    buf.hold(10010);
    buf.push(sampleAt(4 * stepS), { wallMs: 10020, playing: false, hold: true });
    const after = buf.samplePath(10030, 16)!;
    expect(after.timeS).toBe(stalled.timeS);
    expect(buf.segmentStartS).toBe(cut);
    expect(after.startS).toBe(stalled.startS);
    expect(after.paths.get("earth")).toEqual(stalled.paths.get("earth"));
  });
});

describe("MotionBuffer.heldFrameWallMs: when the frozen frame was drawn (what everything drawn while paused must match)", () => {
  it("is the frozen frame's draw time after a press, survives the effect cleanup's second hold, and clears on Resume or a flush", () => {
    const buf = new MotionBuffer();
    buf.push(sampleAt(0), { wallMs: 0, flush: true });
    for (let k = 1; k <= 5; k++) buf.push(sampleAt(k * 1e5), { wallMs: k * 150, playing: true, intervalS: 0.15 });
    expect(buf.heldFrameWallMs).toBeNull();
    buf.sample(790);
    buf.frameDrawn(797);
    buf.sample(806); // still being drawn at the press
    buf.frameDrawn(815);
    buf.hold(816, 801);
    expect(buf.heldFrameWallMs).toBe(790);
    buf.sample(830);
    buf.hold(840); // the play loop's effect cleanup
    expect(buf.heldFrameWallMs).toBe(790);
    buf.push(sampleAt(6e5), { wallMs: 850, playing: false, hold: true }); // a held state
    expect(buf.heldFrameWallMs).toBe(790);
    buf.push(sampleAt(7e5), { wallMs: 5000, playing: true, intervalS: 0.15 }); // Resume
    expect(buf.heldFrameWallMs).toBeNull();
    buf.hold(5010);
    expect(buf.heldFrameWallMs).not.toBeNull();
    buf.push(sampleAt(0), { wallMs: 5020, flush: true });
    expect(buf.heldFrameWallMs).toBeNull();
  });
});

describe("a Pause while still held (Resume pressed, no state arrived yet) changes nothing", () => {
  // Measured with rapid Pause / Resume and late backend responses: after Resume the picture stays frozen until the first state arrives; a
  // second Pause in that window chose a NEW frozen frame, so the trail switched to a version rebuilt while paused (never shown): about
  // 1,400-3,300 pixels of the trail changed after the second Pause handler, though nothing had moved.
  it("keeps the frozen frame (time, positions and heldFrameWallMs) of the first Pause", () => {
    const buf = new MotionBuffer();
    buf.push(sampleAt(0), { wallMs: 0, flush: true });
    for (let k = 1; k <= 5; k++) buf.push(sampleAt(k * 1e5), { wallMs: k * 150, playing: true, intervalS: 0.15 });
    const shown = buf.sample(790)!;
    buf.frameDrawn(797);
    buf.hold(800, 799);
    const wall = buf.heldFrameWallMs;
    for (let w = 816; w <= 900; w += 16) { buf.sample(w); buf.frameDrawn(w + 5); } // frozen frames; Resume is pressed, no state yet
    buf.hold(905, 903); // Pause again
    expect(buf.heldFrameWallMs).toBe(wall);
    const f = buf.sample(920)!;
    expect(f.timeS).toBe(shown.timeS);
    expect(f.positions.get("earth")).toEqual(shown.positions.get("earth"));
  });
});
