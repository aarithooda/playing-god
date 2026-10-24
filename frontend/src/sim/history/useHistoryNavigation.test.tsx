import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryPageDto, HistorySampleDto } from "../../api/types";
import { applyHistoryPage, type HistoryCache } from "./historyModel";
import { REPLAY_TICK_MS, useHistoryNavigation } from "./useHistoryNavigation";

const meta = { name: "A", colorHex: "#ff0000", radiusM: 10, kind: "planet" };
const sample = (index: number): HistorySampleDto => ({ index, simulationTimeS: index * 100, segment: 0, positionsM: { a: [index, 0, 0] } });
const cacheOf = (indices: number[], o: { generation?: number; universeId?: string } = {}): HistoryCache =>
  applyHistoryPage(null, {
    universeId: o.universeId ?? "u1", mode: "grid", sampleIntervalS: 100, generation: o.generation ?? 1, firstIndex: indices[0] ?? 0,
    nextIndex: (indices[indices.length - 1] ?? -1) + 1, droppedBefore: 0, truncated: false, samples: indices.map(sample), bodies: { a: meta },
  } satisfies HistoryPageDto);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const tick = (n = 1) => act(async () => void (await vi.advanceTimersByTimeAsync(REPLAY_TICK_MS * n)));

describe("useHistoryNavigation", () => {
  it("entering history pauses play and disables edits (it reports entry once, and stays live until then)", () => {
    const onEnter = vi.fn();
    const { result } = renderHook(() => useHistoryNavigation(cacheOf([0, 1, 2, 3]), { onEnter }));
    expect(result.current.mode).toBe("live");
    expect(onEnter).not.toHaveBeenCalled();
    act(() => result.current.seek(1));
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(result.current.mode).toBe("history");
    expect(result.current.position).toBe(1);
    act(() => result.current.seek(2));
    expect(onEnter).toHaveBeenCalledTimes(1); // already viewing history
    expect(result.current.position).toBe(2);
  });

  it("seek is clamped to the samples that exist", () => {
    const { result } = renderHook(() => useHistoryNavigation(cacheOf([0, 1, 2]), { onEnter: () => {} }));
    act(() => result.current.seek(99));
    expect(result.current.position).toBe(2);
    act(() => result.current.seek(-5));
    expect(result.current.position).toBe(0);
  });

  it("stepping back from live starts at the newest sample, and stepping forward past the end stays on it", () => {
    const { result } = renderHook(() => useHistoryNavigation(cacheOf([0, 1, 2, 3]), { onEnter: () => {} }));
    act(() => result.current.stepBy(-1));
    expect(result.current.mode).toBe("history");
    expect(result.current.position).toBe(2);
    act(() => result.current.stepBy(+5));
    expect(result.current.position).toBe(3);
  });

  it("replay advances over recorded samples only", async () => {
    // samples 3..6 were never received: replay must jump from index 2 to 7, never showing a made-up state
    const cache = cacheOf([0, 1, 2, 7, 8]);
    const { result } = renderHook(() => useHistoryNavigation(cache, { onEnter: () => {} }));
    const seen: number[] = [];
    const record = () => seen.push(cache.samples[result.current.position!]!.index);
    act(() => result.current.seek(0));
    record();
    act(() => result.current.replay(1));
    expect(result.current.replaying).toBe(true);
    for (let i = 0; i < 4; i += 1) {
      await tick();
      record();
    }
    expect(seen).toEqual([0, 1, 2, 7, 8]);
    await tick(2);
    expect(result.current.replaying).toBe(false); // reached the end, stays there
    expect(result.current.position).toBe(4);
    expect(result.current.mode).toBe("history");
  });

  it("replay rate is samples per tick", async () => {
    const { result } = renderHook(() => useHistoryNavigation(cacheOf(Array.from({ length: 30 }, (_, i) => i)), { onEnter: () => {} }));
    act(() => result.current.seek(0));
    act(() => result.current.replay(5));
    await tick();
    expect(result.current.position).toBe(5);
    await tick();
    expect(result.current.position).toBe(10);
    expect(result.current.rate).toBe(5);
    act(() => result.current.stopReplay());
    await tick(3);
    expect(result.current.position).toBe(10);
    expect(result.current.replaying).toBe(false);
  });

  it("replay from the end starts over", async () => {
    const { result } = renderHook(() => useHistoryNavigation(cacheOf([0, 1, 2, 3]), { onEnter: () => {} }));
    act(() => result.current.seek(3));
    act(() => result.current.replay(1));
    expect(result.current.position).toBe(0);
    await tick();
    expect(result.current.position).toBe(1);
  });

  it("an unsupported replay rate is coerced to a supported one", () => {
    const { result } = renderHook(() => useHistoryNavigation(cacheOf([0, 1, 2, 3]), { onEnter: () => {} }));
    act(() => result.current.seek(0));
    act(() => result.current.replay(7));
    expect([1, 2, 5, 10]).toContain(result.current.rate);
  });

  it("return to live stops replay and leaves history", async () => {
    const { result } = renderHook(() => useHistoryNavigation(cacheOf([0, 1, 2, 3]), { onEnter: () => {} }));
    act(() => result.current.seek(0));
    act(() => result.current.replay(1));
    act(() => result.current.returnToLive());
    expect(result.current.mode).toBe("live");
    expect(result.current.replaying).toBe(false);
    expect(result.current.position).toBeNull();
    await tick(3);
    expect(result.current.mode).toBe("live");
  });

  it("return to live after new generation", () => {
    let cache = cacheOf([0, 1, 2]);
    const { result, rerender } = renderHook(() => useHistoryNavigation(cache, { onEnter: () => {} }));
    act(() => result.current.seek(1));
    expect(result.current.mode).toBe("history");
    cache = cacheOf([0], { generation: 2 }); // a reset or restore replaced the history
    rerender();
    expect(result.current.mode).toBe("live");
    expect(result.current.position).toBeNull();
    cache = cacheOf([0, 1], { generation: 2 });
    act(() => result.current.seek(1));
    cache = cacheOf([0, 1], { generation: 2, universeId: "u2" });
    rerender();
    expect(result.current.mode).toBe("live");
  });

  it("growing history (live steps) does not move a viewed sample", () => {
    let cache = cacheOf([0, 1, 2, 3]);
    const { result, rerender } = renderHook(() => useHistoryNavigation(cache, { onEnter: () => {} }));
    act(() => result.current.seek(1));
    cache = applyHistoryPage(cache, { universeId: "u1", mode: "grid", sampleIntervalS: 100, generation: 1, firstIndex: 4, nextIndex: 6, droppedBefore: 0, truncated: false, samples: [sample(4), sample(5)], bodies: { a: meta } });
    rerender();
    expect(result.current.position).toBe(1);
    expect(result.current.mode).toBe("history");
  });

  it("with no history there is nothing to navigate", () => {
    const { result } = renderHook(() => useHistoryNavigation(null, { onEnter: () => {} }));
    act(() => result.current.seek(0));
    expect(result.current.mode).toBe("live");
  });
});
