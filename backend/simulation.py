"""Authoritative in-memory simulation service backed by REBOUND (IAS15), SI units throughout.

Model (decisions D-007, D-008, D-010; evidence in context/PHYSICS_SPIKE.md):
- One persistent `rebound.Simulation` owns the physical state. Each public body id is the REBOUND particle `name`;
  array indices are never used as identity because merges shift them. Display metadata (name, colour) lives beside it.
- G = 6.67430e-11 is set explicitly (REBOUND's own SI constant differs by 3.3e-5 relative). Integrator IAS15,
  `collision = "line"`, fixed `rand_seed` (simultaneous collisions resolve in a reproducible order), merger layer in
  backend/collisions.py. No second integrator exists.
- The server never advances time by itself: `step(dtS)` is the only operation that moves time, so `status` is
  always "paused". Play is a client loop of bounded step requests.
- Every step is integrated in chunks small enough that the path curvature inside one chunk (a_rel*dt^2/8) is
  <= 1% of the pair's contact distance, which is the condition under which `line` detection is reliable.
- A step is transactional: state is captured first and restored if the engine raises, a collision callback fails or a
  non-finite value appears, so a failed step never leaves corrupted state.
- A step also has a wall-clock budget (`step_time_limit_s`), checked between chunks and, through REBOUND's
  heartbeat, after every internal step, so even a stalled `integrate` is stopped. Exceeding it raises
  StepTimeoutError and takes the same rollback path, so a timed-out step advances nothing. The engine is rebuilt from
  the saved state, so the replay uses a different internal step grid (same physics, not bitwise identical).
- Structural edits (add/remove/patch) re-select IAS15 so no stale predictor state survives.
- State is in-memory, single process, lost on restart; every mutation (and every step) is serialized by one lock.
- One instance is one universe's engine (backend/universes.py owns many). A mutation takes an optional `guard`
  callable, invoked right after the lock is taken and again immediately before the change is published; it raises to
  refuse (universe inactive, stale activation epoch, stale revision). A refusal at the second point rolls the
  mutation back, so a late request can never change the wrong universe. `request_cancel()` additionally stops a
  running `integrate` through the heartbeat when the universe is deactivated.
- Reads never wait for that lock: `snapshot()` returns the last *committed* state, published at the end of every
  successful mutation or step, so a long or stuck step can neither block nor tear a read. Mutations wait for the
  lock only a bounded time (`lock_wait_s`) and then fail with SimulationBusyError (HTTP 503) instead of hanging.
Known limits: see context/API_CONTRACT.md ("Physics limitations").
"""
import contextlib
import logging
import math
import os
import threading
import time
import uuid
import warnings
from typing import Callable, NamedTuple

import rebound

from backend.collisions import MergeResolver, select_ias15
from backend.diagnostics import compute_diagnostics
from backend.errors import CodedError, StepCancelled
from backend.models import (MAX_BODIES, Body, BodyCreate, BodyUpdate, Event, Position3, SimulationState,
                            StepResponse, Vec3)

logger = logging.getLogger(__name__)

G_SI = 6.67430e-11  # m^3 kg^-1 s^-2
RAND_SEED = 12345
CURVATURE_FRACTION = 0.01  # max chord deviation per chunk as a fraction of the contact distance
MAX_CHUNKS_PER_STEP = 2000  # bounds wall time; if reached, chunks are longer than the 1% criterion asks
MAX_EVENTS_KEPT = 1000
# Wall-clock budget for one step request (seconds), checked between chunks; override with PG_STEP_TIME_LIMIT_S.
DEFAULT_STEP_TIME_LIMIT_S = 10.0
# A mutation waits this much longer than the step budget for the lock before answering 503 "busy".
LOCK_WAIT_MARGIN_S = 5.0


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


class SimulationBusyError(Exception):
    """Another request holds the simulation (normally a step in progress); nothing was changed."""


class SimulationFailure(Exception):
    """The engine failed during a step; state was restored to what it was before the step."""


class StepTimeoutError(SimulationFailure):
    """The step exceeded its wall-clock budget; state was restored to what it was before the step."""


class BodyMeta(NamedTuple):
    name: str
    color: str
    kind: str = "planet"
    catalogue_id: str | None = None


# A commit guard raises (a CodedError) to refuse a mutation; see the module docstring.
CommitGuard = Callable[[], None]


