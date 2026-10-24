import { describe, expect, it } from "vitest";
import { parseVisualEvent } from "../../api/parse";
import type { VisualEventDto } from "../../api/types";
import { allocate, MAX_PARTICLES, MAX_SIMULTANEOUS_EVENTS, tierFor } from "./effectBudget";
import { hashId, rng, sampleParcel } from "./debrisSampling";
import {
  effectAt, flashRemaining01, hasPhase, newFlashClock, stepFlashClock, type BodyPoint, type ClockInput, type FlashClock,
} from "./effectTimeline";
import { appearanceStyle, DEFAULT_APPEARANCE } from "./materialAppearance";
import { isUnitQuaternion, localToMesh, rotate, sceneQuaternion } from "./orientation";

const raw = {
  eventId: "col-1", outcome: "catastrophic_disruption", timeS: 1000,
  impactSite: { bodyId: "t", centerLocal: { x: 0, y: 0, z: -1 }, centerWorldAtContactM: { x: 5, y: 6, z: 7 }, normalWorld: { x: 0, y: 0, z: -1 } },
  phases: [
    { name: "contact", startS: 1000, endS: 1001, basis: "simulation-time" },
    { name: "flash", startS: 1000, endS: null, basis: "visual-wall-clock", durationWallS: 0.8 },
    { name: "ejecta", startS: 1000, endS: null, basis: "simulation-time" },
    { name: "separation", startS: 1000, endS: null, basis: "simulation-time" },
    { name: "cloud-expansion", startS: 1000, endS: null, basis: "simulation-time" },
    { name: "aftermath", startS: 1001, endS: null, basis: "simulation-time" },
  ],
  ejectaSources: [{}], fragmentBodyIds: ["f0"], debrisParcelIds: ["p0", "p1"],
  cloud: { initialRadiusM: 1e6, expansionSpeedMPerS: 100, materialAppearance: "rock" },
  visualOnly: [{ kind: "flash", intensity: 0.7, lifetimeWallS: 0.8 }], materialAppearance: { t: "rock" },
  fidelityNotes: ["The flash is a visual-only effect with no physical meaning"],
};
const visual: VisualEventDto = parseVisualEvent(raw);
const bodies = new Map<string, BodyPoint>([
  ["p0", { id: "p0", positionM: { x: 1e7, y: 0, z: 0 }, radiusM: 1e5 }],
  ["p1", { id: "p1", positionM: { x: -1e7, y: 0, z: 0 }, radiusM: 2e5 }],
]);
const ctx = (displayTimeS: number, particleBudget = 100) => ({ universeId: "uni-1", displayTimeS, bodies, particleBudget });
const input = (over: Partial<ClockInput> & { displayTimeS: number }): ClockInput => ({ wallDeltaS: 0.1, seeked: false, advancing: true, ...over });

function run(clock: FlashClock, steps: ClockInput[]): FlashClock {
  return steps.reduce((c, s) => stepFlashClock(c, visual.timeS, s), clock);
}

describe("the visual description", () => {
  it("parses and has no mass anywhere on the visual-only effect", () => {
    expect(visual.visualOnly[0]).toEqual({ kind: "flash", intensity: 0.7, lifetimeWallS: 0.8 });
    expect("massKg" in visual.visualOnly[0]!).toBe(false);
    expect(() => parseVisualEvent({ ...raw, visualOnly: [{ ...raw.visualOnly[0], massKg: 5 }] })).toThrow(/no mass/);
    expect(() => parseVisualEvent({ ...raw, phases: [{ name: "explosion", startS: 0, endS: null, basis: "simulation-time" }] })).toThrow(/phases\[0\]\.name/);
    expect(() => parseVisualEvent({ ...raw, phases: [{ name: "contact", startS: 0, endS: null, basis: "clock" }] })).toThrow(/basis/);
  });
});

