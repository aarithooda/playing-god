// Regression: at high playback speed the recorded history is too sparse for a fast orbit, and a line through it is a star polygon -
// a "dense web of overlapping curves" (seen at 13.3 simulated days per second for a body at 0.0587 au stepped every 2.06 days: 143
// degrees per step). The live trail must follow the path the body takes, not the chords between samples.
import { describe, expect, it } from "vitest";
import type { PositionSample } from "../../render/contract";
import { buildTimedPolylines, liveTrailSamples, trimToLatestOrbit } from "../trajectory";
import { MAX_BUFFERED_STATES, MotionBuffer } from "./MotionBuffer";
import { evaluateSegment, planSegment, type MotionSample } from "./interpolate";
import { TRAIL_MAX_PIECES, TRAIL_MAX_POINTS, TRAIL_PIECE_RAD, segmentPieces } from "./trail";
import type { V3 } from "./kepler";

const G = 6.6743e-11;
const AU = 1.496e11;
const SUN = 1.989e30;
const EARTH = 5.972e24;

/** Sun at the origin and one body on a circular orbit of radius `r`, exact at every time. */
function system(r: number) {
  const n = Math.sqrt((G * (SUN + EARTH)) / r ** 3);
  const at = (t: number): MotionSample => {
    const a = 0.7 + n * t;
    return {
      t,
      bodies: [
        { id: "sun", massKg: SUN, p: [0, 0, 0], v: [0, 0, 0] },
        { id: "earth", massKg: EARTH, p: [r * Math.cos(a), r * Math.sin(a), 0], v: [-r * n * Math.sin(a), r * n * Math.cos(a), 0] },
      ],
    };
  };
  return { n, at, period: (2 * Math.PI) / n };
}

const metersPerUnit = { metersPerUnit: 5e9 };
const hist = (t: number, p: V3): PositionSample => ({ simulationTimeS: t, positionM: { x: p[0], y: p[1], z: p[2] }, segment: 0 });

/** The smallest distance from the origin to any SEGMENT of the polyline (a chord across a circle passes inside it). */
function minRadiusOfPolyline(points: readonly (readonly number[])[]): number {
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const d = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const len2 = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2;
    const u = len2 > 0 ? Math.min(1, Math.max(0, -(a[0]! * d[0]! + a[1]! * d[1]! + a[2]! * d[2]!) / len2)) : 0;
    min = Math.min(min, Math.hypot(a[0]! + u * d[0]!, a[1]! + u * d[1]!, a[2]! + u * d[2]!));
  }
  return min;
}

/** Plays `steps` released states `stepS` apart through a buffer and returns it with the backend-style history of the body. */
function play(r: number, stepS: number, steps: number) {
  const sys = system(r);
  const buf = new MotionBuffer();
  const history: PositionSample[] = [hist(0, sys.at(0).bodies[1]!.p)];
  buf.push(sys.at(0), { wallMs: 0, flush: true });
  for (let k = 1; k <= steps; k++) {
    buf.push(sys.at(k * stepS), { wallMs: k * 150, playing: true, intervalS: 0.15 });
    history.push(hist(k * stepS, sys.at(k * stepS).bodies[1]!.p));
  }
  return { sys, buf, history };
}

describe("the failure: recorded history alone draws chords across the orbit", () => {
  it("0.0587 au stepped every 2.06 days (143 degrees per step): the history polyline cuts straight through the orbit's interior", () => {
    const { sys, history } = play(0.0587 * AU, 2.06 * 86400, 120); // about 48 revolutions
    expect(sys.period / 86400).toBeCloseTo(5.19, 1);
    const line = buildTimedPolylines(history, metersPerUnit)[0]!;
    const trimmed = trimToLatestOrbit(line);
    // even after the latest-orbit trim, chords pass well inside the circle: the "web"
    expect(minRadiusOfPolyline(trimmed.points)).toBeLessThan(0.5 * ((0.0587 * AU) / metersPerUnit.metersPerUnit));
  });
});

