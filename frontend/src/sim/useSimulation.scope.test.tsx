// Scope handling of the simulation hook: refusals that mean "your universe/epoch is out of date", pending writes, revision.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { earth, fakeClient, state, stepResponse, sun } from "../test/fixtures";
import { isScopeInvalid, useSimulation } from "./useSimulation";

const opts = { tickMs: 100, healthPollMs: 1_000_000 };

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("isScopeInvalid", () => {
  it("recognises exactly the refusals that mean the scope is stale", () => {
    expect(isScopeInvalid(new ApiError("http", "x", 409, "stale_activation"))).toBe(true);
    expect(isScopeInvalid(new ApiError("http", "x", 409, "universe_not_active"))).toBe(true);
    expect(isScopeInvalid(new ApiError("http", "x", 404, "universe_not_found"))).toBe(true);
    expect(isScopeInvalid(new ApiError("http", "x", 409))).toBe(false); // an ordinary conflict (overlap, body limit)
    expect(isScopeInvalid(new ApiError("http", "x", 404))).toBe(false); // an unknown body id
    expect(isScopeInvalid(new ApiError("network", "x"))).toBe(false);
    expect(isScopeInvalid(new Error("x"))).toBe(false);
  });
});

describe("useSimulation scope handling", () => {
  it("reports a stale activation on a step, and does not apply anything", async () => {
    const onScopeInvalid = vi.fn();
    const client = fakeClient({
      step: async () => {
        throw new ApiError("http", "stale activation epoch 1 (current: 2)", 409, "stale_activation");
      },
    });
    const { result } = renderHook(() => useSimulation(client, { ...opts, onScopeInvalid }));
    await flush();
    await act(async () => void (await result.current.stepOnce()));
    expect(onScopeInvalid).toHaveBeenCalledTimes(1);
    expect(result.current.actionError).toMatch(/stale activation/);
    expect(result.current.sim?.simulationTimeS).toBe(0);
  });

  it("reports a universe that no longer exists when the first load fails", async () => {
    const onScopeInvalid = vi.fn();
    const client = fakeClient({
      getState: async () => {
        throw new ApiError("http", "unknown universe: uni-x", 404, "universe_not_found");
      },
    });
    const { result } = renderHook(() => useSimulation(client, { ...opts, onScopeInvalid }));
    await flush();
    expect(result.current.loadStatus).toBe("error");
    expect(onScopeInvalid).toHaveBeenCalledTimes(1);
  });

  it("an ordinary conflict is shown but is not a scope problem", async () => {
    const onScopeInvalid = vi.fn();
    const client = fakeClient({
      createBody: async () => {
        throw new ApiError("http", "body would overlap body-x", 409);
      },
    });
    const { result } = renderHook(() => useSimulation(client, { ...opts, onScopeInvalid }));
    await flush();
    const r = await act(async () => result.current.createBody({ name: "n", massKg: 1, radiusM: 1, positionM: { x: 0, y: 0, z: 0 }, velocityMPerS: { x: 0, y: 0, z: 0 }, colorHex: "#ffffff" }));
    expect(r).toEqual({ ok: false, error: "body would overlap body-x" });
    expect(onScopeInvalid).not.toHaveBeenCalled();
  });

  it("reports pending non-step writes (and steps do not count)", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const onBusyWriteChange = vi.fn();
    const client = fakeClient({ reset: async () => (await gate, state([])) });
    const { result } = renderHook(() => useSimulation(client, { ...opts, onBusyWriteChange }));
    await flush();
    await act(async () => void result.current.stepOnce());
    expect(onBusyWriteChange).not.toHaveBeenCalled();
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.reset();
    });
    expect(onBusyWriteChange).toHaveBeenLastCalledWith(true);
    expect(result.current.writePending).toBe(true);
    await act(async () => {
      finish();
      await pending;
    });
    expect(onBusyWriteChange).toHaveBeenLastCalledWith(false);
    expect(result.current.writePending).toBe(false);
  });

  it("exposes the revision the backend reported with the last state", async () => {
    const client = fakeClient({
      getState: async () => ({ ...state([sun, earth]), revision: 4 }),
      step: async () => ({ ...stepResponse([sun, earth], 100), revision: 5 }),
    });
    const { result } = renderHook(() => useSimulation(client, opts));
    await flush();
    expect(result.current.revision).toBe(4);
    await act(async () => void (await result.current.stepOnce()));
    expect(result.current.revision).toBe(5);
  });
});
