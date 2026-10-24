// Pure helpers for drawing recorded trajectories (UI-0). No React, no three.js.
import type { PositionSample } from "../render/contract";
import { toScenePosition, type RenderTransform, type ScenePosition } from "./renderTransform";

export const MAX_TRAJECTORY_POINTS = 5000;

/** SI samples -> scene positions, using the same transform as the bodies. */
export function toSceneSamples(samples: readonly PositionSample[], transform: RenderTransform): ScenePosition[] {
  return samples.map((s) => toScenePosition(s.positionM, transform));
}

/**
 * Thins a sample list to at most `maxPoints` without changing its shape at the places that matter: the first and last
 * samples and both ends of every segment are always kept, and the rest is a regular stride. It never invents a point.
 */
export function decimate(samples: readonly PositionSample[], maxPoints = MAX_TRAJECTORY_POINTS): PositionSample[] {
  const n = samples.length;
  if (n <= maxPoints) return samples.slice();
  const keep = new Set<number>([0, n - 1]);
  for (let i = 1; i < n; i += 1) {
    if (samples[i]!.segment !== samples[i - 1]!.segment) {
      keep.add(i - 1);
      keep.add(i);
    }
  }
  let anchors = [...keep].sort((a, b) => a - b);
  if (anchors.length > maxPoints) {
    // More segment ends than the budget: keep first, last and an even spread of the others.
    const inner = anchors.slice(1, -1);
    const room = Math.max(maxPoints - 2, 0);
    const stride = Math.ceil(inner.length / Math.max(room, 1));
    anchors = [anchors[0]!, ...inner.filter((_, i) => i % stride === 0).slice(0, room), anchors[anchors.length - 1]!];
    return anchors.map((i) => samples[i]!);
  }
  const budget = maxPoints - anchors.length;
  const interior = n - anchors.length;
  const stride = budget > 0 ? Math.ceil(interior / budget) : Infinity;
  const picked = new Set(anchors);
  let counter = 0;
  for (let i = 0; i < n; i += 1) {
    if (keep.has(i)) continue;
    if (counter % stride === 0 && picked.size < maxPoints) picked.add(i);
    counter += 1;
  }
  return [...picked].sort((a, b) => a - b).map((i) => samples[i]!);
}

/** Continuous pieces of a path: a new piece starts wherever `segment` changes, so nothing is drawn across a jump. */
export function buildPolylines(samples: readonly PositionSample[], transform: RenderTransform, maxPoints = MAX_TRAJECTORY_POINTS): ScenePosition[][] {
  const thinned = decimate(samples, maxPoints);
  const lines: ScenePosition[][] = [];
  let current: ScenePosition[] = [];
  let segment: number | undefined;
  for (const s of thinned) {
    if (segment !== undefined && s.segment !== segment) {
      lines.push(current);
      current = [];
    }
    segment = s.segment;
    current.push(toScenePosition(s.positionM, transform));
  }
  if (current.length > 0) lines.push(current);
  return lines;
}
