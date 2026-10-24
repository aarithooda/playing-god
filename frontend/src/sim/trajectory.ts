// Pure helpers for drawing recorded trajectories (UI-0). No React, no three.js.
import type { PositionSample } from "../render/contract";
import { toScenePosition, type RenderTransform, type ScenePosition } from "./renderTransform";

export const MAX_TRAJECTORY_POINTS = 5000;
export const MAX_RENDERED_TRAJECTORY_POINTS = 10000;
const CURVE_SUBDIVISIONS = 8;

export interface TrajectoryPolyline {
  points: ScenePosition[];
  simulationTimesS: number[];
}

/** Spatial progress from a trail's oldest endpoint (0) to its current endpoint (1), independent of sample time. */
export function spatialTrailProgress(points: readonly ScenePosition[]): number[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [1];
  const distanceFromEnd = new Array<number>(points.length).fill(0);
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    distanceFromEnd[i] = distanceFromEnd[i + 1]!
      + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  const totalLength = distanceFromEnd[0]!;
  if (totalLength === 0) return points.map(() => 1);
  return distanceFromEnd.map((distance) => 1 - distance / totalLength);
}

/**
 * Smooths only the displayed line between recorded points. This is a bounded centripetal Catmull–Rom rendering interpolation,
 * not a prediction or additional simulation history; endpoints and their simulation times remain exact.
 */
export function smoothTimedPolyline(line: TrajectoryPolyline): TrajectoryPolyline {
  const { points, simulationTimesS } = line;
  if (points.length < 3) return { points: points.slice(), simulationTimesS: simulationTimesS.slice() };

  const subdivisions = Math.max(1, Math.min(
    CURVE_SUBDIVISIONS,
    Math.floor((MAX_RENDERED_TRAJECTORY_POINTS - 1) / (points.length - 1)),
  ));
  const smoothPoints: ScenePosition[] = [];
  const smoothTimes: number[] = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const time0 = simulationTimesS[i]!;
    const time1 = simulationTimesS[i + 1]!;
    const knotSpan = (a: ScenePosition, b: ScenePosition) => Math.max(
      Math.sqrt(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])),
      1e-4,
    );
    const knot0 = 0;
    const knot1 = knot0 + knotSpan(p0, p1);
    const knot2 = knot1 + knotSpan(p1, p2);
    const knot3 = knot2 + knotSpan(p2, p3);

    for (let step = 0; step < subdivisions; step += 1) {
      const u = step / subdivisions;
      const t = knot1 + (knot2 - knot1) * u;
      const point = [0, 1, 2].map((axis) => {
        const a1 = ((knot1 - t) / (knot1 - knot0)) * p0[axis]! + ((t - knot0) / (knot1 - knot0)) * p1[axis]!;
        const a2 = ((knot2 - t) / (knot2 - knot1)) * p1[axis]! + ((t - knot1) / (knot2 - knot1)) * p2[axis]!;
        const a3 = ((knot3 - t) / (knot3 - knot2)) * p2[axis]! + ((t - knot2) / (knot3 - knot2)) * p3[axis]!;
        const b1 = ((knot2 - t) / (knot2 - knot0)) * a1 + ((t - knot0) / (knot2 - knot0)) * a2;
        const b2 = ((knot3 - t) / (knot3 - knot1)) * a2 + ((t - knot1) / (knot3 - knot1)) * a3;
        return ((knot2 - t) / (knot2 - knot1)) * b1 + ((t - knot1) / (knot2 - knot1)) * b2;
      }) as ScenePosition;
      smoothPoints.push(point);
      smoothTimes.push(time0 + (time1 - time0) * u);
    }
  }

  smoothPoints.push(points[points.length - 1]!);
  smoothTimes.push(simulationTimesS[simulationTimesS.length - 1]!);
  return { points: smoothPoints, simulationTimesS: smoothTimes };
}

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
  return buildTimedPolylines(samples, transform, maxPoints).map((line) => line.points);
}

/** Same recorded geometry as buildPolylines, retaining backend sample times for interpolation bookkeeping. */
export function buildTimedPolylines(samples: readonly PositionSample[], transform: RenderTransform, maxPoints = MAX_TRAJECTORY_POINTS): TrajectoryPolyline[] {
  const thinned = decimate(samples, maxPoints);
  const lines: TrajectoryPolyline[] = [];
  let current: ScenePosition[] = [];
  let times: number[] = [];
  let segment: number | undefined;
  for (const s of thinned) {
    if (segment !== undefined && s.segment !== segment) {
      lines.push({ points: current, simulationTimesS: times });
      current = [];
      times = [];
    }
    segment = s.segment;
    current.push(toScenePosition(s.positionM, transform));
    times.push(s.simulationTimeS);
  }
  if (current.length > 0) lines.push({ points: current, simulationTimesS: times });
  return lines;
}
