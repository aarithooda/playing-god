import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import type { StepResponseDto } from "../api/types";
import { diagnostics, earth, fakeClient, mergerEvent, state, stepResponse, sun } from "../test/fixtures";
import type { ApiClient } from "../api/client";
import { useSimulation, type SimulationOptions } from "./useSimulation";

const opts = { tickMs: 100, healthPollMs: 1_000_000 };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// The client must be created once: a new client identity per render would retrigger the initial load.
function renderSim(overrides: Partial<ApiClient> = {}, o: SimulationOptions = opts) {
  const client = fakeClient(overrides);
  return renderHook(() => useSimulation(client, o));
}

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

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useSimulation: loading", () => {
  it("loads authoritative state and events from the client", async () => {
    const client = fakeClient({ getEvents: async () => [mergerEvent] });
    const { result } = renderHook(() => useSimulation(client, opts));
    expect(result.current.loadStatus).toBe("loading");
    await flush();
    expect(result.current.loadStatus).toBe("ready");
    expect(result.current.sim?.bodies.map((b) => b.name)).toEqual(["Sun", "Earth"]);
    expect(result.current.events.map((e) => e.id)).toEqual(["evt-1"]);
    expect(result.current.layoutEpoch).toBe(1);
    expect(result.current.health).toBe("ok");
  });

  it("shows an empty universe as ready with zero bodies (no fallback sample data)", async () => {
    const { result } = renderSim({ getState: async () => state([]) }, opts);
    await flush();
    expect(result.current.loadStatus).toBe("ready");
    expect(result.current.sim?.bodies).toEqual([]);
  });

  it("reports a disconnected state on load failure and recovers on reload", async () => {
    let up = false;
    const client = fakeClient({
      getState: async () => {
        if (!up) throw new ApiError("network", "Cannot reach the backend (down)");
        return state([sun]);
      },
      health: async () => {
        if (!up) throw new ApiError("network", "down");
        return true;
      },
    });
    const { result } = renderHook(() => useSimulation(client, opts));
    await flush();
    expect(result.current.loadStatus).toBe("error");
    expect(result.current.loadError).toMatch(/Cannot reach the backend/);
    expect(result.current.health).toBe("down");
    expect(result.current.sim).toBeNull();

    up = true;
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.loadStatus).toBe("ready");
    expect(result.current.sim?.bodies).toHaveLength(1);
  });

  it("polls health at the configured interval only", async () => {
    const health = vi.fn(async () => true);
    renderSim({ health }, { tickMs: 100, healthPollMs: 5000 });
    await flush();
    expect(health).toHaveBeenCalledTimes(1);
    await advance(10_000);
    expect(health).toHaveBeenCalledTimes(3);
  });
});

