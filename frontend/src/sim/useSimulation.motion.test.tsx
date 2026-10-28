import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { earth, fakeClient, mergerEvent, state, stepResponse, sun } from "../test/fixtures";
import type { ApiClient } from "../api/client";
import { LOOKAHEAD_STEPS, useSimulation } from "./useSimulation";
import { MAX_BUFFERED_STATES } from "./motion/MotionBuffer";

const opts = { tickMs: 100, healthPollMs: 1_000_000 };
const movedEarth = (t: number) => ({ ...earth, positionM: { x: 1.496e11, y: 29780 * t, z: 0 } });

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
/** Fake timers that also fake performance.now(), so the motion buffer's wall clock moves with the test's clock like it does in the app. */
function fakeWallClock() {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "Date", "performance"] });
}
function setup(overrides: Partial<ApiClient> = {}) {
  const client = fakeClient(overrides);
  return renderHook(() => useSimulation(client, opts));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useSimulation feeds the motion buffer", () => {
  it("starts it from the loaded state alone (nothing to interpolate towards yet)", async () => {
    const { result } = setup();
    await flush();
    expect(result.current.motion.size).toBe(1);
    expect(result.current.motion.latestTimeS).toBe(0);
  });

  it("treats a step as the continuation of the previous state and plays it forward over a short time", async () => {
    let t = 0;
    const { result } = setup({ step: async () => { t += 1e6; return stepResponse([sun, movedEarth(t)], t); } });
    await flush();
    await act(async () => { await result.current.stepOnce(); });
    expect(result.current.motion.size).toBe(2);
    expect(result.current.motion.latestTimeS).toBe(1e6);
    const wall = performance.now();
    expect(result.current.motion.displayTime(wall)).toBeLessThan(5e4); // (a few ms of fake time may have passed) still showing the previous state: the step is replayed, not jumped to
    expect(result.current.motion.displayTime(wall + 1100)).toBe(1e6); // (the wall clock is real here: look ahead instead of waiting)
    expect(result.current.sim?.simulationTimeS).toBe(1e6); // the authoritative state is the latest one, immediately
  });

  it("drops the buffered past on an edit, a create, a delete and a reset (a discontinuity is never interpolated across)", async () => {
    let t = 0;
    const { result } = setup({ step: async () => { t += 1e5; return stepResponse([sun, movedEarth(t)], t); }, getState: async () => state([sun, movedEarth(t)], t) });
    await flush();
    await act(async () => { await result.current.stepOnce(); });
    expect(result.current.motion.size).toBe(2);
    await act(async () => { await result.current.updateBody(earth.id, { name: "Terra" }); });
    expect(result.current.motion.size).toBe(1);
    await act(async () => { await result.current.stepOnce(); });
    expect(result.current.motion.size).toBe(2);
    await act(async () => { await result.current.deleteBody(earth.id); });
    expect(result.current.motion.size).toBe(1);
    await act(async () => { await result.current.stepOnce(); });
    await act(async () => { await result.current.reset(); });
    expect(result.current.motion.size).toBe(1);
    expect(result.current.motion.latestTimeS).toBe(0);
  });

  it("shows a body that took part in a collision at its new state immediately instead of interpolating it", async () => {
    let t = 0;
    const { result } = setup({
      step: async () => { t += 1e6; return stepResponse([sun, { ...movedEarth(t), positionM: { x: 5, y: 6, z: 7 } }], t, [{ ...mergerEvent, bodyIds: [earth.id, "gone"], resultBodyId: earth.id }]); },
    });
    await flush();
    await act(async () => { await result.current.stepOnce(); });
    const mid = result.current.motion.sample(performance.now() + 300)!;
    expect(mid.timeS).toBeGreaterThan(0);
    expect(mid.timeS).toBeLessThan(1e6);
    expect(mid.positions.get(earth.id)).toEqual([5, 6, 7]);
  });
});

