// The part of a live orbit trail that is NOT in the (React-built) recorded line, rebuilt every frame (pure; SI units, physics frame).
//
// The recorded line is built from the trail recorder's points up to a cut time and only rebuilt when React re-renders after the displayed
// segment changes, so on screen it can end one or more segments before the displayed segment starts. The head must therefore start
// where the DRAWN recorded line ends (`staticCutS`), not where the displayed segment starts, or that stretch of the path is missing for
// those frames and the trail looks detached from, and late behind, the planet.
import type { V3 } from "./kepler";
import type { MotionBuffer } from "./MotionBuffer";

export interface TrailHead {
  /** Points from the end of the drawn recorded line to the planet's drawn position, in order; the last one IS the drawn position. */
  points: V3[];
  /** The simulation time of the last point (the displayed time). */
  timeS: number;
  /** The simulation time of the first point: where the head takes over from the drawn recorded line. */
  fromS: number;
}

export function trailHead(
  motion: MotionBuffer,
  bodyId: string,
  staticCutS: number | null,
  wallMs: number,
  minPieces: number,
  wanted?: ReadonlySet<string>,
): TrailHead | null {
  const path = motion.samplePath(wallMs, minPieces, wanted);
  const own = path?.paths.get(bodyId);
  if (!path || !own || own.length === 0) return null;
  // The recorded points from the drawn line's LAST point (inclusive: the two lines must share that end point, or the stretch between them
  // is not drawn) up to the displayed segment's start (newest first, so only the few stale segments are visited). The point AT the
  // segment start is the head's own first point. A cut AFTER the segment start is stale from before a flush (edit, reset, restore):
  // nothing of it may be drawn.
  const tail: V3[] = [];
  let fromS = path.startS;
  if (staticCutS !== null && staticCutS <= path.startS) {
    const recorded = motion.trail.pointsFor(bodyId);
    for (let i = recorded.length - 1; i >= 0 && recorded[i]!.t >= staticCutS; i--) if (recorded[i]!.t < path.startS) {
      tail.push(recorded[i]!.p);
      fromS = recorded[i]!.t;
    }
    tail.reverse();
  }
  return { points: tail.length ? [...tail, ...own] : own, timeS: path.timeS, fromS };
}

/**
 * Which committed version of the recorded trail line to draw: the newest one, unless the buffer is held (`heldFrameWallMs`, the wall time
 * at which the frozen frame was drawn), then the newest one committed BEFORE that frame, which is the line that frame drew (or the oldest
 * kept, if none is that old). Versions are oldest first, `atMs` being when React committed each.
 */
export function versionShownAt<V extends { atMs: number }>(versions: readonly V[], heldFrameWallMs: number | null): V | undefined {
  if (heldFrameWallMs === null) return versions[versions.length - 1];
  let shown = versions[0];
  for (const v of versions) if (v.atMs < heldFrameWallMs) shown = v;
  return shown;
}

/**
 * The build of the recorded line to draw this frame. Playing (`heldFrameWallMs` null): the newest committed. Held: exactly the build the
 * frozen frame showed (`shownByFrame`, by draw time), which may be an older one if that frame was itself drawn while an earlier pause was
 * held; only if that frame is no longer remembered, the newest committed before it (`versionShownAt`).
 */
export function buildShownAt<V extends { atMs: number }>(
  committed: readonly V[],
  shownByFrame: readonly { wallMs: number | null; version: V }[],
  heldFrameWallMs: number | null,
): V | undefined {
  if (heldFrameWallMs === null) return committed[committed.length - 1];
  return shownByFrame.find((f) => f.wallMs === heldFrameWallMs)?.version ?? versionShownAt(committed, heldFrameWallMs);
}
