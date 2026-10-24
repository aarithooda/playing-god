// UI-2: the client-side model of a universe's recorded history (plan section 11B.3). Pure: no React, no canvas.
//
// What it holds was recorded by the backend from its own committed states. This module only stores, orders and
// slices it. It never interpolates, extrapolates or fills a gap: a sample that was not received is simply absent, a
// gap is recorded, and a path is broken there. A cache belongs to exactly one (universe, generation); anything else
// replaces it, so positions of different universes, resets or restores can never share a timeline.
import type { HistoryBodyMetaDto, HistoryPageDto, HistorySampleDto } from "../../api/types";
import type { PositionSample, TrajectoryInput } from "../../render/contract";

export const MAX_CLIENT_SAMPLES = 20_000;

export interface HistoryCache {
  universeId: string;
  generation: number;
  mode: "grid" | "step";
  sampleIntervalS: number | null;
  /** Ascending by `index`; indices may skip where a gap was recorded. */
  samples: HistorySampleDto[];
  bodies: Record<string, HistoryBodyMetaDto>;
  /** One past the highest sample index received. */
  nextIndex: number;
  /** Samples older than this index are not available (dropped by the backend ring or by client retention). */
  droppedBefore: number;
  /** The backend stopped recording (grid cap reached). */
  truncated: boolean;
  /** Sample indices that were expected but never received. */
  gaps: number[];
  /** The client discarded its oldest samples to stay within MAX_CLIENT_SAMPLES. */
  clientTrimmed: boolean;
}

export interface HistoryFrameBody {
  id: string;
  positionM: { x: number; y: number; z: number };
  meta: HistoryBodyMetaDto;
}

export interface HistoryFrame {
  universeId: string;
  generation: number;
  /** The recorded sample's own index. */
  index: number;
  simulationTimeS: number;
  bodies: HistoryFrameBody[];
}

function fresh(page: HistoryPageDto): HistoryCache {
  const samples = page.samples.slice();
  return trim({
    universeId: page.universeId,
    generation: page.generation,
    mode: page.mode,
    sampleIntervalS: page.sampleIntervalS,
    samples,
    bodies: { ...page.bodies },
    nextIndex: samples.length > 0 ? samples[samples.length - 1]!.index + 1 : page.nextIndex,
    droppedBefore: page.droppedBefore,
    truncated: page.truncated,
    gaps: [],
    clientTrimmed: false,
  });
}

function trim(cache: HistoryCache): HistoryCache {
  const extra = cache.samples.length - MAX_CLIENT_SAMPLES;
  if (extra <= 0) return cache;
  const samples = cache.samples.slice(extra);
  return { ...cache, samples, clientTrimmed: true, droppedBefore: Math.max(cache.droppedBefore, samples[0]!.index) };
}

/**
 * Folds a backend page into the cache. A different universe or generation starts a new cache. Within one generation
 * a page that starts after the cache's end records a gap; samples already held are skipped.
 */
export function applyHistoryPage(cache: HistoryCache | null, page: HistoryPageDto): HistoryCache {
  if (!cache || cache.universeId !== page.universeId || cache.generation !== page.generation) return fresh(page);
  const incoming = page.samples.filter((s) => s.index >= cache.nextIndex);
  const gaps = incoming.length > 0 && incoming[0]!.index > cache.nextIndex ? [...cache.gaps, cache.nextIndex] : cache.gaps;
  const samples = incoming.length > 0 ? [...cache.samples, ...incoming] : cache.samples;
  return trim({
    ...cache,
    mode: page.mode,
    sampleIntervalS: page.sampleIntervalS,
    samples,
    bodies: { ...cache.bodies, ...page.bodies },
    nextIndex: incoming.length > 0 ? incoming[incoming.length - 1]!.index + 1 : cache.nextIndex,
    droppedBefore: Math.max(cache.droppedBefore, page.droppedBefore),
    truncated: page.truncated,
    gaps,
  });
}

/** The recorded state at array position `position` (0 = oldest held sample). Bodies absent then are omitted. */
export function frameAt(cache: HistoryCache, position: number): HistoryFrame | null {
  const s = cache.samples[position];
  if (!s) return null;
  const bodies: HistoryFrameBody[] = [];
  for (const [id, p] of Object.entries(s.positionsM)) {
    const meta = cache.bodies[id];
    if (!meta) continue; // a body without recorded metadata cannot be displayed honestly
    bodies.push({ id, positionM: { x: p[0], y: p[1], z: p[2] }, meta });
  }
  return { universeId: cache.universeId, generation: cache.generation, index: s.index, simulationTimeS: s.simulationTimeS, bodies };
}

/**
 * One body's recorded path as a UI-0 input. The path is broken (the `segment` changes) wherever the backend marked a
 * discontinuity, where samples are missing, and where the body was absent.
 */
export function trajectoryOf(cache: HistoryCache, bodyId: string, role: "active" | "reference"): TrajectoryInput {
  const samples: PositionSample[] = [];
  let segment = -1;
  let previousSource: { index: number; segment: number } | undefined;
  let previousHeld = -1;
  cache.samples.forEach((s, position) => {
    const p = s.positionsM[bodyId];
    if (!p) return;
    const contiguous = previousSource !== undefined && previousHeld === position - 1 && s.index === previousSource.index + 1 && s.segment === previousSource.segment;
    if (!contiguous) segment += 1;
    previousSource = { index: s.index, segment: s.segment };
    previousHeld = position;
    samples.push({ simulationTimeS: s.simulationTimeS, positionM: { x: p[0], y: p[1], z: p[2] }, segment });
  });
  return {
    key: `${cache.universeId}:${cache.generation}:${bodyId}`,
    universeId: cache.universeId,
    bodyId,
    role,
    colorHex: cache.bodies[bodyId]?.colorHex ?? "#ffffff",
    samples,
  };
}
