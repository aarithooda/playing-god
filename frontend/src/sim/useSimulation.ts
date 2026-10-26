// Synchronises React with the backend. The backend owns all physical state; this hook only holds the
// latest authoritative snapshot plus transient UI state (playing, speed, errors). There is no local
// integrator: every position shown comes from a state/step response.
//
// Concurrency: every request that touches the simulation goes through one FIFO queue, so at most one
// is in flight and responses are applied in request order. The API client bounds every request with a
// timeout, so a request the backend never answers fails instead of blocking the queue (and with it every
// later load, retry and action) forever. Connection health (/healthz) and simulation loading are separate
// states: the backend can be reachable while the simulation is busy or unresponsive. Play schedules the next step only after
// the previous one resolved (never an unbounded queue); Pause stops scheduling and lets any
// in-flight step finish and apply.
//
// Smooth motion has two separate halves, each with one job:
//  - PRODUCING states (below, the Play loop): the backend, the only authority, computes up to LOOKAHEAD_STEPS finished steps ahead
//    and they are released to the screen at a steady tickMs cadence, so network jitter does not decide when a state is shown;
//  - DRAWING them (`motion`, sim/motion): every released state is also fed to a MotionBuffer that interpolates BETWEEN the
//    released states at each animation frame. The renderer never advances physics and never extrapolates past a released state.
// `sim` is always the latest RELEASED authoritative state (the clock, inspector and diagnostics read it, never the interpolated
// positions). A step that is not the plain continuation of the previous one (load, edit, create, delete, reset, pause-flush) is a
// discontinuity: it flushes the buffer, and a lookahead step computed BEFORE such an edit is discarded rather than shown after it.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/errors";
import type { SimulationClient } from "../api/client";
import { LIMITS } from "../api/types";
import type { BodyCreateDto, BodyUpdateDto, SimulationEventDto } from "../api/types";
import { toMotionSample } from "./motion/feed";
import { MotionBuffer } from "./motion/MotionBuffer";
import {
  mergeEvents,
  toEventView,
  toSimulationView,
  type EventView,
  type SimulationView,
} from "./viewModel";

export type LoadStatus = "loading" | "ready" | "error";
export type Health = "unknown" | "ok" | "down";
export type ActionResult = { ok: true } | { ok: false; error: string };
/** Like ActionResult, but a successful create also reports the id the backend assigned. */
export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

export interface SimulationOptions {
  /** Pause between the end of one Play step and the start of the next. */
  tickMs?: number;
  healthPollMs?: number;
  /** log10 of simulated seconds advanced per step request. */
  initialSpeedExp?: number;
  /** The backend refused because this universe is gone, inactive or the activation epoch is stale: resync the scope. */
  onScopeInvalid?: (error: ApiError) => void;
  /** True while a non-step write (edit, create, delete, reset) is in flight: the universe must not be switched. */
  onBusyWriteChange?: (pending: boolean) => void;
  /** The simulation-speed slider moved (so the owner can keep it across a universe switch). */
  onSpeedExpChange?: (exp: number) => void;
}

const SCOPE_INVALID_CODES = ["stale_activation", "universe_not_active", "deactivated_during_step"];

/** A refusal that means "your idea of the active universe is out of date" rather than "this action failed". */
export function isScopeInvalid(e: unknown): e is ApiError {
  return (
    e instanceof ApiError &&
    e.kind === "http" &&
    ((e.status === 404 && e.code === "universe_not_found") || (e.status === 409 && SCOPE_INVALID_CODES.includes(e.code ?? "")))
  );
}

/** How many finished steps the Play loop keeps ahead of the screen. */
export const LOOKAHEAD_STEPS = 3;

export const COLLISION_FALLBACK_NOTICE = "Could not simulate the collision in detail, so the bodies were merged instead.";

export const MIN_SPEED_EXP = 2;
export const MAX_SPEED_EXP = 7;