describe("mass-bearing effects follow the displayed simulation time only (DQ-12 a)", () => {
  it("shows nothing before the event: a seek back replays it", () => {
    expect(effectAt(visual, newFlashClock(0.8), ctx(999))).toBeNull();
    expect(effectAt(visual, newFlashClock(0.8), ctx(1000))).not.toBeNull();
  });

  it("is a pure function of the displayed time: pause (same time) gives the identical state, whatever the wall clock did", () => {
    const a = effectAt(visual, undefined, ctx(1500));
    const b = effectAt(visual, undefined, ctx(1500));
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("follows the time scale: the cloud radius depends on the displayed time, not on how fast it got there", () => {
    const r = (t: number) => effectAt(visual, undefined, ctx(t))!.cloud!.radiusM;
    expect(r(1000)).toBe(1e6);
    expect(r(1200)).toBe(1e6 + 100 * 200);
    expect(r(2000) - r(1000)).toBe(r(3000) - r(2000)); // linear in displayed time
    const o = (t: number) => effectAt(visual, undefined, ctx(t))!.cloud!.opacity;
    expect(o(5000)).toBeLessThan(o(1000)); // thins out as it spreads
  });

  it("replays with a history seek: going back and forward gives the same state at the same time", () => {
    const at = effectAt(visual, undefined, ctx(1800));
    effectAt(visual, undefined, ctx(900)); // seek back before the event
    expect(effectAt(visual, undefined, ctx(1800))).toEqual(at);
  });

  it("cloud and samples exist only for the phases the description lists (a cratering description shows no disruption phases)", () => {
    const crater: VisualEventDto = {
      ...visual, outcome: "cratering", cloud: null, debrisParcelIds: [],
      phases: visual.phases.filter((p) => !["separation", "cloud-expansion"].includes(p.name)).concat([{ name: "cratering", startS: 1000, endS: null, basis: "simulation-time" }]),
    };
    const e = effectAt(crater, undefined, ctx(1500))!;
    expect(hasPhase(crater, "separation")).toBe(false);
    expect(hasPhase(crater, "cloud-expansion")).toBe(false);
    expect(e.cloud).toBeUndefined();
    expect(e.particles).toEqual([]);
  });

  it("draws samples only for parcels that exist at the displayed time", () => {
    const missing = new Map(bodies);
    missing.delete("p1");
    const e = effectAt(visual, undefined, { universeId: "u", displayTimeS: 1500, bodies: missing, particleBudget: 100 })!;
    expect(e.particles.length).toBe(50); // 100 / 2 parcels, only p0 present
    expect(e.particles.every((p) => p.x > 0)).toBe(true);
  });
});

describe("the flash is visual only (DQ-12 a)", () => {
  const fresh = newFlashClock(0.8);

  it("ages with the wall clock only while the display is advancing", () => {
    const a = run(fresh, [input({ displayTimeS: 1000, seeked: true }), input({ displayTimeS: 1010 }), input({ displayTimeS: 1020 })]);
    expect(a.ageWallS).toBeCloseTo(0.2, 12);
    expect(flashRemaining01(a)).toBeCloseTo(0.75, 12);
  });

  it("its remaining life is unchanged across a pause of any length", () => {
    const before = run(fresh, [input({ displayTimeS: 1000, seeked: true }), input({ displayTimeS: 1010 })]);
    for (const pauseS of [0.01, 1, 30, 3600, 1e6]) {
      const paused = stepFlashClock(before, visual.timeS, input({ displayTimeS: 1010, advancing: false, wallDeltaS: pauseS }));
      expect(paused.ageWallS).toBe(before.ageWallS);
      expect(flashRemaining01(paused)).toBe(flashRemaining01(before));
    }
    // resuming continues from where it was (the pause is not counted)
    const resumed = stepFlashClock(before, visual.timeS, input({ displayTimeS: 1020, wallDeltaS: 0.1 }));
    expect(resumed.ageWallS).toBeCloseTo(before.ageWallS + 0.1, 12);
  });

  it("a seek back across the event restarts it", () => {
    const spent = run(fresh, [input({ displayTimeS: 1000, seeked: true }), ...Array.from({ length: 20 }, (_, i) => input({ displayTimeS: 1001 + i }))]);
    expect(flashRemaining01(spent)).toBe(0);
    const back = stepFlashClock(spent, visual.timeS, input({ displayTimeS: 500, seeked: true }));
    expect(back.ageWallS).toBe(0);
    expect(effectAt(visual, back, ctx(500))).toBeNull(); // before the event nothing is drawn
    const again = run(back, [input({ displayTimeS: 1000 }), input({ displayTimeS: 1001 })]);
    expect(again.ageWallS).toBeCloseTo(0.2, 12); // it plays again from the start as the view crosses the event, not from where it ended
  });

  it("a seek forward past the event shows no flash", () => {
    const past = stepFlashClock(fresh, visual.timeS, input({ displayTimeS: 5000, seeked: true }));
    expect(flashRemaining01(past)).toBe(0);
    expect(effectAt(visual, past, ctx(5000))!.flash).toBeUndefined();
    expect(effectAt(visual, past, ctx(5000))!.cloud).toBeDefined(); // the material effects are still there
  });

  it("never outlives its lifetime and never goes negative", () => {
    const c = run(fresh, [input({ displayTimeS: 1000, seeked: true }), ...Array.from({ length: 50 }, (_, i) => input({ displayTimeS: 1001 + i, wallDeltaS: 5 }))]);
    expect(c.ageWallS).toBe(0.8);
    expect(flashRemaining01(c)).toBe(0);
    expect(stepFlashClock(fresh, visual.timeS, input({ displayTimeS: 1000, seeked: true, wallDeltaS: -3 })).ageWallS).toBe(0);
  });

  it("the effect input carries no mass and the flash toggles nothing else", () => {
    const e = effectAt(visual, { ageWallS: 0.2, lifetimeWallS: 0.8, lastDisplayTimeS: 1000 }, ctx(1100))!;
    expect(e.flash).toEqual({ intensity: 0.7, remaining01: 0.75 });
    expect(JSON.stringify(e)).not.toMatch(/mass/i);
    const without = effectAt(visual, undefined, ctx(1100))!;
    expect({ ...e, flash: undefined }).toEqual({ ...without, flash: undefined }); // the flash changes nothing about the material effects
  });
});

describe("debris samples", () => {
  it("are deterministic per parcel id and different between ids", () => {
    const a = sampleParcel("debris-1-0", { x: 0, y: 0, z: 0 }, 100, 50);
    expect(sampleParcel("debris-1-0", { x: 0, y: 0, z: 0 }, 100, 50)).toEqual(a);
    expect(sampleParcel("debris-1-1", { x: 0, y: 0, z: 0 }, 100, 50)).not.toEqual(a);
    expect(hashId("a")).not.toBe(hashId("b"));
    const g = rng(7);
    expect(g()).not.toBe(g());
  });

  it("lie inside the parcel's sphere around its current position and move with it", () => {
    const centre = { x: 10, y: -20, z: 5 };
    const pts = sampleParcel("p", centre, 3, 500);
    expect(pts.every((p) => Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z) <= 3 + 1e-12)).toBe(true);
    const moved = sampleParcel("p", { x: 110, y: -20, z: 5 }, 3, 500);
    moved.forEach((p, i) => expect(p.x - 100).toBeCloseTo(pts[i]!.x, 9)); // same offsets: only the centre differs
  });
});

describe("effect budget", () => {
  it("draws at most 8 simultaneous events (newest first) and at most 20,000 samples", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `col-${i + 1}`);
    const a = allocate(ids);
    expect(a.events).toHaveLength(MAX_SIMULTANEOUS_EVENTS);
    expect(a.events[0]).toBe("col-20");
    expect(a.dropped).toHaveLength(12);
    expect(a.events.length * a.particlesPerEvent).toBeLessThanOrEqual(MAX_PARTICLES);
  });

  it("level of detail only ever reduces visual samples", () => {
    expect([1, 3, 6, 8].map(tierFor)).toEqual([0, 1, 2, 3]);
    const per = [1, 3, 6, 8].map((n) => allocate(Array.from({ length: n }, (_, i) => `e${i}`)).particlesPerEvent);
    expect(per).toEqual([...per].sort((x, y) => y - x));
    expect(per[3]).toBe(0);
    expect(allocate([]).particlesPerEvent).toBe(0);
  });

  it("never changes any number of the effect other than the sample count", () => {
    const strip = (e: ReturnType<typeof effectAt>) => ({ ...e!, particles: undefined });
    const rich = effectAt(visual, undefined, ctx(1500, 4000))!;
    const poor = effectAt(visual, undefined, ctx(1500, 0))!;
    expect(strip(poor)).toEqual(strip(rich));
    expect(poor.particles).toHaveLength(0);
  });
});

