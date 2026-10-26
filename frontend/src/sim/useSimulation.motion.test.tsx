import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { earth, fakeClient, mergerEvent, state, stepResponse, sun } from "../test/fixtures";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/errors";
import { useSimulation } from "./useSimulation";

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

describe("useSimulation: a step the backend cannot finish in its time budget", () => {
  const budget503 = () => new ApiError("http", "step exceeded its 10 s wall-clock budget; state was not advanced (retry with a smaller dtS)", 503);

  it("is not retried (Play stops, D-021), and the next step starts from a quarter of the size that failed; choosing a size lifts it", async () => {
    const asked: number[] = [];
    let t = 0;
    const { result } = setup({
      step: async (dt: number) => {
        asked.push(dt);
        if (dt > 2e6) throw budget503();
        t += dt;
        return stepResponse([sun, movedEarth(t)], t);
      },
    });
    await flush();
    act(() => result.current.setSpeedExp(7));
    await act(async () => { expect(await result.current.stepOnce()).toBe("failed"); });
    expect(asked).toEqual([1e7]);
    expect(result.current.actionError).toMatch(/next step will be 2\.50e\+6 s|next step will be 28\.9 d/);
    await act(async () => { expect(await result.current.stepOnce()).toBe("failed"); });
    expect(asked).toEqual([1e7, 2.5e6]); // 2.5e6 > 2e6 still fails in this fake backend...
    await act(async () => { expect(await result.current.stepOnce()).toBe("ok"); });
    expect(asked[2]).toBe(6.25e5);
    act(() => result.current.setSpeedExp(7));
    await act(async () => { await result.current.stepOnce(); });
    expect(asked[3]).toBe(1e7); // a fresh choice starts afresh
  });

  it("limits a step to half the budget once the backend's cost per simulated second is known", async () => {
    const asked: number[] = [];
    let t = 0;
    const { result } = setup({ step: async (dt: number) => { asked.push(dt); t += dt; return stepResponse([sun, movedEarth(t)], t); } });
    await flush();
    // Three states while playing, one second of wall time apart: 1 s per 1e6 simulated s.
    const m = result.current.motion;
    const base = performance.now();
    m.push({ t: 1e6, bodies: [] }, { wallMs: base, flush: true });
    m.push({ t: 2e6, bodies: [] }, { wallMs: base + 1000, playing: true });
    m.push({ t: 3e6, bodies: [] }, { wallMs: base + 2000, playing: true });
    expect(m.costPerSimulatedSecond).toBeCloseTo(1e-6, 9);
    expect(m.lastMeasuredIntervalS).toBeCloseTo(1, 9);
    act(() => result.current.setSpeedExp(7));
    await act(async () => { await result.current.stepOnce(); });
    expect(asked[0]).toBeCloseTo(5e6, -2); // half of the 10 s budget, at 1e-6 s per simulated second
    expect(result.current.actionError).toMatch(/Step limited to/);
  });
});
