// The live orbit trail, built from the SAME interpolation the bodies are drawn with (pure; SI units, physics frame).
//
// Why it exists. The backend records one history sample per step. At high playback speed (or for a fast inner orbit) consecutive samples
// can be a large part of an orbit apart - 143 degrees per step for a body at 0.06 au stepped every 2 days - and a line through samples
// that sparse is a star polygon: every revolution adds another set of long chords and the trail becomes a dense web that is not the path
// the body took. The positions themselves are right; there are simply too few of them. Between two released states the motion buffer
// already knows the path (Kepler propagation for long arcs), so each released segment is cut into enough pieces that no piece spans more
// than TRAIL_PIECE_RAD of the fastest orbit in it, and those points are kept here. The released states stay exact end points; nothing is
// extrapolated past a released state, and no second integrator exists.
import { angularRate, type V3 } from "./kepler";
import { evaluateSegment, type MotionSample, type SegmentPlan } from "./interpolate";

export interface TrailPoint {
  /** Simulation time, s. */
  t: number;
  /** Position, m. */
  p: V3;
}

/** Largest angle (rad) of a body's orbit about its host that one trail piece may span (~5.7 degrees). */
export const TRAIL_PIECE_RAD = 0.1;
/** Most pieces one released segment is cut into (a segment spanning more than ~11 revolutions is drawn at this resolution). */
export const TRAIL_MAX_PIECES = 720;
/** Most points kept per body; the oldest are dropped past this. */
export const TRAIL_MAX_POINTS = 4000;

/**
 * How many pieces a segment is cut into so that no hosted body's orbit advances more than TRAIL_PIECE_RAD within one piece (at least 1).
 * With `wanted`, only those bodies count: a fast moon nobody is drawing a trail for must not make every piece of the segment finer.
 */
export function segmentPieces(plan: SegmentPlan, wanted?: ReadonlySet<string> | null): number {
  const dt = plan.b.t - plan.a.t;
  if (!(dt > 0)) return 1;
  let angle = 0;
  for (const body of plan.order) {
    if (body.mode === "cut" || body.host < 0 || (wanted && !wanted.has(body.id))) continue;
    const theta = Math.abs(angularRate(body.rA, body.vA, body.mu)) * dt;
    if (Number.isFinite(theta) && theta > angle) angle = theta;
  }
  return Math.min(TRAIL_MAX_PIECES, Math.max(1, Math.ceil(angle / TRAIL_PIECE_RAD)));
}

export class TrailRecorder {
  private trails = new Map<string, TrailPoint[]>();
  /** The bodies whose trail is being drawn; null = every body. Recording costs time per piece per body, so only these are recorded. */
  private wanted: ReadonlySet<string> | null = null;

  /** Sets which bodies to record (the ones with a trail on screen). A body that becomes wanted is recorded from the start of the next released segment. */
  setWanted(ids: ReadonlySet<string> | null): void {
    this.wanted = ids;
    if (ids) for (const id of [...this.trails.keys()]) if (!ids.has(id)) this.trails.delete(id);
  }

  get wantedIds(): ReadonlySet<string> | null {
    return this.wanted;
  }

  /** Starts from one state (a load, an edit, a reset, ...): every wanted body's trail is that single point. */
  start(sample: MotionSample): void {
    this.trails = new Map(sample.bodies.filter((b) => !this.wanted || this.wanted.has(b.id)).map((b) => [b.id, [{ t: sample.t, p: b.p }]]));
  }

  clear(): void {
    this.trails = new Map();
  }

  /** The recorded points of a body, oldest first (empty when it has none). Do not modify. */
  pointsFor(id: string): readonly TrailPoint[] {
    return this.trails.get(id) ?? [];
  }

  /**
   * Appends the path through one released segment A -> B. Bodies removed in B lose their trail; bodies that took part in a collision or are new restart theirs.
   * Past TRAIL_MAX_POINTS the oldest points are dropped, but never one at or after `keepFromS` (the start of the oldest segment that may still
   * be on screen) and never the newest points before it: dropping those changed the drawn trail. `-Infinity` drops nothing (a state held at
   * a pause must not change the picture); the default bounds the whole trail as before.
   */
  record(plan: SegmentPlan, keepFromS = Infinity): void {
    const { a, b } = plan;
    const inB = new Set(b.bodies.map((x) => x.id));
    for (const id of [...this.trails.keys()]) if (!inB.has(id)) this.trails.delete(id);
    const continuing = new Set<string>();
    const isWanted = (id: string) => !this.wanted || this.wanted.has(id);
    for (const body of plan.order) {
      if (!isWanted(body.id)) continue;
      if (body.mode === "cut") {
        this.trails.set(body.id, [{ t: b.t, p: body.b.p }]); // discontinuous across this step: restart at the new state
        continue;
      }
      // A body present at both ends of the segment is recorded from the segment's START. If it has no trail ending there (it was not wanted
      // when the recorder last started or recorded: e.g. created a moment ago, before its trajectory existed, so not yet drawn), start it at
      // A. Starting it at B instead left the whole first segment out, and the drawn line jumped from the history sample at A straight to B.
      const pts = this.trails.get(body.id);
      if (!pts || pts[pts.length - 1]!.t !== a.t) this.trails.set(body.id, [{ t: a.t, p: body.a.p }]);
      continuing.add(body.id);
    }
    for (const x of b.bodies) if (isWanted(x.id) && !this.trails.has(x.id)) this.trails.set(x.id, [{ t: b.t, p: x.p }]);
    const pieces = segmentPieces(plan, this.wanted);
    const dt = b.t - a.t;
    for (let k = 1; k <= pieces; k++) {
      const t = k === pieces ? b.t : a.t + (dt * k) / pieces;
      const at = evaluateSegment(plan, t, continuing);
      for (const id of continuing) {
        const p = at.get(id);
        if (p) this.trails.get(id)!.push({ t, p });
      }
    }
    // The bound applies to the points before `keepFromS`: the newest 90 % of TRAIL_MAX_POINTS of those are kept (they are the drawn line's
    // past), and none after it (bounded by the buffer: at most MAX_BUFFERED_STATES segments).
    for (const [id, pts] of this.trails) {
      if (pts.length <= TRAIL_MAX_POINTS) continue;
      let before = 0;
      while (before < pts.length && pts[before]!.t < keepFromS) before++;
      const drop = before - Math.floor(TRAIL_MAX_POINTS * 0.9);
      if (drop > 0) this.trails.set(id, pts.slice(drop));
    }
  }
}
