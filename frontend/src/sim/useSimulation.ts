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
// Smooth motion: every state the backend reports is also fed to `motion` (sim/motion), a buffer of authoritative states with
// a display clock. A step response is continuous with the previous state; anything else (load, edit, create, delete, reset) is a
// flush, so a stale past is never replayed. `sim` itself stays the latest authoritative state: the clock, the inspector and the
// diagnostics read it, never the interpolated positions.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/errors";
import type { SimulationClient } from "../api/client";
import { LIMITS } from "../api/types";
import type { BodyCreateDto, BodyUpdateDto, SimulationEventDto, StepResponseDto } from "../api/types";
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

/** Wall-clock seconds the backend allows one step (backend/simulation.py DEFAULT_STEP_TIME_LIMIT_S; PG_STEP_TIME_LIMIT_S can change it there). */
export const STEP_BUDGET_S = 10;

/** The backend refused a step because it would not finish inside its wall-clock budget (HTTP 503; nothing was advanced). */
export function isStepBudgetExceeded(e: unknown): e is ApiError {
  return e instanceof ApiError && e.kind === "http" && e.status === 503 && /wall-clock budget/i.test(e.message);
}

function formatStep(seconds: number): string {
  return seconds >= 86400 ? `${(seconds / 86400).toPrecision(3)} d` : `${seconds.toPrecision(3)} s`;
}

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
  const tickMs = options.tickMs ?? 25;
  const healthPollMs = options.healthPollMs ?? 10_000;

  const [sim, setSim] = useState<SimulationView | null>(null);
  const [events, setEvents] = useState<EventView[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>("unknown");
  const [playing, setPlaying] = useState(false);
  const [stepping, setStepping] = useState(false);
  /** Largest step (s) the backend has recently completed within its wall-clock budget; null = no limit learned yet. */
  const stepCapRef = useRef<number | null>(null);
  const [speedExp, setSpeedExpState] = useState(options.initialSpeedExp ?? 5);
  const setSpeedExp = useCallback((exp: number) => {
    stepCapRef.current = null; // a new choice of step size starts afresh
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
  const playingRef = useRef(false);
  playingRef.current = playing;

  /** Applies an authoritative state. Without `step` it is a discontinuity (flush); with it, the continuation of the previous state. */
  const applySim = useCallback((view: SimulationView, step?: { events: readonly SimulationEventDto[]; nextStepS: number }) => {
    for (const b of view.bodies) names.current.set(b.id, b.name);
    if (!mounted.current) return;
    motion.push(toMotionSample(view, step?.events), {
      wallMs: performance.now(),
      flush: step === undefined,
      playing: playingRef.current,
      ...(step ? { nextStepS: step.nextStepS } : {}),
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

  /** One bounded backend step; "skipped" when another step is still in flight (never overlaps). */
  const doStep = useCallback(async (): Promise<"ok" | "skipped" | "failed"> => {
    if (stepPending.current) return "skipped";
    stepPending.current = true;
    if (mounted.current) setStepping(true);
    try {
      // The backend gives a step about STEP_BUDGET_S of wall time and rolls it back whole when it runs over (about 1.5 s per 1e6
      // simulated s with the moons preset, so the top of the slider cannot be met). Once the cost of a simulated second is known,
      // a step is limited to half the budget; a step that still runs over is not retried (a stuck backend must not be hammered:
      // D-021), Play stops as before, and the next step starts from a quarter of the size that failed.
      const asked = stepSecondsForExp(speedRef.current);
      // The cost is extrapolated only from steps that took long enough (>= 1 s) for the fixed cost of a request to be negligible.
      const cost = motion.lastMeasuredIntervalS >= 1 ? motion.costPerSimulatedSecond : null;
      const affordable = cost !== null && cost > 0 ? (STEP_BUDGET_S * 0.5) / cost : Infinity;
      const dt = Math.max(LIMITS.minStepS, Math.min(asked, stepCapRef.current ?? Infinity, affordable));
      const limited = affordable < Math.min(asked, stepCapRef.current ?? Infinity) * 0.999 ? `Step limited to ${formatStep(dt)} (you chose ${formatStep(asked)}): the backend needs about ${formatStep(Math.max(dt, 1) * (cost ?? 0))} of wall time for it and must answer within ${STEP_BUDGET_S} s.` : null;
      let res: StepResponseDto;
      try {
        res = await enqueue(() => client.step(dt));
      } catch (e) {
        if (isStepBudgetExceeded(e) && dt > LIMITS.minStepS) {
          stepCapRef.current = dt / 4;
          throw new ApiError("http", `${e.message}. The next step will be ${formatStep(dt / 4)}.`, e.status, e.code);
        }
        throw e;
      }
      applySim(toSimulationView(res), { events: res.events, nextStepS: dt });
      if (mounted.current && res.events.length) {
        setEvents((prev) => mergeEvents(prev, res.events.map(toEventView)));
      }
      noteSuccess();
      if (limited && mounted.current) setActionError(limited);
      return "ok";
    } catch (e) {
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
      return "failed";
    } finally {
      stepPending.current = false;
      if (mounted.current) setStepping(false);
    }
  }, [client, enqueue, applySim, noteFailure, noteSuccess, refreshState]);

  // Play loop: strictly sequential steps separated by tickMs. Cleanup on pause/unmount.
  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (cancelled) return;
      const result = await doStep();
      if (cancelled) return;
      if (result === "failed") {
        setPlaying(false);
        return;
      }
      timer = setTimeout(tick, tickMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [playing, doStep, tickMs]);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const stepOnce = useCallback(() => {
    setPlaying(false);
    return doStep();
  }, [doStep]);

  const reset = useCallback(async (): Promise<ActionResult> => {
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
