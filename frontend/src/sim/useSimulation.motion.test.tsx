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

  it("pause flushes to the latest backend state as one discontinuity", async () => {
    let t = 0;
    const { result } = setup({ step: async (dt: number) => { t += dt; return stepResponse([sun, movedEarth(t)], t); } });
    await flush();
    act(() => result.current.play());
    await advance(450);
    act(() => result.current.pause());
    await advance(0);
    expect(result.current.motion.size).toBe(1);
    expect(result.current.sim!.simulationTimeS).toBe(result.current.motion.latestTimeS);
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