export function stepSecondsForExp(exp: number): number {
  const dt = 10 ** exp;
  return Math.min(LIMITS.maxStepS, Math.max(LIMITS.minStepS, dt));
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useSimulation(client: SimulationClient, options: SimulationOptions = {}) {
  const tickMs = options.tickMs ?? 150;
  const healthPollMs = options.healthPollMs ?? 10_000;

  const [sim, setSim] = useState<SimulationView | null>(null);
  const [events, setEvents] = useState<EventView[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** A calm, non-error message (for example: collisions could not be simulated, so contacts were merged). */
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>("unknown");
  const [playing, setPlaying] = useState(false);
  const [stepping, setStepping] = useState(false);
  const [speedExp, setSpeedExpState] = useState(options.initialSpeedExp ?? 5);
  const setSpeedExp = useCallback((exp: number) => {
    setSpeedExpState(exp);
    onSpeedRef.current?.(exp);
  }, []);
  /** Bumped when the set of bodies changes through a user action (load/create/delete/reset). */
  const [layoutEpoch, setLayoutEpoch] = useState(0);

  const [writePending, setWritePending] = useState(false);
  const pendingWrites = useRef(0);
  const onScopeInvalidRef = useRef(options.onScopeInvalid);
  onScopeInvalidRef.current = options.onScopeInvalid;
  const onBusyRef = useRef(options.onBusyWriteChange);
  onBusyRef.current = options.onBusyWriteChange;
  const onSpeedRef = useRef(options.onSpeedExpChange);
  onSpeedRef.current = options.onSpeedExpChange;

  const mounted = useRef(false);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const stepPending = useRef(false);
  /** Set by Reset: the Play loop's unshown lookahead belongs to the old state and must not be flushed over it. */
  const discardLookahead = useRef(false);
  const speedRef = useRef(speedExp);
  speedRef.current = speedExp;
  /** Every body name ever seen, so events can name bodies that no longer exist. */
  const names = useRef(new Map<string, string>());

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = tail.current.then(task, task);
    tail.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const motion = useState(() => new MotionBuffer())[0];
  const tickMsRef = useRef(tickMs);
  tickMsRef.current = tickMs;
  const playingRef = useRef(false);
  playingRef.current = playing;
  /** Bumped by every mutation (and reset): a lookahead step fetched under an older value predates it and is never shown after it. */
  const generation = useRef(0);

  /** Applies an authoritative state. Without `step` it is a discontinuity (the buffer is flushed); with it, the continuation of the previous state. */
  const applySim = useCallback((view: SimulationView, step?: { events: readonly SimulationEventDto[]; nextStepS: number; intervalS?: number }) => {
    for (const b of view.bodies) names.current.set(b.id, b.name);
    if (!mounted.current) return;
    motion.push(toMotionSample(view, step?.events), {
      wallMs: performance.now(),
      flush: step === undefined,
      playing: playingRef.current,
      ...(step ? { nextStepS: step.nextStepS, ...(step.intervalS === undefined ? {} : { intervalS: step.intervalS }) } : {}),
    });
    setSim(view);
  }, [motion]);

  const noteFailure = useCallback((e: unknown): string => {
    const msg = messageOf(e);
    if (mounted.current) {
      setActionError(msg);
      if (e instanceof ApiError && e.kind === "network") setHealth("down");
      if (isScopeInvalid(e)) onScopeInvalidRef.current?.(e);
    }
    return msg;
  }, []);

  const noteSuccess = useCallback(() => {
    if (mounted.current) {
      setHealth("ok");
      setActionError(null);
    }
  }, []);

  /** Runs a queued mutation and converts failures to an ActionResult. */
  const act = useCallback(
    async (task: () => Promise<void>): Promise<ActionResult> => {
      generation.current += 1; // lookahead steps already fetched predate this mutation
      pendingWrites.current += 1;
      if (mounted.current) setWritePending(true);
      onBusyRef.current?.(true);
      try {
        await enqueue(task);
        noteSuccess();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: noteFailure(e) };
      } finally {
        pendingWrites.current -= 1;
        if (pendingWrites.current === 0) {
          if (mounted.current) setWritePending(false);
          onBusyRef.current?.(false);
        }
      }
    },
    [enqueue, noteFailure, noteSuccess],
  );

  const refreshState = useCallback(async () => {
    applySim(toSimulationView(await client.getState()));
  }, [client, applySim]);

  const load = useCallback(async () => {
    if (mounted.current) {
      setLoadStatus("loading");
      setLoadError(null);
    }
    try {
      await enqueue(async () => {
        const state = await client.getState();
        const evs = await client.getEvents();
        applySim(toSimulationView(state));
        if (mounted.current) setEvents(mergeEvents([], evs.map(toEventView)));
      });
      if (mounted.current) {
        setLoadStatus("ready");
        setHealth("ok");
        setLayoutEpoch((n) => n + 1);
      }
    } catch (e) {
      if (mounted.current) {
        setLoadStatus("error");
        setLoadError(messageOf(e));
        if (e instanceof ApiError && e.kind === "network") setHealth("down");
        if (isScopeInvalid(e)) onScopeInvalidRef.current?.(e);
      }
    }
  }, [client, enqueue, applySim]);

  // Initial load + lifecycle flag. The flag is re-armed on every effect run so StrictMode's
  // mount/unmount/mount cycle leaves it true.
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  // Health polling (/healthz), infrequent by design.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const ok = await client.health();
        if (!cancelled) setHealth(ok ? "ok" : "down");
      } catch {
        if (!cancelled) setHealth("down");
      }
    };
    void check();
    const id = setInterval(check, healthPollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client, healthPollMs]);

  type FetchedStep = {
    view: SimulationView;
    events: EventView[];
    /** The events as the API sent them (the motion buffer needs the body ids). */
    rawEvents: SimulationEventDto[];
    stepS: number;
    /** `generation` when the request was made. */
    gen: number;
    merged?: boolean;
  };

  /** Failure path shared by single steps and the Play loop. */
  const handleStepFailure = useCallback(async (e: unknown) => {
    noteFailure(e);
    if (e instanceof ApiError && (e.kind === "timeout" || e.kind === "network" || e.kind === "invalid-response")) {
      // The outcome of the step is unknown (it may or may not have run). Never guess: re-read the committed
      // state. The failed response itself is never applied, so the displayed time cannot jump ahead on a failure.
      if (mounted.current) {
        setActionError(`${e.message}. The step may not have completed; showing the last state the backend reported.`);
      }
      try {
        await enqueue(() => refreshState());
      } catch {
        /* the last known state stays on screen and the error above stays visible */
      }
    }
  }, [enqueue, noteFailure, refreshState]);

  const fetchStep = useCallback(async (): Promise<FetchedStep> => {
    const gen = generation.current;
    const stepS = stepSecondsForExp(speedRef.current);
    const res = await enqueue(() => client.step(stepS));
    return { view: toSimulationView(res), events: res.events.map(toEventView), rawEvents: res.events, stepS, gen, merged: res.warnings?.includes('collisions_merged_fallback') === true };
  }, [client, enqueue]);

  /**
   * Releases steps to the screen. `jump` shows only the last one, as a discontinuity (pause, error). A step whose `gen` is older than
   * the current generation was computed before a mutation: its events still happened and are recorded, but its state is not
   * shown (the mutation already put the backend's latest state on screen, and showing this one would resurrect a deleted body
   * or undo an edit).
   */
  const showSteps = useCallback((steps: FetchedStep[], jump: boolean) => {
    const fresh = steps.filter((s) => s.gen === generation.current);
    const last = fresh[fresh.length - 1];
    if (last) {
      if (jump) applySim(last.view);
      else applySim(last.view, { events: last.rawEvents, nextStepS: stepSecondsForExp(speedRef.current), intervalS: tickMsRef.current / 1000 });
    }
    const events = steps.flatMap((s) => s.events);
    if (mounted.current && steps.some((s) => s.merged)) setNotice(COLLISION_FALLBACK_NOTICE);
    if (mounted.current && events.length) setEvents((prev) => mergeEvents(prev, events));
    noteSuccess();
  }, [applySim, noteSuccess]);
  const showStep = useCallback((step: FetchedStep) => showSteps([step], false), [showSteps]);

  /** One bounded backend step; "skipped" when another step is still in flight (never overlaps). */
  const doStep = useCallback(async (): Promise<"ok" | "skipped" | "failed"> => {
    if (stepPending.current) return "skipped";
    stepPending.current = true;
    if (mounted.current) setStepping(true);
    try {
      showStep(await fetchStep());
      return "ok";
    } catch (e) {
      await handleStepFailure(e);
      return "failed";
    } finally {
      stepPending.current = false;
      if (mounted.current) setStepping(false);
    }
  }, [fetchStep, showStep, handleStepFailure]);

  // Play loop with lookahead: the backend (still the only authority) computes up to LOOKAHEAD_STEPS ahead of what is
  // shown, and the screen consumes those finished snapshots at a steady tickMs cadence, so network jitter no longer
  // makes motion stutter. On pause or error the buffer is flushed: the screen jumps to the latest backend state.
  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    let failed = false;
    let fetching = false;
    let started = false;
    const buffer: FetchedStep[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
      if (buffer.length === 0) return;
      if (discardLookahead.current) {
        buffer.length = 0;
        return;
      }
      const pending = buffer.slice();
      buffer.length = 0;
      showSteps(pending, true);
    };
    const consume = () => {
      if (cancelled) return;
      const next = buffer.shift();
      if (next) showStep(next);
      timer = setTimeout(consume, tickMs);
      void fill();
    };
    const fill = async () => {
      if (cancelled || failed || fetching || buffer.length >= LOOKAHEAD_STEPS || stepPending.current) return;
      fetching = true;
      stepPending.current = true;
      if (mounted.current) setStepping(true);
      try {
        const step = await fetchStep();
        buffer.push(step);
        if (cancelled) flush(); // paused while this step was in flight: its result is still the backend's truth
      } catch (e) {
        failed = true;
        flush();
        await handleStepFailure(e);
        setPlaying(false);
      } finally {
        fetching = false;
        stepPending.current = false;
        if (mounted.current) setStepping(false);
      }
      if (cancelled || failed) return;
      if (!started) {
        started = true;
        consume();
      } else {
        void fill();
      }
    };
    discardLookahead.current = false;
    void fill();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      flush();
    };
  }, [playing, fetchStep, showStep, showSteps, handleStepFailure, tickMs]);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const stepOnce = useCallback(() => {
    setPlaying(false);
    return doStep();
  }, [doStep]);

  const reset = useCallback(async (): Promise<ActionResult> => {
    discardLookahead.current = true;
    generation.current += 1;
    setPlaying(false);
    return act(async () => {
      applySim(toSimulationView(await client.reset()));
      const evs = await client.getEvents();
      if (mounted.current) {
        setEvents(mergeEvents([], evs.map(toEventView)));
        setLayoutEpoch((n) => n + 1);
      }
    });
  }, [act, client, applySim]);

  const createBody = useCallback(
    async (body: BodyCreateDto): Promise<CreateResult> => {
      let id = "";
      const result = await act(async () => {
        id = (await client.createBody(body)).id;
        await refreshState();
        if (mounted.current) setLayoutEpoch((n) => n + 1);
      });
      return result.ok ? { ok: true, id } : result;
    },
    [act, client, refreshState],
  );

  const updateBody = useCallback(
    (id: string, patch: BodyUpdateDto): Promise<ActionResult> =>
      act(async () => {
        await client.updateBody(id, patch);
        await refreshState();
      }),
    [act, client, refreshState],
  );

  const deleteBody = useCallback(
    (id: string): Promise<ActionResult> =>
      act(async () => {
        await client.deleteBody(id);
        await refreshState();
        if (mounted.current) setLayoutEpoch((n) => n + 1);
      }),
    [act, client, refreshState],
  );

  const bodyName = useCallback((id: string) => names.current.get(id) ?? id, []);
  const dismissError = useCallback(() => setActionError(null), []);

  return {
    sim,
    motion,
    events,
    loadStatus,
    loadError,
    actionError,
    notice,
    dismissNotice: () => setNotice(null),
    health,
    playing,
    stepping,
    speedExp,
    stepSeconds: stepSecondsForExp(speedExp),
    layoutEpoch,
    writePending,
    revision: sim?.revision ?? null,
    setSpeedExp,
    play,
    pause,
    stepOnce,
    reset,
    createBody,
    updateBody,
    deleteBody,
    reload: load,
    bodyName,
    dismissError,
  };
}

export type SimulationApi = ReturnType<typeof useSimulation>;