describe("appearance and orientation", () => {
  it("maps appearances and falls back for an unknown one", () => {
    expect(appearanceStyle("ice").colorHex).toBe("#d9eefc");
    expect(appearanceStyle("plasma")).toBe(DEFAULT_APPEARANCE);
    expect(appearanceStyle(undefined)).toBe(DEFAULT_APPEARANCE);
  });

  it("validates a unit quaternion before it is applied", () => {
    expect(isUnitQuaternion([1, 0, 0, 0])).toBe(true);
    expect(isUnitQuaternion([2, 0, 0, 0])).toBe(false);
    expect(isUnitQuaternion([1, 0, 0])).toBe(false);
    expect(isUnitQuaternion([Number.NaN, 0, 0, 0])).toBe(false);
    expect(isUnitQuaternion(undefined)).toBe(false);
  });

  it("an identity orientation leaves a mark where the mapping of the frames puts it", () => {
    const q = sceneQuaternion([1, 0, 0, 0]);
    expect(q.slice(0, 3).map((c) => Math.abs(c))).toEqual([0, 0, 0]);
    expect(q[3]).toBeCloseTo(1, 12);
    const mark = localToMesh([0, 0, -1]); // the south pole of the body (local -z) is mesh -y ... (x, z, -y) of the scene
    expect(mark).toEqual([0, -1, -0]);
  });

  it("a rotation about the spin axis carries a body-local mark to the world direction the simulation frame says (1e-12)", () => {
    // body-local direction l, simulation orientation = rotation by angle a about sim z: world_sim = Rz(a) l
    const a = 0.7;
    const q: [number, number, number, number] = [Math.cos(a / 2), 0, 0, Math.sin(a / 2)];
    const l: [number, number, number] = [1, 0.2, 0.3];
    const worldSim: [number, number, number] = [Math.cos(a) * l[0] - Math.sin(a) * l[1], Math.sin(a) * l[0] + Math.cos(a) * l[1], l[2]];
    const expected = localToMesh(worldSim); // simulation direction in scene axes
    const drawn = rotate(sceneQuaternion(q), localToMesh(l));
    for (let i = 0; i < 3; i += 1) expect(drawn[i]).toBeCloseTo(expected[i]!, 12);
  });
});