describe("the fix: the live trail follows the interpolated path", () => {
  const cases = [["3.19 h/s", 3.19 * 3600], ["10.2 d/s", 10.2 * 86400], ["13.3 d/s", 13.3 * 86400], ["60 d/s", 60 * 86400]] as const;
  for (const [label, simPerWallS] of cases) {
    for (const au of [0.0587, 1]) {
      it(`${label} at ${au} au: trail points are on the orbit, pieces are small, about one revolution is kept, nothing cuts inside`, () => {
        const stepS = simPerWallS * 0.15;
        const { sys, buf, history } = play(au * AU, stepS, 200);
        const trail = buf.trail.pointsFor("earth");
        expect(trail.length).toBeGreaterThan(1);
        for (const pt of trail) expect(Math.abs(Math.hypot(pt.p[0], pt.p[1]) / (au * AU) - 1)).toBeLessThan(1e-4);
        for (let i = 1; i < trail.length; i++) expect(trail[i]!.t).toBeGreaterThan(trail[i - 1]!.t);
        // no piece spans more than the allowed angle of the orbit (unless the segment hit the piece cap)
        const piece = Math.max(TRAIL_PIECE_RAD, (sys.n * stepS) / TRAIL_MAX_PIECES);
        for (let i = 1; i < trail.length; i++) expect(sys.n * (trail[i]!.t - trail[i - 1]!.t)).toBeLessThanOrEqual(piece * 1.0001 + 1e-12);
        // the live samples the layer draws: history before the trail, then the trail, up to the displayed segment's start
        const path = buf.samplePath(200 * 150 + 75, 16)!;
        const samples = liveTrailSamples(history, trail, path.startS);
        const line = buildTimedPolylines(samples, metersPerUnit)[0]!;
        const trimmed = trimToLatestOrbit(line);
        const rUnits = (au * AU) / metersPerUnit.metersPerUnit;
        // dense enough that no chord passes meaningfully inside the circle (the sag of a TRAIL_PIECE_RAD chord is about 0.125 % of r)
        expect(minRadiusOfPolyline(trimmed.points)).toBeGreaterThan(rUnits * 0.99);
        // about one revolution is kept, never dozens
        const span = trimmed.simulationTimesS[trimmed.simulationTimesS.length - 1]! - trimmed.simulationTimesS[0]!;
        expect(span).toBeLessThanOrEqual(1.25 * sys.period + stepS);
        // the trail's last point is the state at the displayed segment's start, and the head starts exactly there
        const upTo = trail.filter((pt) => pt.t <= path.startS);
        const last = upTo[upTo.length - 1]!;
        expect(last.t).toBeCloseTo(path.startS, 6);
        const head = path.paths.get("earth")!;
        expect(Math.hypot(last.p[0] - head[0]![0], last.p[1] - head[0]![1], last.p[2] - head[0]![2])).toBeLessThan(1e-3);
      });
    }
  }

  it("the head ends at the drawn body for the same simulation time at every fraction of the segment, and is itself dense (143 degrees per step)", () => {
    const { buf } = play(0.0587 * AU, 2.06 * 86400, 30);
    for (let f = 0; f <= 20; f++) {
      const wall = 30 * 150 + f * 7.5;
      const path = buf.samplePath(wall, 16)!;
      const frame = buf.sample(wall)!;
      const head = path.paths.get("earth")!;
      expect(head[head.length - 1]).toEqual(frame.positions.get("earth"));
      for (let i = 1; i < head.length; i++) {
        const a = Math.atan2(head[i - 1]![1], head[i - 1]![0]);
        const b = Math.atan2(head[i]![1], head[i]![0]);
        const d = Math.abs(((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI); // wrapped into [0, pi]
        expect(d).toBeLessThanOrEqual(TRAIL_PIECE_RAD * 1.01 + 1e-9);
      }
    }
  });
});

describe("TrailRecorder behaviour at discontinuities and bounds", () => {
  it("a flush restarts every body's trail from the new state; a removed body loses its trail", () => {
    const sys = system(AU);
    const buf = new MotionBuffer();
    buf.push(sys.at(0), { wallMs: 0, flush: true });
    buf.push(sys.at(1e6), { wallMs: 100, playing: true, intervalS: 0.1 });
    expect(buf.trail.pointsFor("earth").length).toBeGreaterThan(1);
    buf.push(sys.at(2e6), { wallMs: 200, flush: true });
    expect(buf.trail.pointsFor("earth")).toHaveLength(1);
    const next = sys.at(3e6);
    buf.push({ ...next, bodies: [next.bodies[0]!] }, { wallMs: 300, playing: true, intervalS: 0.1 });
    expect(buf.trail.pointsFor("earth")).toHaveLength(0);
    expect(buf.trail.pointsFor("sun").length).toBeGreaterThan(0);
  });

  it("a body in a collision restarts its trail at its new state instead of drawing across the merger", () => {
    const sys = system(AU);
    const buf = new MotionBuffer();
    buf.push(sys.at(0), { wallMs: 0, flush: true });
    buf.push({ ...sys.at(1e6), cut: new Set(["earth"]) }, { wallMs: 100, playing: true, intervalS: 0.1 });
    expect(buf.trail.pointsFor("earth")).toEqual([{ t: 1e6, p: sys.at(1e6).bodies[1]!.p }]);
  });

  it("is bounded per body however long it plays, and a segment's piece count is capped", () => {
    const sys = system(0.0587 * AU);
    const buf = new MotionBuffer();
    buf.push(sys.at(0), { wallMs: 0, flush: true });
    for (let k = 1; k <= 400; k++) buf.push(sys.at(k * 1e6), { wallMs: k * 100, playing: true, intervalS: 0.1 });
    expect(buf.trail.pointsFor("earth").length).toBeLessThanOrEqual(TRAIL_MAX_POINTS);
    expect(segmentPieces(planSegment(sys.at(0), sys.at(1e9)))).toBe(TRAIL_MAX_PIECES);
  });

  it("liveTrailSamples keeps the recorded history before the trail and never draws past the cut", () => {
    const history = [0, 1, 2, 3, 4, 5].map((i) => hist(i * 10, [i, 0, 0]));
    const trail = [{ t: 30, p: [3, 0, 0] as V3 }, { t: 35, p: [3.5, 0, 0] as V3 }, { t: 40, p: [4, 0, 0] as V3 }, { t: 45, p: [4.5, 0, 0] as V3 }];
    const out = liveTrailSamples(history, trail, 40);
    expect(out.map((s) => s.simulationTimeS)).toEqual([0, 10, 20, 30, 35, 40]);
    expect(out.slice(0, 3)).toEqual(history.slice(0, 3));
    expect(liveTrailSamples(history, [], 25).map((s) => s.simulationTimeS)).toEqual([0, 10, 20]);
  });
});

describe("maximum speed: only the trails that are drawn cost time, and the result is unchanged", () => {
  // a planet with a fast moon: the moon's orbit would force very fine pieces on every body if it were counted
  const G2 = 6.6743e-11;
  const sys = (t: number): MotionSample => {
    const a = 0.3 + (2 * Math.PI * t) / (365.25 * 86400);
    const earthP: V3 = [AU * Math.cos(a), AU * Math.sin(a), 0];
    const ne = (2 * Math.PI) / (365.25 * 86400);
    const earthV: V3 = [-AU * ne * Math.sin(a), AU * ne * Math.cos(a), 0];
    const rm = 3.844e8;
    const nm = Math.sqrt((G2 * (EARTH + 7.342e22)) / rm ** 3);
    const b = 1.1 + nm * t;
    return {
      t,
      bodies: [
        { id: "sun", massKg: SUN, p: [0, 0, 0], v: [0, 0, 0] },
        { id: "earth", massKg: EARTH, p: earthP, v: earthV },
        { id: "moon", massKg: 7.342e22, p: [earthP[0] + rm * Math.cos(b), earthP[1] + rm * Math.sin(b), 0], v: [earthV[0] - rm * nm * Math.sin(b), earthV[1] + rm * nm * Math.cos(b), 0] },
      ],
    };
  };
  const plan = planSegment(sys(0), sys(1e7)); // the maximum step (115.7 days)

  it("a fast moon nobody draws a trail for does not make the planet's pieces finer", () => {
    expect(segmentPieces(plan)).toBeGreaterThan(200); // the moon: ~4 revolutions per step
    expect(segmentPieces(plan, new Set(["earth"]))).toBeLessThan(40); // the planet: about 2 radians per step
  });

  it("evaluating only the wanted bodies gives exactly the values of a full evaluation (the host chain is included)", () => {
    for (const f of [0, 0.13, 0.5, 0.97, 1]) {
      const full = evaluateSegment(plan, f * 1e7);
      const some = evaluateSegment(plan, f * 1e7, new Set(["moon"]));
      expect(some.get("moon")).toEqual(full.get("moon"));
      expect(some.get("earth")).toEqual(full.get("earth")); // its host is computed too
      expect(evaluateSegment(plan, f * 1e7, new Set(["earth"])).has("moon")).toBe(false);
    }
  });

  it("the recorder records only wanted bodies, keeps what it has when the wanted set shrinks, and records a newly wanted body from the next segment's start", () => {
    const buf = new MotionBuffer();
    buf.trail.setWanted(new Set(["earth"]));
    buf.push(sys(0), { wallMs: 0, flush: true });
    buf.push(sys(1e7), { wallMs: 150, playing: true, intervalS: 0.15 });
    expect(buf.trail.pointsFor("moon")).toHaveLength(0);
    const earthCount = buf.trail.pointsFor("earth").length;
    expect(earthCount).toBeGreaterThan(2);
    expect(earthCount).toBeLessThan(45);
    buf.trail.setWanted(new Set(["earth", "moon"]));
    expect(buf.trail.pointsFor("moon")).toHaveLength(0);
    buf.push(sys(2e7), { wallMs: 300, playing: true, intervalS: 0.15 });
    // (this asserted a single point at the step's END before: that was BUG 1, the segment the body had just travelled was left out)
    const moon = buf.trail.pointsFor("moon");
    expect(moon[0]!.t).toBe(1e7);
    expect(moon[moon.length - 1]!.t).toBe(2e7);
    expect(moon.length).toBeGreaterThan(100); // dense: about 4 revolutions in the step
    expect(buf.trail.pointsFor("earth").length).toBeGreaterThan(earthCount);
    buf.trail.setWanted(new Set(["moon"]));
    expect(buf.trail.pointsFor("earth")).toHaveLength(0);
  });

  it("the head for a wanted body at the maximum step is dense and ends at the drawn body", () => {
    const buf = new MotionBuffer();
    buf.push(sys(0), { wallMs: 0, flush: true });
    buf.push(sys(1e7), { wallMs: 150, playing: true, intervalS: 0.15 });
    const wanted = new Set(["earth"]);
    const path = buf.samplePath(150 + 100, 16, wanted)!;
    const frame = buf.sample(150 + 100)!;
    expect([...path.paths.keys()]).toEqual(["earth"]);
    const head = path.paths.get("earth")!;
    expect(head[head.length - 1]).toEqual(frame.positions.get("earth"));
    expect(head.length).toBeGreaterThanOrEqual(16);
  });
});

describe("BUG 1 (first Play after creating a body): the trail starts at the state the body was created in, not one step later", () => {
  // Reproduced in a browser: the Sun exists, Earth is created in the UI (0.0587 au, orbit the star), Play is pressed. Earth had no trail
  // yet when the create refresh restarted the recorder (its history was not loaded, so it was not among the drawn trails), and when it
  // became wanted the first released step started its trail at that step's END: the recorded line then went from the history sample at
  // t = 0 straight to the first trail point, a 54 degree chord (0.936 rad between consecutive drawn points, the limit is 0.1).
  const r = 0.0587 * AU;
  const sys = system(r);
  const stepS = 316227.766;

  it("a body that becomes wanted is recorded from the segment's start, densely, so the drawn line from t = 0 is connected", () => {
    const buf = new MotionBuffer();
    buf.trail.setWanted(new Set(["sun"])); // Earth's trajectory does not exist yet
    buf.push(sys.at(0), { wallMs: 0, flush: true }); // the refresh after the create
    buf.trail.setWanted(new Set(["sun", "earth"])); // its history arrives: now it is drawn
    buf.push(sys.at(stepS), { wallMs: 150, playing: true, intervalS: 0.15 }); // the first released step of the first Play
    const trail = buf.trail.pointsFor("earth");
    expect(trail[0]!.t).toBe(0);
    expect(trail[0]!.p).toEqual(sys.at(0).bodies[1]!.p);
    // the line the layer draws: history (t = 0, t = stepS) before the trail, then the trail
    const history = [hist(0, sys.at(0).bodies[1]!.p), hist(stepS, sys.at(stepS).bodies[1]!.p)];
    const samples = liveTrailSamples(history, trail, stepS);
    for (let i = 1; i < samples.length; i++) {
      const a = Math.atan2(samples[i - 1]!.positionM.y, samples[i - 1]!.positionM.x);
      const b = Math.atan2(samples[i]!.positionM.y, samples[i]!.positionM.x);
      const d = Math.abs((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
      expect(d).toBeLessThanOrEqual(TRAIL_PIECE_RAD * 1.01);
    }
  });

  it("the same when the wanted set was briefly empty (all trails dropped) and is restored", () => {
    const buf = new MotionBuffer();
    buf.push(sys.at(0), { wallMs: 0, flush: true });
    buf.trail.setWanted(new Set());
    buf.trail.setWanted(new Set(["earth"]));
    buf.push(sys.at(stepS), { wallMs: 150, playing: true, intervalS: 0.15 });
    const trail = buf.trail.pointsFor("earth");
    expect(trail[0]!.t).toBe(0);
    expect(trail.length).toBeGreaterThan(2);
  });

  it("a body that is NEW in a step (created between states) or cut by a collision still starts at its new state (nothing to interpolate)", () => {
    const buf = new MotionBuffer();
    const s0 = sys.at(0);
    buf.push({ ...s0, bodies: [s0.bodies[0]!] }, { wallMs: 0, flush: true }); // only the Sun
    buf.push(sys.at(stepS), { wallMs: 150, playing: true, intervalS: 0.15 });
    expect(buf.trail.pointsFor("earth")).toEqual([{ t: stepS, p: sys.at(stepS).bodies[1]!.p }]);
    buf.push({ ...sys.at(2 * stepS), cut: new Set(["earth"]) }, { wallMs: 300, playing: true, intervalS: 0.15 });
    expect(buf.trail.pointsFor("earth")).toEqual([{ t: 2 * stepS, p: sys.at(2 * stepS).bodies[1]!.p }]);
  });
});

describe("Pause: the steps held at a pause never change the drawn trail", () => {
  // Measured in headed Chrome at the maximum speed (a body at 0.04 au, 1e7 s per step: 720 trail pieces per step): the held look-ahead steps
  // pushed the recorder past TRAIL_MAX_POINTS and its trim dropped the OLDEST points, which were the ones drawn up to the displayed segment's
  // start; the recorded line was then rebuilt from the sparse history and changed on screen, 25-180 ms after the Pause handler had run.
  it("held pushes keep every recorded point up to the displayed segment's start, and Resume trims only points not drawn", () => {
    const { sys, buf } = play(0.04 * AU, 1e7, 6);
    buf.sample(6 * 150 + 75);
    const cut = buf.segmentStartS!;
    const drawn = buf.trail.pointsFor("earth").filter((p) => p.t <= cut);
    expect(drawn.length).toBeGreaterThan(2 * TRAIL_MAX_PIECES);
    buf.hold(6 * 150 + 80);
    for (let k = 7; k <= 10; k++) buf.push(sys.at(k * 1e7), { wallMs: 6 * 150 + 80 + k, playing: false, hold: true });
    expect(buf.trail.pointsFor("earth").filter((p) => p.t <= cut)).toEqual(drawn);
    // Resume: the display moves on and the recorder is bounded again, but never by dropping what the displayed segment still needs
    let wall = 60000;
    for (let k = 11; k <= 30; k++) {
      buf.push(sys.at(k * 1e7), { wallMs: wall, playing: true, intervalS: 0.15 });
      buf.sample(wall + 75);
      const start = buf.segmentStartS!;
      const pts = buf.trail.pointsFor("earth");
      expect(pts.filter((p) => p.t < start).length).toBeGreaterThanOrEqual(Math.min(2 * TRAIL_MAX_PIECES, Math.floor(TRAIL_MAX_POINTS * 0.9))); // the drawn line keeps its past
      wall += 150;
    }
    expect(buf.trail.pointsFor("earth").length).toBeLessThanOrEqual(TRAIL_MAX_POINTS + MAX_BUFFERED_STATES * TRAIL_MAX_PIECES);
  });
});