describe("useSimulation: the Play loop produces, the motion buffer draws", () => {
  it("releases the lookahead states at the tick cadence and feeds each to the buffer; sim is the latest released state", async () => {
    let t = 0;
    const step = vi.fn(async (dt: number) => { t += dt; return stepResponse([sun, movedEarth(t)], t); });
    const { result } = setup({ step });
    await flush();
    act(() => result.current.play());
    await advance(1000);
    expect(result.current.sim?.simulationTimeS).toBe(result.current.motion.latestTimeS);
    expect(result.current.sim!.simulationTimeS).toBeGreaterThan(0);
    // the backend is at most LOOKAHEAD_STEPS ahead of what has been released
    const stepS = 1e5;
    expect(t - result.current.sim!.simulationTimeS).toBeLessThanOrEqual(LOOKAHEAD_STEPS * stepS);
    // the buffer stays bounded however long it plays
    await advance(20_000);
    expect(result.current.motion.size).toBeLessThanOrEqual(MAX_BUFFERED_STATES);
  });

  it("drawing never asks the backend for anything: sampling the buffer many times makes no request", async () => {
    let t = 0;
    const step = vi.fn(async (dt: number) => { t += dt; return stepResponse([sun, movedEarth(t)], t); });
    const getState = vi.fn(async () => state([sun, movedEarth(t)], t));
    const { result } = setup({ step, getState });
    await flush();
    await act(async () => { await result.current.stepOnce(); });
    const before = { step: step.mock.calls.length, state: getState.mock.calls.length };
    for (let i = 0; i < 2000; i++) result.current.motion.sample(performance.now() + i);
    expect(step.mock.calls.length).toBe(before.step);
    expect(getState.mock.calls.length).toBe(before.state);
  });

  it("a body deleted while playing never reappears from a lookahead step computed before the delete", async () => {
    let t = 0;
    let deleted = false;
    const bodies = () => (deleted ? [sun] : [sun, movedEarth(t)]);
    const { result } = setup({
      step: async (dt: number) => { t += dt; return stepResponse(bodies(), t); },
      getState: async () => state(bodies(), t),
      deleteBody: async () => { deleted = true; },
    });
    await flush();
    act(() => result.current.play());
    await advance(450); // the lookahead is full of steps that still contain Earth
    expect(result.current.sim!.bodies.some((b) => b.id === earth.id)).toBe(true);
    await act(async () => { await result.current.deleteBody(earth.id); });
    for (let i = 0; i < 12; i++) {
      await advance(100);
      expect(result.current.sim!.bodies.some((b) => b.id === earth.id)).toBe(false);
    }
  });

  it("an edit while playing discards the unshown lookahead but keeps the events it contained", async () => {
    let t = 0;
    let n = 0;
    const { result } = setup({
      step: async (dt: number) => { t += dt; n += 1; return stepResponse([sun, movedEarth(t)], t, n === 3 ? [{ ...mergerEvent, id: "evt-lookahead" }] : []); },
      getState: async () => state([sun, movedEarth(t)], t),
    });
    await flush();
    act(() => result.current.play());
    await advance(10); // fetched ahead, only the first released
    await act(async () => { await result.current.updateBody(earth.id, { name: "Terra" }); });
    await advance(1000);
    expect(result.current.events.map((e) => e.id)).toContain("evt-lookahead");
    expect(result.current.sim!.simulationTimeS).toBe(result.current.motion.latestTimeS);
  });

  it("pause keeps the dense trail: the already-computed steps are held in the buffer, not restarted", async () => {
    let t = 0;
    const G = 6.6743e-11;
    const r = 0.0587 * 1.496e11;
    const n = Math.sqrt((G * (sun.massKg + earth.massKg)) / r ** 3);
    const orbit = (time: number) => {
      const a = n * time;
      return { ...earth, positionM: { x: r * Math.cos(a), y: r * Math.sin(a), z: 0 }, velocityMPerS: { x: -r * n * Math.sin(a), y: r * n * Math.cos(a), z: 0 } };
    };
    const step = async (dt: number) => { t += dt; return stepResponse([sun, orbit(t)], t); };
    const { result } = setup({ step, getState: async () => state([sun, orbit(t)], t) });
    await flush();
    act(() => result.current.play());
    await advance(900);
    const before = result.current.motion.trail.pointsFor(earth.id);
    expect(before.length).toBeGreaterThan(10);
    const firstT = before[0]!.t;
    act(() => result.current.pause());
    await advance(0);
    const after = result.current.motion.trail.pointsFor(earth.id);
    // not restarted by the pause (a restart left one point and sent the layer back to the sparse recorded history: a distorted orbit)
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    expect(after[0]!.t).toBe(firstT);
    for (let i = 1; i < after.length; i++) expect(after[i]!.t).toBeGreaterThan(after[i - 1]!.t);
    // the held steps are in the trail too (they are behind the frozen picture; the layer clips the drawn trail to the displayed segment)
    expect(after[after.length - 1]!.t).toBe(result.current.motion.latestTimeS);
    // paused: the trail and the head do not change while time passes
    const frozen = result.current.motion.trail.pointsFor(earth.id).length;
    const path1 = result.current.motion.samplePath(performance.now() + 5000, 16)!;
    await advance(3000);
    const path2 = result.current.motion.samplePath(performance.now() + 5000, 16)!;
    expect(result.current.motion.trail.pointsFor(earth.id)).toHaveLength(frozen);
    expect(path2.startS).toBe(path1.startS);
    expect(path2.paths.get(earth.id)).toEqual(path1.paths.get(earth.id));
  });

  it("pause freezes the displayed state at once: neither the time nor the positions advance afterwards, and the unshown look-ahead is not played", async () => {
    fakeWallClock();
    let t = 0;
    const { result } = setup({ step: async (dt: number) => { t += dt; return stepResponse([sun, movedEarth(t)], t); }, getState: async () => state([sun, movedEarth(t)], t) });
    await flush();
    act(() => result.current.play());
    await advance(900);
    const simBefore = result.current.sim!.simulationTimeS;
    act(() => result.current.pause());
    await advance(0);
    const m = result.current.motion;
    const now = performance.now();
    const frozen = m.sample(now)!;
    expect(frozen.timeS).toBeLessThan(m.latestTimeS!); // computed-but-unshown look-ahead states exist and are NOT being played
    for (const later of [50, 500, 5000, 60000]) {
      const s2 = m.sample(now + later)!;
      expect(s2.timeS).toBe(frozen.timeS);
      expect(s2.positions.get(earth.id)).toEqual(frozen.positions.get(earth.id));
    }
    // the readout (sim) does not jump to the backend's look-ahead state either
    await advance(3000);
    expect(result.current.sim!.simulationTimeS).toBe(simBefore);
  });

  it("the picture is frozen by the Pause CLICK itself, not by the later React effect cleanup (the real bug: it kept moving until then)", async () => {
    fakeWallClock();
    let t = 0;
    const { result } = setup({ step: async (dt: number) => { t += dt; return stepResponse([sun, movedEarth(t)], t); }, getState: async () => state([sun, movedEarth(t)], t) });
    await flush();
    act(() => result.current.play());
    await advance(900);
    const m = result.current.motion;
    const w = performance.now();
    expect(m.sample(w + 100)!.timeS).toBeGreaterThan(m.sample(w)!.timeS); // it is moving
    // Press Pause WITHOUT letting React re-render or run effects (as in the browser, where that happens tens of milliseconds later)
    result.current.pause();
    const frozen = m.sample(w)!;
    for (const later of [1, 20, 80, 500, 5000]) {
      const f = m.sample(w + later)!;
      expect(f.timeS).toBe(frozen.timeS);
      expect(f.positions.get(earth.id)).toEqual(frozen.positions.get(earth.id));
    }
    // and nothing released by the still-running tick in that window moves it again
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(m.sample(performance.now() + 1000)!.timeS).toBe(m.sample(performance.now())!.timeS);
    expect(result.current.playing).toBe(false);
  });

  it("a step released between the physical press and the Pause handler is not shown: the clock keeps the time on screen at the press", async () => {
    // Measured in headed Chrome: the Play loop's release timer ran 0.3 ms after the press and before the browser dispatched it, and the clock
    // then changed after the Pause handler had run.
    fakeWallClock();
    let t = 0;
    const { result } = setup({ step: async (dt: number) => { t += dt; return stepResponse([sun, movedEarth(t)], t); }, getState: async () => state([sun, movedEarth(t)], t) });
    await flush();
    act(() => result.current.play());
    await advance(900);
    const onScreen = result.current.sim!.simulationTimeS;
    const pressedAt = performance.now(); // the button goes down
    await advance(100); // the release timer fires before the handler runs
    expect(result.current.sim!.simulationTimeS).toBeGreaterThan(onScreen);
    act(() => result.current.pause(pressedAt));
    expect(result.current.sim!.simulationTimeS).toBe(onScreen);
    await advance(3000);
    expect(result.current.sim!.simulationTimeS).toBe(onScreen);
    // Resume carries on (the backend never went back: the next released state is newer)
    act(() => result.current.play());
    await advance(500);
    expect(result.current.sim!.simulationTimeS).toBeGreaterThan(onScreen);
  });

  it("a step that is in flight when Pause is clicked arrives later without moving the frozen picture, and Resume then shows it", async () => {
    fakeWallClock();
    let t = 0;
    let release: (() => void) | null = null;
    let hold = false;
    const { result } = setup({
      step: (dt: number) => {
        t += dt;
        const response = stepResponse([sun, movedEarth(t)], t);
        if (!hold) return Promise.resolve(response);
        return new Promise((resolve) => { release = () => resolve(response); });
      },
      getState: async () => state([sun, movedEarth(t)], t),
    });
    await flush();
    act(() => result.current.play());
    await advance(900);
    hold = true; // the next request will be in flight until we say so
    await advance(400);
    const m = result.current.motion;
    const w = performance.now();
    result.current.pause();
    const frozen = m.sample(w)!;
    await act(async () => { release?.(); await vi.advanceTimersByTimeAsync(0); });
    for (const later of [0, 10, 1000, 60000]) {
      const f = m.sample(performance.now() + later)!;
      expect(f.timeS).toBe(frozen.timeS);
      expect(f.positions.get(earth.id)).toEqual(frozen.positions.get(earth.id));
    }
    expect(result.current.sim!.simulationTimeS).toBeLessThanOrEqual(m.latestTimeS!);
    hold = false;
    const resumedAt = performance.now();
    act(() => result.current.play());
    await advance(0);
    expect(m.sample(resumedAt)!.timeS).toBe(frozen.timeS); // no jump through the in-flight step
  });

  it("resume continues from the frozen display time: no jump, time never goes backwards, same trail", async () => {
    fakeWallClock();
    let t = 0;
    const { result } = setup({ step: async (dt: number) => { t += dt; return stepResponse([sun, movedEarth(t)], t); }, getState: async () => state([sun, movedEarth(t)], t) });
    await flush();
    act(() => result.current.play());
    await advance(900);
    act(() => result.current.pause());
    await advance(0);
    const m = result.current.motion;
    const frozen = m.sample(performance.now())!.timeS;
    const firstTrailT = m.trail.pointsFor(earth.id)[0]!.t;
    const resumedAt = performance.now();
    act(() => result.current.play());
    await advance(0);
    // the picture starts from exactly where it stopped: at the moment of resuming the displayed time is the frozen one
    const justAfter = m.sample(resumedAt)!.timeS;
    expect(justAfter).toBe(frozen);
    let previous = justAfter;
    for (let i = 0; i < 20; i++) {
      await advance(100);
      const now = m.sample(performance.now())!.timeS;
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
    expect(previous).toBeGreaterThan(frozen);
    expect(m.trail.pointsFor(earth.id)[0]!.t).toBe(firstTrailT);
  });

  it("resume after a pause continues the same trail", async () => {
    let t = 0;
    const { result } = setup({ step: async (dt: number) => { t += dt; return stepResponse([sun, movedEarth(t)], t); }, getState: async () => state([sun, movedEarth(t)], t) });
    await flush();
    act(() => result.current.play());
    await advance(450);
    act(() => result.current.pause());
    await advance(100);
    const paused = result.current.motion.trail.pointsFor(earth.id).length;
    const firstT = result.current.motion.trail.pointsFor(earth.id)[0]!.t;
    act(() => result.current.play());
    await advance(450);
    const resumed = result.current.motion.trail.pointsFor(earth.id);
    expect(resumed.length).toBeGreaterThan(paused);
    expect(resumed[0]!.t).toBe(firstT);
  });

  it("a speed change applies to the next step requested, never rescaling a state already computed", async () => {
    const asked: number[] = [];
    let t = 0;
    const { result } = setup({ step: async (dt: number) => { asked.push(dt); t += dt; return stepResponse([sun, movedEarth(t)], t); } });
    await flush();
    act(() => result.current.play());
    await advance(10);
    act(() => result.current.setSpeedExp(3));
    await advance(500);
    expect(asked[0]).toBe(1e5);
    expect(asked[asked.length - 1]).toBe(1e3);
  });
});

describe("useSimulation: repeated Pause / Resume cycles with delayed backend responses (a frozen frame never changes)", () => {
  function rng(seed: number) {
    let x = seed >>> 0;
    return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  }

  for (const [label, speedExp] of [["default speed", 5], ["maximum speed (1e7 s steps)", 7]] as const) {
    it(`${label}: 60 cycles, Pause before/after a response, in flight, right after Resume, long pauses`, async () => {
      fakeWallClock();
      const r = rng(speedExp * 101);
      const G = 6.6743e-11;
      const radius = 0.0587 * 1.496e11;
      const n = Math.sqrt((G * (sun.massKg + earth.massKg)) / radius ** 3);
      const orbit = (time: number) => {
        const a = n * time;
        return { ...earth, positionM: { x: radius * Math.cos(a), y: radius * Math.sin(a), z: 0 }, velocityMPerS: { x: -radius * n * Math.sin(a), y: radius * n * Math.cos(a), z: 0 } };
      };
      let t = 0;
      // every step answers after a random 0..350 ms (fake time): responses land before, during and after the Pause clicks
      const step = (dt: number) => {
        t += dt;
        const response = stepResponse([sun, orbit(t)], t);
        return new Promise<typeof response>((resolve) => setTimeout(() => resolve(response), Math.floor(r() * 350)));
      };
      const { result } = setup({ step, getState: async () => state([sun, orbit(t)], t) });
      await flush();
      act(() => result.current.setSpeedExp(speedExp));
      const m = result.current.motion;
      let drawn: { timeS: number; p: unknown } | null = null;
      /** advance fake time in 16 ms frames, drawing a frame each time (what the canvas does) */
      const frames = async (ms: number, onFrame?: (f: { timeS: number; p: unknown }) => void) => {
        for (let spent = 0; spent < ms; spent += 16) {
          await act(async () => { await vi.advanceTimersByTimeAsync(16); });
          const f = m.sample(performance.now());
          if (f) {
            drawn = { timeS: f.timeS, p: f.positions.get(earth.id) };
            onFrame?.(drawn);
          }
        }
      };
      let paused = 0;
      for (let cycle = 0; cycle < 60; cycle++) {
        act(() => result.current.play());
        const run = r() < 0.25 ? Math.floor(r() * 50) : 200 + Math.floor(r() * 900); // sometimes Pause right after Resume
        await frames(run);
        // the click: a frame was drawn before it; the handler returns; nothing may change the frame from here until the next Play
        const before = drawn;
        result.current.pause();
        paused++;
        const after = m.sample(performance.now());
        if (before && after) {
          expect(after.timeS).toBe((before as { timeS: number }).timeS);
          expect(after.positions.get(earth.id)).toEqual((before as { p: unknown }).p);
        }
        const frozen = drawn;
        const pauseFor = r() < 0.15 ? 20000 : 300 + Math.floor(r() * 600);
        await frames(pauseFor, (f) => {
          if (frozen) {
            expect(f.timeS).toBe((frozen as { timeS: number }).timeS);
            expect(f.p).toEqual((frozen as { p: unknown }).p);
          }
        });
      }
      expect(paused).toBe(60);
      expect(m.size).toBeLessThanOrEqual(16);
    }, 60000);
  }
});
