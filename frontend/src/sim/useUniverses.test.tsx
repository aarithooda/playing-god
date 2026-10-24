import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { fakeClient, solarPreset, universe, universeList } from "../test/fixtures";
import { UNIVERSES_LOST_NOTICE, useUniverses } from "./useUniverses";

afterEach(cleanup);

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useUniverses", () => {
  it("loads active scope on start", async () => {
    const client = fakeClient({
      listUniverses: async () =>
        universeList([universe({ id: "uni-default", active: false }), universe({ id: "uni-b", name: "B", active: true })], 4),
    });
    const { result } = renderHook(() => useUniverses(client));
    expect(result.current.status).toBe("loading");
    await flush();
    expect(result.current.status).toBe("ready");
    expect(result.current.scope).toEqual({ universeId: "uni-b", activationEpoch: 4 });
    expect(result.current.universes.map((u) => u.id)).toEqual(["uni-default", "uni-b"]);
    expect(result.current.presets).toEqual([solarPreset]);
    expect(result.current.notice).toBeNull();
  });

  it("a failed first load is a recoverable error", async () => {
    let fail = true;
    const client = fakeClient({
      listUniverses: async () => {
        if (fail) throw new ApiError("network", "Cannot reach the backend (down)");
        return universeList();
      },
    });
    const { result } = renderHook(() => useUniverses(client));
    await flush();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/Cannot reach/);
    fail = false;
    await act(async () => void (await result.current.retry()));
    expect(result.current.status).toBe("ready");
  });

  it("resyncs after universe-lost and shows notice", async () => {
    let lists = [
      universeList([universe({ id: "uni-default", active: false }), universe({ id: "uni-solar", active: true })], 3),
      universeList([universe({ id: "uni-default", active: true })], 1), // the backend restarted
    ];
    const client = fakeClient({ listUniverses: async () => lists.shift() ?? universeList() });
    const { result } = renderHook(() => useUniverses(client));
    await flush();
    expect(result.current.scope?.universeId).toBe("uni-solar");
    await act(async () => void (await result.current.refresh()));
    expect(result.current.scope).toEqual({ universeId: "uni-default", activationEpoch: 1 });
    expect(result.current.notice).toBe(UNIVERSES_LOST_NOTICE);
    act(() => result.current.dismissNotice());
    expect(result.current.notice).toBeNull();
  });

  it("a restart that keeps the default id is still detected (the epoch went backwards)", async () => {
    let lists = [universeList([universe()], 9), universeList([universe()], 1)];
    const client = fakeClient({ listUniverses: async () => lists.shift() ?? universeList() });
    const { result } = renderHook(() => useUniverses(client));
    await flush();
    await act(async () => void (await result.current.refresh()));
    expect(result.current.notice).toBe(UNIVERSES_LOST_NOTICE);
  });

  it("stale-activation adopts backend active universe", async () => {
    let lists = [
      universeList([universe({ id: "uni-default", active: true }), universe({ id: "uni-b", active: false })], 1),
      universeList([universe({ id: "uni-default", active: false }), universe({ id: "uni-b", active: true })], 2), // another tab switched
    ];
    const client = fakeClient({ listUniverses: async () => lists.shift() ?? universeList() });
    const { result } = renderHook(() => useUniverses(client));
    await flush();
    await act(async () => void (await result.current.refresh())); // what onScopeInvalid triggers
    expect(result.current.scope).toEqual({ universeId: "uni-b", activationEpoch: 2 });
    expect(result.current.notice).toBeNull(); // nothing was lost, only the active universe changed
  });

  it("concurrent resyncs share one request", async () => {
    const listUniverses = vi.fn(async () => universeList());
    const client = fakeClient({ listUniverses });
    const { result } = renderHook(() => useUniverses(client));
    await flush();
    listUniverses.mockClear();
    await act(async () => void (await Promise.all([result.current.refresh(), result.current.refresh(), result.current.refresh()])));
    expect(listUniverses).toHaveBeenCalledTimes(1);
  });

  it("activate calls the backend and then adopts what it reports", async () => {
    let active = "uni-default";
    const activateUniverse = vi.fn(async (id: string) => {
      active = id;
      return { activeUniverseId: id, activationEpoch: 2 };
    });
    const client = fakeClient({
      activateUniverse,
      listUniverses: async () =>
        universeList([universe({ id: "uni-default", active: active === "uni-default" }), universe({ id: "uni-b", active: active === "uni-b" })], active === "uni-b" ? 2 : 1),
    });
    const { result } = renderHook(() => useUniverses(client));
    await flush();
    await act(async () => void (await result.current.activate("uni-b")));
    expect(activateUniverse).toHaveBeenCalledWith("uni-b");
    expect(result.current.scope).toEqual({ universeId: "uni-b", activationEpoch: 2 });
  });

  it("a refused write shows the backend message and keeps the current scope", async () => {
    const client = fakeClient({
      activateUniverse: async () => {
        throw new ApiError("http", "unknown universe: uni-x", 404, "universe_not_found");
      },
    });
    const { result } = renderHook(() => useUniverses(client));
    await flush();
    await act(async () => void (await result.current.activate("uni-x")));
    expect(result.current.actionError).toBe("unknown universe: uni-x");
    expect(result.current.scope?.universeId).toBe("uni-default");
  });

  it("deleting a universe ourselves does not raise the lost-universes notice", async () => {
    let lists = [
      universeList([universe(), universe({ id: "uni-b", active: false })], 1),
      universeList([universe()], 1),
    ];
    const client = fakeClient({ listUniverses: async () => lists.shift() ?? universeList() });
    const { result } = renderHook(() => useUniverses(client));
    await flush();
    await act(async () => void (await result.current.deleteUniverse("uni-b")));
    expect(result.current.notice).toBeNull();
    expect(result.current.universes.map((u) => u.id)).toEqual(["uni-default"]);
  });
});