class SimulationService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.revision = 0  # +1 per committed change (step, add, patch, delete, reset)
        self._cancel = threading.Event()  # set when this universe is deactivated: stops a running integrate
        self.last_failure: dict | None = None  # the most recent failed mutation; cleared by the next success
        self.history_mode = "step"
        self._event_seq = 0  # never reset, so event ids are never reused
        self.step_time_limit_s = float(os.getenv("PG_STEP_TIME_LIMIT_S", DEFAULT_STEP_TIME_LIMIT_S))
        # How long a mutation waits for a running step before answering 503; None = step budget + LOCK_WAIT_MARGIN_S.
        self.lock_wait_s: float | None = None
        self._clock = time.monotonic  # injectable for tests
        self._init_state()

    # ---------- construction / reset ----------
    def _init_state(self, publish: bool = True) -> None:
        self._meta: dict[str, BodyMeta] = {}  # id -> display metadata, creation order
        self._events: list[Event] = []
        self._pending: list[Event] = []  # events recorded since the last step started
        self._deadline = math.inf  # monotonic time at which the running step must stop
        self._timed_out = False
        self._resolver = MergeResolver(self._record_merge)
        self._sim = self._new_sim([], 0.0)
        if publish:
            self._pub = (self._snapshot(), self.revision)  # last committed state, served to readers without the lock

    @contextlib.contextmanager
    def _guard(self):
        """Holds the simulation lock for a mutation, but never indefinitely."""
        wait = self.lock_wait_s if self.lock_wait_s is not None else self.step_time_limit_s + LOCK_WAIT_MARGIN_S
        if not self._lock.acquire(timeout=max(wait, 0.0)):
            logger.warning("simulation busy: a request waited %.1f s for the lock and gave up", wait)
            self._fail("busy", "the simulation is busy (a step is still running); nothing was changed")
            raise SimulationBusyError(
                "the simulation is busy (a step is still running); nothing was changed, try again shortly")
        try:
            yield
        finally:
            self._lock.release()

    locked = _guard  # for callers that must read `revision` together with the result of one mutation

    def is_busy(self) -> bool:
        """True while another thread holds the lock (a mutation or step is running). Never blocks."""
        if self._lock.acquire(blocking=False):
            self._lock.release()
            return False
        return True

    def request_cancel(self) -> None:
        """Deactivation: stop a running integrate at its next internal step (the commit guard also blocks it)."""
        self._cancel.set()

    def clear_cancel(self) -> None:
        self._cancel.clear()

    def _fail(self, kind: str, message: str) -> None:
        self.last_failure = {"kind": kind, "message": message, "atSimulationTimeS": self._sim.t,
                             "atIso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    def _publish(self) -> None:
        """Call under the lock after a committed change: bumps the revision and publishes state + revision together."""
        self.revision += 1
        self.last_failure = None
        self._pub = (self._snapshot(), self.revision)

    @contextlib.contextmanager
    def _mutation(self, guard: "CommitGuard | None"):
        """One committed mutation: lock, guard, (caller mutates), guard again, publish. Anything that goes wrong after
        the engine was touched restores the pre-mutation state; refusals raised before any change (ConflictError,
        NotFoundError) change nothing and need no restore."""
        with self._guard():
            if guard is not None:
                guard()
            before = self._capture()
            try:
                yield
                if guard is not None:
                    guard()  # last chance to refuse: the universe may have been deactivated while we worked
            except (ConflictError, NotFoundError):
                raise
            except BaseException as exc:
                self._restore(before)
                if isinstance(exc, CodedError):
                    self._fail(exc.code, exc.detail)
                raise
            self._publish()

    def _new_sim(self, records: list[dict], t: float) -> rebound.Simulation:
        sim = rebound.Simulation()
        sim.units = ("m", "s", "kg")
        sim.G = G_SI  # after `units`, which would otherwise set REBOUND's 6.67408e-11
        sim.rand_seed = RAND_SEED
        select_ias15(sim)
        sim.t = t
        for r in records:
            sim.add(**r)
        sim.collision = "line"
        sim.collision_resolve = self._resolver.resolve
        sim.heartbeat = self._heartbeat  # watchdog: runs once per internal step, may stop a stalled integrate
        return sim

    def reset(self, guard: "CommitGuard | None" = None) -> SimulationState:
        """Remove all bodies and events, time to 0. Event ids keep counting (never reused)."""
        with self._mutation(guard):
            self._init_state(publish=False)
        return self.snapshot()

    # ---------- reads ----------
    def snapshot(self) -> SimulationState:
        """The last committed state. Never waits for a running step and never shows a half-advanced state."""
        return self._pub[0].model_copy(deep=True)

    def published(self) -> tuple[SimulationState, int]:
        """The last committed state together with its revision, read as one unit."""
        state, revision = self._pub
        return state.model_copy(deep=True), revision

    def events(self) -> list[Event]:
        return list(self._events)  # one atomic list copy; steps only append/trim after they succeed

    def _particle(self, body_id: str):
        """Look a body up by scanning, not through REBOUND's name hash table: after a removal (every merger) the
        table is stale and REBOUND emits "Name hash table needs repairs" on the next by-name access."""
        for p in self._sim.particles:
            if p.name == body_id:
                return p
        raise NotFoundError(f"unknown body id: {body_id}")

    def _particles_by_id(self) -> dict:
        return {p.name: p for p in self._sim.particles}

    def _body(self, body_id: str, p) -> Body:
        meta = self._meta[body_id]
        return Body(id=body_id, name=meta.name, massKg=p.m, radiusM=p.r,
                    positionM=Vec3(x=p.x, y=p.y, z=p.z), velocityMPerS=Vec3(x=p.vx, y=p.vy, z=p.vz),
                    colorHex=meta.color, kind=meta.kind, catalogueEntryId=meta.catalogue_id)

    def _snapshot(self) -> SimulationState:
        by_id = self._particles_by_id()
        # Bodies are returned in creation order regardless of REBOUND's internal array order.
        bodies = [self._body(i, by_id[i]) for i in self._meta]
        # Same particle read as `bodies`, under the caller's lock: the diagnostics describe exactly this state.
        diagnostics = compute_diagnostics(
            [(b.massKg, (b.positionM.x, b.positionM.y, b.positionM.z),
              (b.velocityMPerS.x, b.velocityMPerS.y, b.velocityMPerS.z)) for b in bodies],
            [self._resolver.spin[i] for i in self._meta if i in self._resolver.spin], G_SI)
        return SimulationState(status="paused", simulationTimeS=self._sim.t, bodies=bodies, diagnostics=diagnostics)

    # ---------- CRUD ----------
    def add_body(self, data: BodyCreate, guard: "CommitGuard | None" = None) -> Body:
        with self._mutation(guard):
            if len(self._meta) >= MAX_BODIES:
                raise ConflictError(f"body limit reached ({MAX_BODIES})")
            self._require_free(data.positionM, data.radiusM, ignore_id=None)
            body_id = f"body-{uuid.uuid4().hex[:12]}"
            while body_id in self._meta:
                body_id = f"body-{uuid.uuid4().hex[:12]}"
            self._sim.add(m=data.massKg, r=data.radiusM, x=data.positionM.x, y=data.positionM.y,
                          z=data.positionM.z, vx=data.velocityMPerS.x, vy=data.velocityMPerS.y,
                          vz=data.velocityMPerS.z, name=body_id)
            self._meta[body_id] = BodyMeta(data.name, data.colorHex, data.kind, data.catalogueEntryId)
            select_ias15(self._sim)  # reset integrator state after a structural change
        return self._body(body_id, self._particle(body_id))

    def update_body(self, body_id: str, patch: BodyUpdate, guard: "CommitGuard | None" = None) -> Body:
        with self._mutation(guard):
            self._require_known(body_id)
            p = self._particle(body_id)
            fields = patch.model_fields_set
            new_pos = patch.positionM if "positionM" in fields else Position3(x=p.x, y=p.y, z=p.z)
            new_radius = patch.radiusM if "radiusM" in fields else p.r
            if "positionM" in fields or "radiusM" in fields:
                self._require_free(new_pos, new_radius, ignore_id=body_id)  # validate before mutating anything
            if "massKg" in fields:
                p.m = patch.massKg
            if "radiusM" in fields:
                p.r = patch.radiusM
            if "positionM" in fields:
                p.x, p.y, p.z = patch.positionM.x, patch.positionM.y, patch.positionM.z
            if "velocityMPerS" in fields:
                p.vx, p.vy, p.vz = patch.velocityMPerS.x, patch.velocityMPerS.y, patch.velocityMPerS.z
            meta = self._meta[body_id]
            self._meta[body_id] = meta._replace(
                name=patch.name if "name" in fields else meta.name,
                color=patch.colorHex if "colorHex" in fields else meta.color,
                kind=patch.kind if "kind" in fields else meta.kind)
            if fields & {"massKg", "radiusM", "positionM", "velocityMPerS"}:
                select_ias15(self._sim)
        return self._body(body_id, self._particle(body_id))

    def delete_body(self, body_id: str, guard: "CommitGuard | None" = None) -> None:
        with self._mutation(guard):
            self._require_known(body_id)
            self._sim.remove(self._particle(body_id).index)
            del self._meta[body_id]
            self._resolver.spin.pop(body_id, None)
            select_ias15(self._sim)

    def _require_known(self, body_id: str) -> None:
        if body_id not in self._meta:
            raise NotFoundError(f"unknown body id: {body_id}")

    def _require_free(self, pos: Position3, radius: float, ignore_id: str | None) -> None:
        """Reject a body whose sphere would overlap another one (a zero-separation start corrupts the engine)."""
        for other_id, q in self._particles_by_id().items():
            if other_id == ignore_id:
                continue
            d = math.dist((pos.x, pos.y, pos.z), (q.x, q.y, q.z))
            if d < radius + q.r:
                raise ConflictError(f"body would overlap {other_id} (centre distance {d:.6g} m < {radius + q.r:.6g} m)")

    # ---------- stepping ----------
    def step(self, dt_s: float, guard: "CommitGuard | None" = None) -> StepResponse:
        with self._guard():
            if guard is not None:
                guard()
            before = self._capture()
            self._pending = []
            t0 = self._sim.t
            try:
                self._timed_out = False
                self._deadline = self._clock() + self.step_time_limit_s
                self._advance(t0 + dt_s)
                self._verify_finite()
                if guard is not None:
                    try:
                        guard()  # commit point: refuse (and roll back) if the universe was deactivated meanwhile
                    except CodedError as refused:
                        raise StepCancelled() from refused
            except Exception as exc:  # noqa: BLE001 - restore, then report as one failure type
                self._restore(before)
                if isinstance(exc, StepTimeoutError):
                    logger.warning("%s", exc)
                    self._fail("step_timeout", str(exc))
                    raise
                if isinstance(exc, StepCancelled):
                    self._fail(exc.code, exc.detail)
                    raise
                logger.exception("simulation step failed; state restored")
                self._fail("step_failed", str(exc))
                raise SimulationFailure(f"simulation step failed and was rolled back: {exc}") from exc
            events = self._pending
            self._pending = []
            self._events.extend(events)
            del self._events[:-MAX_EVENTS_KEPT]
            self._publish()
            state = self._snapshot()
            return StepResponse(**state.model_dump(), advancedS=self._sim.t - t0, events=events)

    def _heartbeat(self, sim_ptr) -> None:
        """REBOUND calls this after every internal step. Past the deadline it stops `integrate`, which is the only
        way to interrupt an engine stall (a step-size collapse never returns on its own)."""
        if self._cancel.is_set():
            sim_ptr.contents.stop()
        elif self._clock() > self._deadline:
            self._timed_out = True
            sim_ptr.contents.stop()

    def _check_deadline(self) -> None:
        if self._cancel.is_set():
            raise StepCancelled()
        if self._timed_out or self._clock() > self._deadline:
            raise StepTimeoutError(
                f"step exceeded its {self.step_time_limit_s:g} s wall-clock budget; "
                "state was not advanced (retry with a smaller dtS)")

    def _advance(self, target: float) -> None:
        sim = self._sim
        if sim.N == 0:
            sim.t = target  # nothing to integrate; time still advances
            return
        floor = (target - sim.t) / MAX_CHUNKS_PER_STEP
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            while sim.t < target:
                self._check_deadline()
                if sim.N == 1:
                    self._drift_lone_body(target)  # no force acts: exact, and IAS15 would warn spuriously
                    break
                remaining = target - sim.t
                chunk = max(self._chunk_limit(), floor)
                nxt = target if chunk >= remaining * (1 - 1e-9) else sim.t + chunk
                sim.integrate(nxt)
                self._check_deadline()  # an integrate stopped by the watchdog returns early
                if self._resolver.errors:
                    raise RuntimeError("collision resolver failed:\n" + self._resolver.errors[-1])
        for w in caught:
            logger.warning("REBOUND warning during step: %s", w.message)

    def _drift_lone_body(self, target: float) -> None:
        """A single body feels no force, so uniform motion is exact. REBOUND's IAS15 convergence test divides by
        the acceleration norm, which is zero here, and then always reports non-convergence (context/WORKLOG.md)."""
        sim = self._sim
        dt = target - sim.t
        p = sim.particles[0]
        p.x, p.y, p.z = p.x + p.vx * dt, p.y + p.vy * dt, p.z + p.vz * dt
        sim.t = target

    def _chunk_limit(self) -> float:
        """Longest chunk keeping a_rel*dt^2/8 <= CURVATURE_FRACTION * contact distance for every pair."""
        ps = [(p.m, p.r, (p.x, p.y, p.z)) for p in self._sim.particles]
        n = len(ps)
        if n < 2:
            return math.inf
        acc = [[0.0, 0.0, 0.0] for _ in range(n)]
        for i in range(n):
            for j in range(i + 1, n):
                d = [ps[j][2][k] - ps[i][2][k] for k in range(3)]
                r2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
                if r2 == 0.0:
                    return 0.0  # coincident centres: caught by the finiteness check / floor
                f = G_SI / (r2 * math.sqrt(r2))
                for k in range(3):
                    acc[i][k] += f * ps[j][0] * d[k]
                    acc[j][k] -= f * ps[i][0] * d[k]
        limit = math.inf
        for i in range(n):
            for j in range(i + 1, n):
                a_rel = math.dist(acc[i], acc[j])
                if a_rel > 0.0:
                    limit = min(limit, math.sqrt(8.0 * CURVATURE_FRACTION * (ps[i][1] + ps[j][1]) / a_rel))
        return limit

    def _verify_finite(self) -> None:
        for p in self._sim.particles:
            if not all(math.isfinite(v) for v in (p.x, p.y, p.z, p.vx, p.vy, p.vz, p.m, p.r)):
                raise ArithmeticError(f"non-finite state for {p.name}")
        if not math.isfinite(self._sim.t):
            raise ArithmeticError("non-finite simulation time")

    def _record_merge(self, ev: dict) -> None:
        """Called from inside the collision callback while the step lock is held."""
        self._event_seq += 1
        event = Event(id=f"evt-{self._event_seq}", type="merger", spinAddedKgM2PerS=Vec3(
            x=ev["spinAddedKgM2PerS"][0], y=ev["spinAddedKgM2PerS"][1], z=ev["spinAddedKgM2PerS"][2]),
            **{k: v for k, v in ev.items() if k != "spinAddedKgM2PerS"})
        self._pending.append(event)
        self._meta.pop(event.bodyIds[1], None)  # absorbed body no longer exists

    # ---------- transactional capture / restore ----------
    def _capture(self) -> dict:
        s = self._sim
        return {
            "t": s.t,
            "event_seq": self._event_seq,  # ids of events from a rolled-back step were never seen: reuse them
            "records": [dict(m=p.m, r=p.r, x=p.x, y=p.y, z=p.z, vx=p.vx, vy=p.vy, vz=p.vz, name=p.name)
                        for p in s.particles],
            "meta": dict(self._meta),
            "events": list(self._events),
            "heat": self._resolver.heat_J,
            "spin": {k: list(v) for k, v in self._resolver.spin.items()},
        }

    def _restore(self, cap: dict) -> None:
        self._meta = cap["meta"]
        self._events = cap["events"]
        self._event_seq = cap["event_seq"]
        self._resolver.errors.clear()
        self._resolver.heat_J = cap["heat"]
        self._resolver.spin = cap["spin"]
        self._pending = []
        self._sim = self._new_sim(cap["records"], cap["t"])  # re-registers the collision resolver


def get_service() -> SimulationService:
    """The default universe's engine (the legacy single-simulation routes act on it)."""
    from backend.universes import DEFAULT_UNIVERSE_ID, get_registry  # local: universes imports this module
    return get_registry().get(DEFAULT_UNIVERSE_ID).engine
