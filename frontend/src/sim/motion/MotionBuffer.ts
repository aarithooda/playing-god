// A short buffer of AUTHORITATIVE backend states and the display clock that replays them continuously (pure; time is injected).
//
// The backend answers one step request with one state, and a step can take longer than a frame by orders of magnitude (about
// 0.14 s of computing per 1e5 s of simulated time with the moons preset). Drawing each state the moment it arrives makes bodies
// jump; the buffer instead lets the DISPLAYED simulation time advance smoothly towards the newest state and evaluates the
// bodies at that time (interpolate.ts). The displayed time runs about one step interval behind the newest state: nothing is
// ever extrapolated past what the backend has reported, so there is no prediction to invalidate, only a past to cut:
//  - `flush` (a user edit, a create or delete, a reset, a restore, a reload): the buffer is dropped and the new state shows at once;
//  - `cut` ids (bodies that collided during a step) are shown at their new state without interpolation;
//  - a state whose time does not move forward flushes.
// When the backend is slower than the display needs, the displayed time reaches the newest state and holds there until the
// next one arrives (a stall, never an invented position).
import type { V3 } from "./kepler";
import { evaluateSegment, planSegment, type MotionSample, type SegmentPlan } from "./interpolate";
import { segmentPieces, TrailRecorder } from "./trail";

export type { MotionSample } from "./interpolate";

/** Wall-clock seconds assumed for the first interval, before any has been measured. */
export const DEFAULT_INTERVAL_S = 0.5;
/** The displayed time is planned to reach each new state this much AFTER the interval estimate, so small delays do not stall it. */
export const INTERVAL_PADDING = 1.1;
export const MIN_INTERVAL_S = 0.06;
export const MAX_INTERVAL_S = 20;
/** A single manual step is animated over at most this long. */
export const SINGLE_STEP_MAX_S = 1.0;
/** The displayed time is never allowed to trail the newest state by more than this many step lengths. */
// The display can be one step behind the released state, a pause holds up to 3 look-ahead steps plus the one in flight, and the first
// step after Resume is one more: resuming must never cut into that backlog (that would be a jump), so allow it all with a step to spare.
export const MAX_BACKLOG_STEPS = 7;
/**
 * Hard bound on the states kept. `sample()` trims the past the displayed time has left, but nothing samples while no canvas is mounted
 * (history view, hidden tab), so `push` must bound the buffer itself. The displayed time is never more than MAX_BACKLOG_STEPS states
 * behind the newest, so this many states always contain the segment being shown.
 */
export const MAX_BUFFERED_STATES = MAX_BACKLOG_STEPS + 3;
/** Recent frames remembered (with when their drawing finished), so a Pause can freeze the one that was on screen at the press. */
export const FRAME_MEMORY = 8;

export interface PushOptions {
  /** Wall-clock time (ms) at which the state arrived. */
  wallMs: number;
  /** Drop everything buffered and show this state at once. */
  flush?: boolean;
  /** The backend is playing (steps follow each other); false for a manual single step. */
  playing?: boolean;
  /** Simulated seconds of the NEXT step request, to scale the measured cost per simulated second (default: this step's length). */
  nextStepS?: number;
  /**
   * The wall-clock seconds until the next state is released, when the caller paces the releases itself (the Play loop's steady
   * cadence). It replaces the measured estimate and its padding, which exist for a backend that decides the arrival times: with a
   * steady release the padding would make the displayed time fall further behind the released one with every state.
   */
  intervalS?: number;
  /**
   * Only buffer the state (and record its trail): the displayed time is frozen (see `hold`) and neither moves nor re-plans. For the steps that
   * are already computed when Pause is pressed.
   */
  hold?: boolean;
}

export class MotionBuffer {
  /** Orbit trails through the released states, drawn with the same interpolation as the bodies (trail.ts). */
  readonly trail = new TrailRecorder();
  private queue: MotionSample[] = [];
  private plans: SegmentPlan[] = [];
  private anchorWallMs = 0;
  /** The simulation time of the last frame that was actually drawn (the last `sample`): what the user last saw. */
  private lastShownS: number | null = null;
  private lastDrawWallMs: number | null = null;
  private anchorSimS = 0;
  private rateSimPerWallMs = 0;
  private lastArrivalWallMs: number | null = null;
  /** Measured wall-clock seconds of computing and transport per simulated second (smoothed). */
  private costPerSimS: number | null = null;
  private lastIntervalS = 0;
  /**
   * The last FRAME_MEMORY frames drawn, oldest first: the simulation time each showed and when its drawing finished (`frameDrawn`; null while
   * it is still being drawn). The segments they show are kept, so `hold` can go back to any of them.
   */
  private frames: { timeS: number; wallMs: number; doneMs: number | null }[] = [];
  /** While held: the wall-clock time at which the frozen frame was sampled (what everything drawn while paused must match); else null. */
  private heldWallMs: number | null = null;

