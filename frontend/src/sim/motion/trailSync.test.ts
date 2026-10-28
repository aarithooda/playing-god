// The live orbit must end exactly at the planet, at the same displayed instant, whatever the playback speed, response timing or Pause
// history. What is drawn is: the recorded line (the trail recorder's points up to the cut time the LAST React render used) followed by the
// per-frame head. React re-renders after the displayed segment changes, so the drawn recorded line can be several segments stale; the
// head has to bridge exactly that. A frame is "composed" here the way the layer composes it.
import { describe, expect, it } from "vitest";
import { MotionBuffer } from "./MotionBuffer";
import type { MotionSample } from "./interpolate";
import type { V3 } from "./kepler";
import { TRAIL_PIECE_RAD } from "./trail";
import { buildShownAt, trailHead, versionShownAt } from "./trailHead";

const G = 6.6743e-11;
const AU = 1.496e11;
const SUN = 1.989e30;
const EARTH = 5.972e24;

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

function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angle = (p: V3) => Math.atan2(p[1], p[0]);
const turn = (a: V3, b: V3) => Math.abs((((angle(b) - angle(a) + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);

interface Composed {
  /** every point the layer would have on screen for the body, oldest first (recorded line then head) */
  points: { t: number | null; p: V3 }[];
  planet: V3;
  planetTimeS: number;
}

/** What the screen shows at `wall`, given that the recorded line was last built with cut time `renderedCutS` (it may be stale). */
function compose(buf: MotionBuffer, renderedCutS: number | null, wall: number): Composed {
  const frame = buf.sample(wall)!; // the planet is drawn from this
  const head = trailHead(buf, "earth", renderedCutS, wall, 16, new Set(["earth"]))!;
  const recorded = buf.trail.pointsFor("earth").filter((q) => renderedCutS === null || q.t <= renderedCutS).map((q) => ({ t: q.t as number | null, p: q.p }));
  return { points: [...recorded, ...head.points.map((p) => ({ t: null, p }))], planet: frame.positions.get("earth")!, planetTimeS: frame.timeS };
}

/** The newest `n` points must form a connected path: no stretch missing (consecutive points at most one trail piece apart in angle). */
function expectConnected(points: { p: V3 }[], n: number) {
  const tail = points.slice(-n);
  for (let i = 1; i < tail.length; i++) expect(turn(tail[i - 1]!.p, tail[i]!.p)).toBeLessThanOrEqual(TRAIL_PIECE_RAD * 1.02 + 1e-9);
}

const SPEEDS = [["3.19 h/s", 3.19 * 3600], ["10.2 d/s", 10.2 * 86400], ["60 d/s", 60 * 86400]] as const;

describe("planet and orbit are one instant: the orbit ends at the planet, with no stretch missing, at any speed and any React lag", () => {
  for (const [label, simPerWallS] of SPEEDS) {
    for (const au of [0.0587, 1]) {
      it(`${label} at ${au} au, response delays, 0 to 3 segments of recorded-line staleness`, () => {
        const sys = system(au * AU);
        const stepS = simPerWallS * 0.15;
        const r = rng(Math.round(simPerWallS));
        const buf = new MotionBuffer();
        buf.trail.setWanted(new Set(["earth"]));
        buf.push(sys.at(0), { wallMs: 0, flush: true });
        let wall = 0;
        let k = 0;
        const cuts: number[] = []; // the segment start at each past frame: what React could have rendered with
        for (let frame = 0; frame < 400; frame++) {
          wall += 16;
          if (r() < 0.11) {
            k++;
            buf.push(sys.at(k * stepS), { wallMs: wall - Math.floor(r() * 12), playing: true, intervalS: 0.15 }); // variable arrival
          }
          const start = buf.segmentStartS;
          if (start !== null) cuts.push(start);
          const stale = Math.floor(r() * 4);
          const renderedCut = cuts.length > stale ? cuts[cuts.length - 1 - stale]! : null;
          if (frame < 30 || renderedCut === null) {
            buf.sample(wall);
            continue;
          }
          const c = compose(buf, renderedCut, wall);
          // the orbit's last point IS the planet, at the same displayed instant
          expect(c.points[c.points.length - 1]!.p).toEqual(c.planet);
          const head = trailHead(buf, "earth", renderedCut, wall, 16, new Set(["earth"]))!;
          expect(head.timeS).toBe(c.planetTimeS);
          // the head starts AT the last point of the drawn recorded line (a shared end point: nothing between them is undrawn)
          const recorded = buf.trail.pointsFor("earth").filter((q) => q.t <= renderedCut);
          const lineEnd = recorded[recorded.length - 1]!;
          expect(head.fromS).toBe(lineEnd.t);
          expect(head.points[0]).toEqual(lineEnd.p);
          // and the path behind it is complete back to the end of the recorded line
          expectConnected(c.points, 60);
        }
      });
    }
  }
});

describe("pause, late responses, buffer pressure, resume", () => {
  const sys = system(0.0587 * AU);
  const stepS = 13.3 * 86400 * 0.15;

  function playing(steps: number) {
    const buf = new MotionBuffer();
    buf.trail.setWanted(new Set(["earth"]));
    buf.push(sys.at(0), { wallMs: 0, flush: true });
    for (let k = 1; k <= steps; k++) buf.push(sys.at(k * stepS), { wallMs: k * 150, playing: true, intervalS: 0.15 });
    return buf;
  }
  const signature = (c: Composed) => JSON.stringify([c.planetTimeS, c.planet, c.points.length, c.points[c.points.length - 1]!.p, c.points[Math.max(0, c.points.length - 40)]!.p]);

  it("while held, the whole picture (planet, recorded line, head) is unchanged however many late steps arrive, however long", () => {
    const buf = playing(6);
    const frameWall = 6 * 150 + 60;
    const renderedCut = buf.segmentStartS!;
    compose(buf, renderedCut, frameWall); // the last frame drawn before the click
    buf.hold(frameWall + 70);
    const frozen = compose(buf, renderedCut, frameWall + 80);
    expect(frozen.points[frozen.points.length - 1]!.p).toEqual(frozen.planet);
    // look-ahead steps computed before the click, one in flight, enough to hit the buffer cap
    for (let k = 7; k <= 14; k++) buf.push(sys.at(k * stepS), { wallMs: frameWall + 100 + k, playing: false, hold: true });
    for (const later of [0, 16, 400, 5000, 600000]) expect(signature(compose(buf, renderedCut, frameWall + 100 + later))).toBe(signature(frozen));
  });

  it("resume after held states carries on from the frozen instant: the first frame equals the frozen one, then time only increases, the orbit stays connected", () => {
    const buf = playing(6);
    const w0 = 6 * 150 + 60;
    let cut = buf.segmentStartS!;
    compose(buf, cut, w0);
    buf.hold(w0 + 40);
    for (let k = 7; k <= 10; k++) buf.push(sys.at(k * stepS), { wallMs: w0 + 60, playing: false, hold: true });
    const frozen = compose(buf, cut, w0 + 70);
    const resume = w0 + 90000;
    buf.push(sys.at(11 * stepS), { wallMs: resume, playing: true, intervalS: 0.15 });
    expect(compose(buf, cut, resume).planetTimeS).toBe(frozen.planetTimeS);
    let previous = frozen.planetTimeS;
    for (let ms = 16; ms <= 3000; ms += 16) {
      cut = buf.segmentStartS!; // (React catches up some frames later; the stale case is covered above)
      const c = compose(buf, cut, resume + ms);
      expect(c.planetTimeS).toBeGreaterThanOrEqual(previous);
      previous = c.planetTimeS;
      expect(c.points[c.points.length - 1]!.p).toEqual(c.planet);
      expectConnected(c.points, 60);
    }
    expect(previous).toBeGreaterThan(frozen.planetTimeS);
  });

  it("a flush (edit, reset, restore) leaves no recorded points from before it, and the head is just the new state", () => {
    const buf = playing(6);
    const staleCut = buf.segmentStartS!;
    buf.push(sys.at(0), { wallMs: 6 * 150 + 200, flush: true });
    const c = compose(buf, null, 6 * 150 + 220);
    expect(c.points.every((q) => dist(q.p, sys.at(0).bodies[1]!.p) < 1)).toBe(true);
    expect(buf.trail.pointsFor("earth").every((q) => q.t === 0)).toBe(true);
    // a stale cut from before the flush (React has not re-rendered yet) must not drag old path back in
    const head = trailHead(buf, "earth", staleCut, 6 * 150 + 220, 16, new Set(["earth"]))!;
    expect(head.points.every((p) => dist(p, sys.at(0).bodies[1]!.p) < 1)).toBe(true);
  });

  it("a body removed from the universe has no trail head any more", () => {
    const buf = playing(3);
    const next = sys.at(4 * stepS);
    buf.push({ ...next, bodies: [next.bodies[0]!] }, { wallMs: 4 * 150, playing: true, intervalS: 0.15 });
    expect(trailHead(buf, "earth", buf.segmentStartS, 4 * 150 + 20, 16, new Set(["earth"]))).toBeNull();
  });
});

describe("while paused the recorded line is the one the frozen frame drew", () => {
  // Measured in headed Chrome at the maximum speed: a rebuild of the recorded line computed 24 ms before the press (no frame was drawn in
  // between) reached the screen only after it, and stayed: about 32,600 pixels of the trail differed from what was on screen at the press.
  const versions = [{ atMs: 100, id: "a" }, { atMs: 130, id: "b" }, { atMs: 160, id: "c" }];
  it("playing: the newest version", () => {
    expect(versionShownAt(versions, null)?.id).toBe("c");
  });
  it("held: the newest version committed before the frozen frame was drawn (a rebuild after it was not on screen at the press)", () => {
    expect(versionShownAt(versions, 150)?.id).toBe("b");
    expect(versionShownAt(versions, 130)?.id).toBe("a"); // committed at the very instant the frame was sampled: drawn by the next frame
    expect(versionShownAt(versions, 170)?.id).toBe("c");
  });
  it("held, nothing that old kept: the oldest version (closest to what was drawn)", () => {
    expect(versionShownAt(versions, 50)?.id).toBe("a");
    expect(versionShownAt([], 50)).toBeUndefined();
  });
});

describe("buildShownAt: a Pause shows exactly the build the frozen frame showed", () => {
  // Measured with rapid Pause / Resume and late responses: Resume, the first state arrives, Pause at once. The frame on screen at the press
  // was drawn while the PREVIOUS pause was still held, so it showed that pause's build, not the newest one committed before it; choosing
  // by commit time switched the trail to a build made while paused (never shown): 3,800-5,500 pixels changed after the handler.
  const a = { atMs: 100, id: "a" }, b = { atMs: 200, id: "b" }, c = { atMs: 300, id: "c" };
  it("playing: the newest committed build", () => {
    expect(buildShownAt([a, b, c], [], null)?.id).toBe("c");
  });
  it("held: the build the frozen frame showed, even when newer builds were committed before that frame", () => {
    const frames = [{ wallMs: 310, version: a }, { wallMs: 326, version: a }, { wallMs: 342, version: c }];
    expect(buildShownAt([a, b, c], frames, 326)?.id).toBe("a");
    expect(buildShownAt([a, b, c], frames, 342)?.id).toBe("c");
  });
  it("held, the frozen frame no longer remembered: the newest build committed before it", () => {
    expect(buildShownAt([a, b, c], [], 250)?.id).toBe("b");
  });
});
