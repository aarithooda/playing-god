// Moving through recorded history (UI-2, plan section 11B.4): seek, step, replay, return to live.
//
// Replay advances over the samples that were recorded and nothing else: the next state shown is always the next held
// sample, never a computed in-between. Entering history asks the owner to pause the simulation (`onEnter`). A new
// generation or universe in the cache means what was being viewed no longer exists, so the view returns to live.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryCache } from "./historyModel";

export const REPLAY_TICK_MS = 120;
export const REPLAY_RATES = [1, 2, 5, 10] as const;
export type ReplayRate = (typeof REPLAY_RATES)[number];

function coerceRate(rate: number): ReplayRate {
  return (REPLAY_RATES as readonly number[]).includes(rate) ? (rate as ReplayRate) : REPLAY_RATES.reduce((best, r) => (Math.abs(r - rate) < Math.abs(best - rate) ? r : best));
}

export function useHistoryNavigation(cache: HistoryCache | null, options: { onEnter: () => void }) {
  // The viewed sample is remembered by its own index (stable while the cache grows or is trimmed), not by position.
  const [viewed, setViewed] = useState<{ sampleIndex: number; universeId: string; generation: number } | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [rate, setRateState] = useState<ReplayRate>(1);
  const onEnterRef = useRef(options.onEnter);
  onEnterRef.current = options.onEnter;
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  // Mirrors `viewed` synchronously so entering history is reported exactly once, even for two calls in one tick.
  const viewedRef = useRef(viewed);
  viewedRef.current = viewed;

  // A different universe or generation: the viewed sample does not exist any more.
  const stale = viewed !== null && (!cache || cache.universeId !== viewed.universeId || cache.generation !== viewed.generation);
  useEffect(() => {
    if (stale) {
      setViewed(null);
      setReplaying(false);
    }
  }, [stale]);

  const positionOf = useCallback((c: HistoryCache, sampleIndex: number): number => {
    // the held sample with the greatest index <= sampleIndex, else the oldest held
    let lo = 0;
    let hi = c.samples.length - 1;
    let found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c.samples[mid]!.index <= sampleIndex) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }, []);

  const position = useMemo(() => (viewed && cache && !stale && cache.samples.length > 0 ? positionOf(cache, viewed.sampleIndex) : null), [viewed, cache, stale, positionOf]);

  const show = useCallback((pos: number) => {
    const c = cacheRef.current;
    if (!c || c.samples.length === 0) return;
    const clamped = Math.max(0, Math.min(c.samples.length - 1, pos));
    if (viewedRef.current === null) onEnterRef.current(); // entering history: the simulation must not advance meanwhile
    const next = { sampleIndex: c.samples[clamped]!.index, universeId: c.universeId, generation: c.generation };
    viewedRef.current = next;
    setViewed(next);
  }, []);

  const currentPosition = useCallback((): number | null => {
    const c = cacheRef.current;
    return viewed && c ? positionOf(c, viewed.sampleIndex) : null;
  }, [viewed, positionOf]);

  const seek = useCallback((pos: number) => show(pos), [show]);

  const stepBy = useCallback((n: number) => {
    const c = cacheRef.current;
    if (!c || c.samples.length === 0) return;
    const from = currentPosition() ?? c.samples.length - 1;
    show(from + n);
  }, [currentPosition, show]);

  const replay = useCallback((r: number = rate) => {
    const c = cacheRef.current;
    if (!c || c.samples.length === 0) return;
    const chosen = coerceRate(r);
    setRateState(chosen);
    const from = currentPosition();
    show(from === null || from >= c.samples.length - 1 ? 0 : from); // replaying from the end starts over
    setReplaying(true);
  }, [currentPosition, rate, show]);

  const stopReplay = useCallback(() => setReplaying(false), []);
  const returnToLive = useCallback(() => {
    setReplaying(false);
    viewedRef.current = null;
    setViewed(null);
  }, []);
  const setRate = useCallback((r: number) => setRateState(coerceRate(r)), []);

  useEffect(() => {
    if (!replaying) return;
    const timer = setInterval(() => {
      const c = cacheRef.current;
      setViewed((v) => {
        if (!v || !c) return v;
        const at = positionOf(c, v.sampleIndex);
        const next = Math.min(c.samples.length - 1, at + rate);
        if (next >= c.samples.length - 1) setReplaying(false); // the end: stay on the last sample
        return { ...v, sampleIndex: c.samples[next]!.index };
      });
    }, REPLAY_TICK_MS);
    return () => clearInterval(timer);
  }, [replaying, rate, positionOf]);

  return {
    mode: position === null ? ("live" as const) : ("history" as const),
    position,
    replaying: replaying && position !== null,
    rate,
    seek,
    stepBy,
    replay,
    stopReplay,
    returnToLive,
    setRate,
  };
}

export type HistoryNavigation = ReturnType<typeof useHistoryNavigation>;