  /** The wall-clock time of the last frame drawn (the last `sample`). Everything drawn in a frame (planet, trail head) must use this one instant. */
  get drawWallMs(): number | null {
    return this.lastDrawWallMs;
  }

  /**
   * While held (paused), the wall-clock time at which the frame that stays on screen was originally drawn; null while the display moves.
   * Anything React rebuilt after that frame (the recorded trail line) was not on screen at the press and must not be shown while held.
   */
  get heldFrameWallMs(): number | null {
    return this.heldWallMs;
  }

  /** Simulation time of the newest state, or null when empty. */
  get latestTimeS(): number | null {
    return this.queue.length ? this.queue[this.queue.length - 1]!.t : null;
  }

  /** Measured wall-clock seconds the backend needs per simulated second (smoothed), or null before two steps were seen while playing. */
  get costPerSimulatedSecond(): number | null {
    return this.costPerSimS;
  }

  /** Wall-clock seconds between the last two states that arrived while playing (0 if unknown). */
  get lastMeasuredIntervalS(): number {
    return this.lastIntervalS;
  }

  get size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
    this.plans = [];
    this.lastArrivalWallMs = null;
    this.costPerSimS = null;
    this.lastIntervalS = 0;
    this.rateSimPerWallMs = 0;
    this.trail.clear();
    this.lastShownS = null;
    this.frames = [];
    this.heldWallMs = null;
  }

  push(sample: MotionSample, opts: PushOptions): void {
    const last = this.queue[this.queue.length - 1];
    if (opts.flush || !last || !(sample.t > last.t)) {
      this.queue = [sample];
      this.plans = [];
      this.lastShownS = null;
      this.frames = [];
      this.heldWallMs = null;
      this.trail.start(sample);
      this.anchorWallMs = opts.wallMs;
      this.anchorSimS = sample.t;
      this.rateSimPerWallMs = 0;
      this.lastArrivalWallMs = opts.wallMs;
      return;
    }
    const now = this.displayTime(opts.wallMs);
    const stepS = sample.t - last.t;
    // Measure how long a simulated second costs, from the time between arrivals while the backend is playing.
    if (!opts.hold && opts.playing && this.lastArrivalWallMs !== null) {
      this.lastIntervalS = (opts.wallMs - this.lastArrivalWallMs) / 1000;
      const measured = this.lastIntervalS / stepS;
      this.costPerSimS = this.costPerSimS === null ? measured : 0.5 * this.costPerSimS + 0.5 * measured;
    }
    if (!opts.hold) this.lastArrivalWallMs = opts.wallMs;
    let intervalS = this.costPerSimS === null ? DEFAULT_INTERVAL_S : this.costPerSimS * (opts.nextStepS ?? stepS);
    intervalS = Math.min(MAX_INTERVAL_S, Math.max(MIN_INTERVAL_S, intervalS * INTERVAL_PADDING));
    if (!opts.playing) intervalS = Math.min(intervalS, SINGLE_STEP_MAX_S);
    // The caller's pace is a MINIMUM: when the states really arrive further apart (a backend that cannot keep up with the cadence), plan
    // over the gap just measured, or the display would reach each state at once and then stand still until the next one.
    if (opts.intervalS !== undefined && opts.playing) intervalS = Math.min(MAX_INTERVAL_S, Math.max(MIN_INTERVAL_S, opts.intervalS, this.lastIntervalS));
    this.queue.push(sample);
    const plan = planSegment(last, sample);
    this.plans.push(plan);
    const keepS = this.keepFromS(now);
    // A held state must not change the drawn trail: it records its points but trims none (trimming dropped the oldest points, which were
    // the ones drawn up to the displayed segment); otherwise only points before the oldest segment that may still be shown are dropped.
    this.trail.record(plan, opts.hold ? -Infinity : this.planAt(keepS).a.t);
    // Bound the buffer, but only by dropping segments the displayed time has completely passed. Dropping the oldest one regardless could
    // drop the segment ON SCREEN (a held buffer is not sampled, so nothing else trims it while look-ahead steps keep arriving): the next
    // frame was then evaluated from a later segment, the same displayed time at a later position. A remembered frame whose segment is
    // dropped here (a backlog past the cap, e.g. a hidden tab) can no longer be gone back to.
    while (this.queue.length > MAX_BUFFERED_STATES && this.plans.length > 1 && this.plans[0]!.b.t < now) {
      this.queue.shift();
      this.plans.shift();
    }
    if (this.frames.length && this.frames[0]!.timeS < this.plans[0]!.a.t) this.frames = this.frames.filter((f) => f.timeS >= this.plans[0]!.a.t);
    if (opts.hold) return; // frozen: the displayed time and its pace are not touched
    this.heldWallMs = null;
    // Never trail the newest state by more than a few steps (a long frame stall or a hidden tab): catch up instead of replaying.
    const floor = sample.t - MAX_BACKLOG_STEPS * stepS;
    const from = Math.max(now, floor);
    this.anchorSimS = from;
    this.anchorWallMs = opts.wallMs;
    // With a paced release, hold the speed of the motion (one step per interval) however far behind the display is, e.g. right after a
    // pause held several computed steps: it then resumes at its normal speed from where it stopped instead of racing through them.
    const paced = opts.intervalS !== undefined && opts.playing;
    const behindSteps = paced ? Math.min(MAX_BACKLOG_STEPS, Math.max(1, (sample.t - from) / stepS)) : 1;
    this.rateSimPerWallMs = (sample.t - from) / (intervalS * 1000 * behindSteps);
  }

  /** Marks the frame last sampled as drawn at `wallMs` (the renderer calls this once the frame's drawing has finished). */
  frameDrawn(wallMs: number): void {
    const frame = this.frames[this.frames.length - 1];
    if (frame && frame.doneMs === null) frame.doneMs = wallMs;
  }

  /**
   * Freezes the displayed time (a pause) at the frame the user was looking at, so the picture stops exactly there. The states already
   * buffered stay, so a later `push` carries on from this exact time with no jump. The buffer only moves again when something is pushed.
   *
   * `pressedAtMs` is when the Pause button physically went down (the event's timestamp). The browser dispatches the press only once the
   * frame it is computing has been drawn, so that frame (not yet on screen at the press) and possibly a step released in between come
   * BEFORE the handler: measured at the maximum speed, a frame finished 1-17 ms after the press in more than half of the presses, and freezing
   * it left the planet a frame further on than the user saw, 1-6 orbits at that speed. With `pressedAtMs` the frozen frame is the last one
   * whose drawing finished before the press; without it (entering history, a restore), the last frame drawn.
   */
  hold(wallMs: number, pressedAtMs?: number): void {
    // Still held (nothing pushed since the last hold: e.g. Resume pressed but no state arrived yet, or the play loop's effect cleanup right
    // after Pause): nothing has moved, so nothing changes. Choosing a new frozen frame here switched the trail to a version rebuilt while held.
    if (this.heldWallMs !== null) return;
    const now = this.displayTime(wallMs);
    let shownS = this.lastShownS === null ? now : Math.min(now, this.lastShownS);
    let shownWallMs = this.lastShownS === null || now < this.lastShownS ? wallMs : this.lastDrawWallMs ?? wallMs;
    if (pressedAtMs !== undefined && this.frames.length) {
      let seen = this.frames[0]!;
      for (const f of this.frames) if (f.doneMs !== null && f.doneMs <= pressedAtMs) seen = f;
      if (seen.timeS <= shownS) {
        shownS = seen.timeS;
        shownWallMs = seen.wallMs;
      }
    }
    this.heldWallMs = shownWallMs;
    this.anchorSimS = shownS;
    this.anchorWallMs = wallMs;
    this.rateSimPerWallMs = 0;
    // The time the picture stood still is not an arrival gap: measuring across it would make the first state after Resume crawl.
    this.lastArrivalWallMs = null;
    this.lastIntervalS = 0;
  }

  /** The displayed simulation time at wall-clock `wallMs`: advances at the planned rate and never passes the newest state. */
  displayTime(wallMs: number): number {
    const latest = this.latestTimeS;
    if (latest === null) return 0;
    const t = this.anchorSimS + this.rateSimPerWallMs * Math.max(0, wallMs - this.anchorWallMs);
    return Math.min(latest, t);
  }

  /**
   * Simulation time at which the segment being displayed starts (the older of the two states bracketing the displayed time), as of the
   * last `sample()`. A recorded trail drawn up to this time and a head from here to the displayed positions (`samplePath`) meet exactly.
   */
  get segmentStartS(): number | null {
    if (this.plans.length === 0) return this.queue[0]?.t ?? null;
    return this.lastShownS === null ? this.plans[0]!.a.t : this.planAt(this.lastShownS).a.t;
  }

  /**
   * The segment that contains simulation time `t` (the last one at or past the newest state). Requires at least one segment. At a state's
   * exact time it is the segment ENDING there: a display stalled at the newest state (the backend slower than the display, common at the
   * maximum speed) stays in its segment when the next state arrives. Choosing the new segment there moved the trail's cut, and so redrew the
   * trail, after a Pause.
   */
  private planAt(t: number): SegmentPlan {
    return this.plans.find((p) => t <= p.b.t) ?? this.plans[this.plans.length - 1]!;
  }

  /** The oldest simulation time that may still be shown: the displayed time `nowS`, or a remembered frame a Pause can go back to. */
  private keepFromS(nowS: number): number {
    return Math.min(nowS, this.frames[0]?.timeS ?? nowS);
  }

  /**
   * The path every body has followed through the segment being displayed, from its start to the displayed time: `count + 1` points per
   * body (more when the displayed part of the segment spans a large part of an orbit: at least enough that no piece spans more than
   * TRAIL_PIECE_RAD), the last one identical to what `sample(wallMs)` returns. It is the same interpolation the bodies are drawn with, so
   * a trail head built from it can never lead or lag the body. Null when the buffer is empty.
   */
  samplePath(wallMs: number, count: number, wanted?: ReadonlySet<string>): { startS: number; timeS: number; paths: Map<string, V3[]> } | null {
    const frame = this.sample(wallMs);
    if (!frame) return null;
    const plan = this.plans.length ? this.planAt(frame.timeS) : undefined;
    const startS = plan ? plan.a.t : frame.timeS;
    const paths = new Map<string, V3[]>();
    if (plan && frame.timeS > startS) {
      const whole = plan.b.t - plan.a.t;
      count = Math.max(count, Math.ceil(segmentPieces(plan, wanted) * ((frame.timeS - startS) / whole)));
      const newest = this.queue[this.queue.length - 1]!;
      for (let k = 0; k < count; k++) {
        const at = evaluateSegment(plan, startS + ((frame.timeS - startS) * k) / count, wanted);
        for (const b of newest.bodies) {
          if (wanted && !wanted.has(b.id)) continue;
          const p = at.get(b.id);
          if (p) (paths.get(b.id) ?? paths.set(b.id, []).get(b.id)!).push(p);
        }
      }
    }
    for (const [id, p] of frame.positions) if (!wanted || wanted.has(id)) (paths.get(id) ?? paths.set(id, []).get(id)!).push(p);
    return { startS, timeS: frame.timeS, paths };
  }

  /** Displayed positions (SI, physics frame) of every body at wall-clock `wallMs`, or null when the buffer is empty. */
  sample(wallMs: number): { timeS: number; positions: Map<string, V3> } | null {
    if (this.queue.length === 0) return null;
    const timeS = this.displayTime(wallMs);
    // One entry per frame: the trail head samples again at the same instant (`drawWallMs`) within the frame.
    const newFrame = wallMs !== this.lastDrawWallMs || this.frames.length === 0;
    this.lastShownS = timeS;
    this.lastDrawWallMs = wallMs;
    if (newFrame) {
      this.frames.push({ timeS, wallMs, doneMs: null });
      if (this.frames.length > FRAME_MEMORY) this.frames.shift();
    }
    // Drop the segments the displayed time and every remembered frame have completely passed (keep the one each is inside).
    const keepS = this.keepFromS(timeS);
    while (this.plans.length > 1 && keepS > this.plans[0]!.b.t) {
      this.plans.shift();
      this.queue.shift();
    }
    const plan = this.plans.length ? this.planAt(timeS) : undefined;
    if (!plan) {
      const only = this.queue[0]!;
      return { timeS: only.t, positions: new Map(only.bodies.map((b) => [b.id, b.p])) };
    }
    const positions = evaluateSegment(plan, timeS);
    // Bodies that exist only in the newest state (just created) have no past: show them where they are.
    const newest = this.queue[this.queue.length - 1]!;
    for (const b of newest.bodies) if (!positions.has(b.id)) positions.set(b.id, b.p);
    return { timeS, positions };
  }
}
