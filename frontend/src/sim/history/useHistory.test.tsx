import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/errors";
import type { HistoryPageDto, HistorySampleDto } from "../../api/types";
import { fakeClient } from "../../test/fixtures";
import { useHistory } from "./useHistory";

const meta = { name: "A", colorHex: "#ff0000", radiusM: 10, kind: "planet" };
const samples = (from: number, to: number): HistorySampleDto[] =>
  Array.from({ length: to - from }, (_, i) => ({ index: from + i, simulationTimeS: (from + i) * 100, segment: 0, positionsM: { a: [from + i, 0, 0] as [number, number, number] } }));
const page = (from: number, to: number, o: Partial<HistoryPageDto> = {}): HistoryPageDto => ({
  universeId: "uni-default", mode: "step", sampleIntervalS: null, generation: 1, firstIndex: from, nextIndex: to,
  droppedBefore: 0, truncated: false, samples: samples(from, to), bodies: { a: meta }, ...o,
});

const scoped = (getHistory: (...a: any[]) => Promise<HistoryPageDto>) => fakeClient({ getHistory }).scoped({ universeId: "uni-default", activationEpoch: 1 });

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

describe("useHistory", () => {
  it("fetches incrementally whenever the revision changes", async () => {
    const getHistory = vi.fn(async (q: any) => (q.fromIndex ? page(q.fromIndex, 5) : page(0, 3)));
    const client = scoped(getHistory);
    const { result, rerender } = renderHook(({ rev }) => useHistory(client, rev), { initialProps: { rev: 1 as number | null } });
    await flush();
    expect(result.current.cache!.samples).toHaveLength(3);
    expect(getHistory).toHaveBeenLastCalledWith(expect.objectContaining({ fromIndex: 0 }));
    rerender({ rev: 2 });
    await flush();
    expect(getHistory).toHaveBeenLastCalledWith(expect.objectContaining({ generation: 1, fromIndex: 3 }));
    expect(result.current.cache!.samples.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result.current.status).toBe("idle");
  });

  it("does nothing until the revision is known", async () => {
    const getHistory = vi.fn(async () => page(0, 1));
    renderHook(() => useHistory(scoped(getHistory), null));
    await flush();
    expect(getHistory).not.toHaveBeenCalled();
  });

  it("keeps fetching while pages come back full", async () => {
    const PAGE = 1000;
    const getHistory = vi.fn(async (q: any) => {
      const from = q.fromIndex ?? 0;
      return page(from, Math.min(from + PAGE, 2500), { nextIndex: Math.min(from + PAGE, 2500) });
    });
    const client = scoped(getHistory);
    const { result } = renderHook(() => useHistory(client, 1));
    await flush();
    expect(result.current.cache!.samples).toHaveLength(2500);
    expect(getHistory).toHaveBeenCalledTimes(3);
  });

  it("history fetch failure keeps cache and marks stale", async () => {
    let fail = false;
    const getHistory = vi.fn(async (q: any) => {
      if (fail) throw new ApiError("timeout", "The backend did not answer GET history within 8 s");
      return q.fromIndex ? page(q.fromIndex, 5) : page(0, 3);
    });
    const client = scoped(getHistory);
    const { result, rerender } = renderHook(({ rev }) => useHistory(client, rev), { initialProps: { rev: 1 as number | null } });
    await flush();
    fail = true;
    rerender({ rev: 2 });
    await flush();
    expect(result.current.status).toBe("stale");
    expect(result.current.error).toMatch(/did not answer/);
    expect(result.current.cache!.samples).toHaveLength(3); // what we had is still there, nothing was made up
    fail = false;
    rerender({ rev: 3 }); // retried on the next revision change
    await flush();
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.cache!.samples).toHaveLength(5);
  });

  it("a manual refresh retries too", async () => {
    let fail = true;
    const getHistory = vi.fn(async () => {
      if (fail) throw new Error("boom");
      return page(0, 2);
    });
    const client = scoped(getHistory);
    const { result } = renderHook(() => useHistory(client, 1));
    await flush();
    expect(result.current.status).toBe("stale");
    expect(result.current.cache).toBeNull();
    fail = false;
    await act(async () => void result.current.refresh());
    await flush();
    expect(result.current.cache!.samples).toHaveLength(2);
  });

  it("history page from old workspace is ignored", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const getHistory = vi.fn(async () => (await gate, page(0, 3)));
    const client = scoped(getHistory);
    const { result, unmount } = renderHook(() => useHistory(client, 1));
    await flush();
    unmount(); // the workspace was replaced (universe switch): its hook is gone
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(result.current.cache).toBeNull(); // the late page changed nothing
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("a page that names another universe is dropped instead of cached", async () => {
    const getHistory = vi.fn(async () => page(0, 3, { universeId: "uni-other" }));
    const client = scoped(getHistory);
    const { result } = renderHook(() => useHistory(client, 1));
    await flush();
    expect(result.current.cache).toBeNull();
    expect(result.current.status).toBe("stale");
    expect(result.current.error).toMatch(/another universe/);
  });

  it("a new generation replaces the cache instead of extending it", async () => {
    let call = 0;
    const getHistory = vi.fn(async () => (call++ === 0 ? page(0, 5) : page(0, 2, { generation: 2 })));
    const client = scoped(getHistory);
    const { result, rerender } = renderHook(({ rev }) => useHistory(client, rev), { initialProps: { rev: 1 } });
    await flush();
    rerender({ rev: 2 });
    await flush();
    expect(result.current.cache!.generation).toBe(2);
    expect(result.current.cache!.samples).toHaveLength(2);
  });
});