describe("useSimulation: step / play / pause", () => {
  it("Step sends exactly one bounded step and applies the returned positions and events", async () => {
    const moved = { ...earth, positionM: { x: 1.4e11, y: 5e9, z: 0 } };
    const step = vi.fn(async (_dt: number): Promise<StepResponseDto> => stepResponse([sun, moved], 86400, [mergerEvent]));
    const { result } = renderSim({ step }, { ...opts, initialSpeedExp: 4 });
    await flush();
    await act(async () => {
      await result.current.stepOnce();
    });
    expect(step).toHaveBeenCalledTimes(1);
    expect(step).toHaveBeenCalledWith(10_000);
    expect(result.current.playing).toBe(false);
    expect(result.current.sim?.simulationTimeS).toBe(86400);
    expect(result.current.sim?.bodies[1].positionM).toEqual({ x: 1.4e11, y: 5e9, z: 0 });
    expect(result.current.events.map((e) => e.id)).toEqual(["evt-1"]);
  });

  it("speed changes the requested dtS and stays within the API bounds", async () => {
    const step = vi.fn(async (_dt: number) => stepResponse([sun], 1));
    const { result } = renderSim({ step }, opts);
    await flush();
    act(() => result.current.setSpeedExp(7));
    await act(async () => {
      await result.current.stepOnce();
    });
    expect(step).toHaveBeenLastCalledWith(1e7);
    act(() => result.current.setSpeedExp(50));
    expect(result.current.stepSeconds).toBe(1e8);
  });

  it("Play never overlaps requests: the next step waits for the previous response plus the tick delay", async () => {
    const pending: Array<ReturnType<typeof deferred<StepResponseDto>>> = [];
    const step = vi.fn((_dt: number) => {
      const d = deferred<StepResponseDto>();
      pending.push(d);
      return d.promise;
    });
    const { result } = renderSim({ step }, opts);
    await flush();

    act(() => result.current.play());
    await flush();
    expect(step).toHaveBeenCalledTimes(1);

    await advance(5_000); // a long time passes while the first request is still in flight
    expect(step).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0].resolve(stepResponse([sun, earth], 100));
    });
    expect(result.current.sim?.simulationTimeS).toBe(100);
    expect(step).toHaveBeenCalledTimes(1); // tick delay not elapsed yet
    await advance(100);
    expect(step).toHaveBeenCalledTimes(2);
    await act(async () => {
      pending[1].resolve(stepResponse([sun, earth], 200));
    });
    expect(result.current.sim?.simulationTimeS).toBe(200);
  });

  it("Pause stops scheduling but lets the in-flight step finish and apply", async () => {
    const pending: Array<ReturnType<typeof deferred<StepResponseDto>>> = [];
    const step = vi.fn((_dt: number) => {
      const d = deferred<StepResponseDto>();
      pending.push(d);
      return d.promise;
    });
    const { result } = renderSim({ step }, opts);
    await flush();
    act(() => result.current.play());
    await flush();
    act(() => result.current.pause());
    await act(async () => {
      pending[0].resolve(stepResponse([sun, earth], 100));
    });
    expect(result.current.sim?.simulationTimeS).toBe(100); // in-flight response still applied
    await advance(10_000);
    expect(step).toHaveBeenCalledTimes(1); // nothing further scheduled
    expect(result.current.playing).toBe(false);
  });

  it("a second Step while one is in flight is ignored", async () => {
    const d = deferred<StepResponseDto>();
    const step = vi.fn((_dt: number) => d.promise);
    const { result } = renderSim({ step }, opts);
    await flush();
    await act(async () => {
      const first = result.current.stepOnce();
      await vi.advanceTimersByTimeAsync(0);
      expect(await result.current.stepOnce()).toBe("skipped");
      d.resolve(stepResponse([sun], 1));
      expect(await first).toBe("ok");
    });
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("unmounting while playing cancels the loop", async () => {
    const step = vi.fn(async (_dt: number) => stepResponse([sun, earth], 100));
    const { result, unmount } = renderSim({ step }, opts);
    await flush();
    act(() => result.current.play());
    await advance(250);
    const calls = step.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    unmount();
    await advance(5_000);
    expect(step.mock.calls.length).toBe(calls);
  });

  it("a failed step stops Play and surfaces the error without touching state", async () => {
    const step = vi.fn(async (_dt: number): Promise<StepResponseDto> => {
      throw new ApiError("http", "simulation failed", 500);
    });
    const { result } = renderSim({ step }, opts);
    await flush();
    act(() => result.current.play());
    await flush();
    expect(result.current.playing).toBe(false);
    expect(result.current.actionError).toBe("simulation failed");
    expect(result.current.sim?.simulationTimeS).toBe(0);
    await advance(5_000);
    expect(step).toHaveBeenCalledTimes(1);
  });
});

