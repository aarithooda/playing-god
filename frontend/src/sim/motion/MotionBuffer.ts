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
export const MAX_BACKLOG_STEPS = 3;
/**
 * Hard bound on the states kept. `sample()` trims the past the displayed time has left, but nothing samples while no canvas is mounted
 * (history view, hidden tab), so `push` must bound the buffer itself. The displayed time is never more than MAX_BACKLOG_STEPS states
 * behind the newest, so this many states always contain the segment being shown.
 */
export const MAX_BUFFERED_STATES = MAX_BACKLOG_STEPS + 3;

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
}

export class MotionBuffer {
  private queue: MotionSample[] = [];
  private plans: SegmentPlan[] = [];
  private anchorWallMs = 0;
  private anchorSimS = 0;
  private rateSimPerWallMs = 0;
  private lastArrivalWallMs: number | null = null;
  /** Measured wall-clock seconds of computing and transport per simulated second (smoothed). */
  private costPerSimS: number | null = null;
  private lastIntervalS = 0;

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
  }

  push(sample: MotionSample, opts: PushOptions): void {
    const last = this.queue[this.queue.length - 1];
    if (opts.flush || !last || !(sample.t > last.t)) {
      this.queue = [sample];
      this.plans = [];
      this.anchorWallMs = opts.wallMs;
      this.anchorSimS = sample.t;
      this.rateSimPerWallMs = 0;
      this.lastArrivalWallMs = opts.wallMs;
      return;
    }
    const now = this.displayTime(opts.wallMs);
    const stepS = sample.t - last.t;
    // Measure how long a simulated second costs, from the time between arrivals while the backend is playing.
    if (opts.playing && this.lastArrivalWallMs !== null) {
      this.lastIntervalS = (opts.wallMs - this.lastArrivalWallMs) / 1000;
      const measured = this.lastIntervalS / stepS;
      this.costPerSimS = this.costPerSimS === null ? measured : 0.5 * this.costPerSimS + 0.5 * measured;
    }
    this.lastArrivalWallMs = opts.wallMs;
    let intervalS = this.costPerSimS === null ? DEFAULT_INTERVAL_S : this.costPerSimS * (opts.nextStepS ?? stepS);
    intervalS = Math.min(MAX_INTERVAL_S, Math.max(MIN_INTERVAL_S, intervalS * INTERVAL_PADDING));
    if (!opts.playing) intervalS = Math.min(intervalS, SINGLE_STEP_MAX_S);
    if (opts.intervalS !== undefined && opts.playing) intervalS = Math.min(MAX_INTERVAL_S, Math.max(MIN_INTERVAL_S, opts.intervalS));
    this.queue.push(sample);
    this.plans.push(planSegment(last, sample));
    while (this.queue.length > MAX_BUFFERED_STATES) {
      this.queue.shift();
      this.plans.shift();
    }
    // Never trail the newest state by more than a few steps (a long frame stall or a hidden tab): catch up instead of replaying.
    const floor = sample.t - MAX_BACKLOG_STEPS * stepS;
    const from = Math.max(now, floor);
    this.anchorSimS = from;
    this.anchorWallMs = opts.wallMs;
    this.rateSimPerWallMs = (sample.t - from) / (intervalS * 1000);
  }

  /** The displayed simulation time at wall-clock `wallMs`: advances at the planned rate and never passes the newest state. */
  displayTime(wallMs: number): number {
    const latest = this.latestTimeS;
    if (latest === null) return 0;
    const t = this.anchorSimS + this.rateSimPerWallMs * Math.max(0, wallMs - this.anchorWallMs);
    return Math.min(latest, t);
  }

  /** Displayed positions (SI, physics frame) of every body at wall-clock `wallMs`, or null when the buffer is empty. */
  sample(wallMs: number): { timeS: number; positions: Map<string, V3> } | null {
    if (this.queue.length === 0) return null;
    const timeS = this.displayTime(wallMs);
    // Drop the segments the displayed time has completely passed (keep the one it is inside).
    while (this.plans.length > 1 && timeS >= this.plans[0]!.b.t) {
      this.plans.shift();
      this.queue.shift();
    }
    const plan = this.plans[0];
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
