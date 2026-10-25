// How fast simulated time is actually passing on screen, measured from the backend's own simulation times as they
// arrive. Nothing is predicted from the step size: the rate depends on how long each backend step takes, so it is
// only reported once at least two confirmed times have been seen while playing.
import { useEffect, useRef, useState } from "react";

export interface TimeSample {
  wallMs: number;
  simulationTimeS: number;
}

/** Window over which the rate is averaged (wall-clock milliseconds). */
export const RATE_WINDOW_MS = 4000;

/** Simulated seconds per wall-clock second over the samples, or null when they do not span any wall time. */
export function observedRate(samples: readonly TimeSample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const wallS = (last.wallMs - first.wallMs) / 1000;
  const simS = last.simulationTimeS - first.simulationTimeS;
  if (wallS <= 0 || simS <= 0) return null;
  return simS / wallS;
}

/** Keeps the samples inside the window ending at `nowMs` (the newest sample is always kept). */
export function trimSamples(samples: readonly TimeSample[], nowMs: number, windowMs = RATE_WINDOW_MS): TimeSample[] {
  const kept = samples.filter((s) => nowMs - s.wallMs <= windowMs);
  return kept.length > 0 ? kept : samples.slice(-1);
}

/**
 * Simulated seconds per wall-clock second while `playing`; null while paused, before two confirmed times arrive, or
 * when time did not advance. A pause clears the samples so a later run is measured afresh.
 */
export function useObservedRate(simulationTimeS: number | null, playing: boolean, now: () => number = () => performance.now()): number | null {
  const samples = useRef<TimeSample[]>([]);
  const [rate, setRate] = useState<number | null>(null);

  useEffect(() => {
    if (!playing) {
      samples.current = [];
      setRate(null);
    }
  }, [playing]);

  useEffect(() => {
    if (!playing || simulationTimeS === null) return;
    const wallMs = now();
    const last = samples.current[samples.current.length - 1];
    if (last && last.simulationTimeS === simulationTimeS) return;
    samples.current = trimSamples([...samples.current, { wallMs, simulationTimeS }], wallMs);
    setRate(observedRate(samples.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationTimeS, playing]);

  return rate;
}