describe("useSimulation: reset and CRUD", () => {
  it("Reset pauses, calls the backend, replaces state and events, and bumps the layout epoch", async () => {
    const reset = vi.fn(async () => state([]));
    let events = [mergerEvent];
    const client = fakeClient({ reset, getEvents: async () => events });
    const { result } = renderHook(() => useSimulation(client, opts));
    await flush();
    expect(result.current.events).toHaveLength(1);
    const epoch = result.current.layoutEpoch;
    events = [];
    act(() => result.current.play());
    await act(async () => {
      await result.current.reset();
    });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(result.current.playing).toBe(false);
    expect(result.current.sim?.bodies).toEqual([]);
    expect(result.current.events).toEqual([]);
    expect(result.current.layoutEpoch).toBe(epoch + 1);
  });

  it("create/update/delete call the backend and then re-read authoritative state", async () => {
    let bodies = [sun];
    const createBody = vi.fn(async (b) => {
      bodies = [...bodies, { id: "body-new", ...b }];
      return bodies[bodies.length - 1];
    });
    const updateBody = vi.fn(async (id: string, patch) => {
      bodies = bodies.map((b) => (b.id === id ? { ...b, ...patch } : b));
      return bodies.find((b) => b.id === id)!;
    });
    const deleteBody = vi.fn(async (id: string) => {
      bodies = bodies.filter((b) => b.id !== id);
    });
    const client = fakeClient({ getState: async () => state(bodies), createBody, updateBody, deleteBody });
    const { result } = renderHook(() => useSimulation(client, opts));
    await flush();

    const { id: _id, ...create } = earth;
    await act(async () => {
      expect(await result.current.createBody(create)).toEqual({ ok: true, id: "body-new" }); // the backend-assigned id is reported (used by undo)
    });
    expect(createBody).toHaveBeenCalledWith(create);
    expect(result.current.sim?.bodies.map((b) => b.id)).toEqual([sun.id, "body-new"]);

    await act(async () => {
      await result.current.updateBody("body-new", { massKg: 1e22 });
    });
    expect(updateBody).toHaveBeenCalledWith("body-new", { massKg: 1e22 });
    expect(result.current.sim?.bodies[1].massKg).toBe(1e22);

    await act(async () => {
      await result.current.deleteBody("body-new");
    });
    expect(deleteBody).toHaveBeenCalledWith("body-new");
    expect(result.current.sim?.bodies.map((b) => b.id)).toEqual([sun.id]);
  });

  it("API errors are returned to the caller and never fall back to local state", async () => {
    const client = fakeClient({
      updateBody: async () => {
        throw new ApiError("http", "massKg: Input should be greater than 0", 422);
      },
    });
    const { result } = renderHook(() => useSimulation(client, opts));
    await flush();
    let r: unknown;
    await act(async () => {
      r = await result.current.updateBody(sun.id, { massKg: -1 });
    });
    expect(r).toEqual({ ok: false, error: "massKg: Input should be greater than 0" });
    expect(result.current.sim?.bodies[0].massKg).toBe(sun.massKg);
    expect(result.current.actionError).toMatch(/greater than 0/);
  });

  it("remembers names of bodies that later disappear so events stay readable", async () => {
    let bodies = [sun, earth];
    const client = fakeClient({
      getState: async () => state(bodies),
      step: async () => {
        bodies = [sun];
        return stepResponse([sun], 7200, [mergerEvent]);
      },
    });
    const { result } = renderHook(() => useSimulation(client, opts));
    await flush();
    await act(async () => {
      await result.current.stepOnce();
    });
    expect(result.current.sim?.bodies).toHaveLength(1);
    expect(result.current.bodyName(earth.id)).toBe("Earth");
  });
});

describe("useSimulation: diagnostics follow the authoritative responses", () => {
  it("replaces diagnostics on load, step and reset, and drops them when a response has none", async () => {
    const afterStep = { ...diagnostics, kineticEnergyJ: 42 };
    const emptyDiag = { ...diagnostics, totalMassKg: 0, kineticEnergyJ: 0, potentialEnergyJ: 0 };
    const client = fakeClient({
      step: async () => ({ ...stepResponse([sun, earth], 100), diagnostics: afterStep }),
      reset: async () => ({ ...state([]), diagnostics: emptyDiag }),
    });
    const { result } = renderHook(() => useSimulation(client, opts));
    await flush();
    expect(result.current.sim?.diagnostics).toEqual(diagnostics);
    expect(result.current.sim?.diagnosticsIssue).toBeNull();
    await act(async () => {
      await result.current.stepOnce();
    });
    expect(result.current.sim?.diagnostics).toEqual(afterStep);
    await act(async () => {
      await result.current.reset();
    });
    expect(result.current.sim?.diagnostics).toEqual(emptyDiag); // zero is a value, kept as such
    expect(result.current.sim?.bodies).toEqual([]);
  });

  it("keeps bodies visible and records the reason when diagnostics are missing", async () => {
    const client = fakeClient({
      getState: async () => ({ ...state([sun, earth]), diagnostics: null, diagnosticsIssue: "unsupported diagnostics version (2; this client understands 1)" }),
    });
    const { result } = renderHook(() => useSimulation(client, opts));
    await flush();
    expect(result.current.sim?.bodies).toHaveLength(2);
    expect(result.current.sim?.diagnostics).toBeNull();
    expect(result.current.sim?.diagnosticsIssue).toMatch(/unsupported diagnostics version/);
  });
});
