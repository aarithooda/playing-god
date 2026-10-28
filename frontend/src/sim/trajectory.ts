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
 * Stable trail opacity: the newest point is bright and older points fade over an estimated orbit
 * circumference. Unlike spatialTrailProgress, this does not normalize by the currently retained
 * path length, so appending samples or trimming a completed lap cannot brighten the whole orbit.
 */
export function spatialTrailOpacity(points: readonly ScenePosition[]): number[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [1];

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, point[axis]!);
      max[axis] = Math.max(max[axis]!, point[axis]!);
    }
  }
  const center = min.map((value, axis) => (value + max[axis]!) / 2);
  const radius = Math.max(...points.map((point) => Math.hypot(
    point[0] - center[0]!, point[1] - center[1]!, point[2] - center[2]!,
  )));
  let fadeLength = 2 * Math.PI * radius;
  if (!Number.isFinite(fadeLength) || fadeLength <= 0) return points.map(() => 1);

  const distanceFromEnd = new Array<number>(points.length).fill(0);
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    distanceFromEnd[i] = distanceFromEnd[i + 1]!
      + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  const MIN_TRAIL_OPACITY = 0.12;
  return distanceFromEnd.map((distance) => Math.max(MIN_TRAIL_OPACITY, 1 - distance / fadeLength));
}

/**
 * Retains at most the most recent completed orbit in a live trail. Keeping older laps makes a returning body paint the
 * same curve repeatedly, which darkens the orbit. A return is recognized only after roughly 80% of the estimated
 * circumference, so ordinary nearby samples and crossings do not reset the trail.
 */
export function trimToLatestOrbit(line: TrajectoryPolyline): TrajectoryPolyline {
  const { points, simulationTimesS } = line;
  if (points.length < 4) return line;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, point[axis]!);
      max[axis] = Math.max(max[axis]!, point[axis]!);
    }
  }
  const center = min.map((value, axis) => (value + max[axis]!) / 2);
  const radius = Math.max(...points.map((point) => Math.hypot(
    point[0] - center[0]!, point[1] - center[1]!, point[2] - center[2]!,
  )));
  if (!Number.isFinite(radius) || radius <= 0) return line;

  const returnTolerance = radius * 0.04;
  const minLoopDistance = 2 * Math.PI * radius * 0.8;
  const current = points[points.length - 1]!;
  const currentBefore = points[points.length - 2]!;
  const currentDirection = [current[0] - currentBefore[0], current[1] - currentBefore[1], current[2] - currentBefore[2]];
  const currentDirectionLength = Math.hypot(...currentDirection);
  // The trail has returned to the current point when the current point lies on an EARLIER SEGMENT of it (not merely near an earlier
  // vertex): recorded samples can be a large part of an orbit apart (a big step at high speed, a fast inner orbit), and then no vertex
  // comes within the tolerance of the current point although the path has plainly closed, so every earlier revolution stayed drawn
  // as a dense web of overlapping chords.
  let traveled = 0;
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const a = points[i]!;
    const next = points[i + 1]!;
    const segment = [next[0] - a[0], next[1] - a[1], next[2] - a[2]];
    const segmentLength = Math.hypot(...segment);
    if (segmentLength > 0) {
      // The closest point to the current position on this segment (clamped), and how far along it that is.
      const u = Math.min(1, Math.max(0, ((current[0] - a[0]) * segment[0]! + (current[1] - a[1]) * segment[1]! + (current[2] - a[2]) * segment[2]!) / (segmentLength * segmentLength)));
      const hit: ScenePosition = [a[0] + segment[0]! * u, a[1] + segment[1]! * u, a[2] + segment[2]! * u];
      const distance = Math.hypot(hit[0] - current[0], hit[1] - current[1], hit[2] - current[2]);
      const alongPath = traveled + segmentLength * (1 - u);
      const sameDirection = currentDirectionLength > 0
        && (segment[0]! * currentDirection[0]! + segment[1]! * currentDirection[1]! + segment[2]! * currentDirection[2]!)
          / (segmentLength * currentDirectionLength) > 0.5;
      if (alongPath >= minLoopDistance && sameDirection && distance <= returnTolerance) {
        // Start the kept trail at the crossing itself (its time interpolated), so no orbit's worth of path is lost or invented.
        const t0 = simulationTimesS[i]!;
        const t1 = simulationTimesS[i + 1]!;
        if (u >= 1) return { points: points.slice(i + 1), simulationTimesS: simulationTimesS.slice(i + 1) };
        return { points: [hit, ...points.slice(i + 1)], simulationTimesS: [t0 + (t1 - t0) * u, ...simulationTimesS.slice(i + 1)] };
      }
    }
    traveled += segmentLength;
  }
  return line;
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

/**
 * The recorded samples at or before `cutS`. Live playback draws the active trail from these plus a per-frame head that ends at the
 * drawn body (TrajectoryLayer); samples after the cut are committed history that is ahead of what the screen shows and must not be drawn.
 */
export function clipSamplesTo(samples: readonly PositionSample[], cutS: number): PositionSample[] {
  return samples.filter((s) => s.simulationTimeS <= cutS);
}

/**
 * The samples a LIVE active trail is drawn from, up to `cutS`: the backend's recorded history before the motion buffer's own trail begins,
 * then that trail (dense along the interpolated path, see sim/motion/trail.ts). Recorded history alone can be a large part of an orbit
 * apart per sample at high speed, which draws as chords; the dense points follow the real path. The recorded samples are never altered,
 * only joined to the points that continue them (same `segment` as the history sample of that moment, so an edit still breaks the line).
 */
export function liveTrailSamples(
  history: readonly PositionSample[],
  trail: readonly { t: number; p: readonly [number, number, number] }[],
  cutS: number,
): PositionSample[] {
  if (trail.length === 0) return clipSamplesTo(history, cutS);
  const t0 = trail[0]!.t;
  const kept = history.filter((s) => s.simulationTimeS < t0 && s.simulationTimeS <= cutS);
  const segment = (history.find((s) => s.simulationTimeS >= t0) ?? history[history.length - 1])?.segment ?? 0;
  const dense: PositionSample[] = [];
  for (const pt of trail) {
    if (pt.t > cutS) break;
    dense.push({ simulationTimeS: pt.t, positionM: { x: pt.p[0], y: pt.p[1], z: pt.p[2] }, segment });
  }
  return [...kept, ...dense];
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
