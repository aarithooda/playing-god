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
- Structural edits (add/remove/patch) re-select IAS15 so no stale predictor state survives.
- State is in-memory, single process, lost on restart; all methods are serialized by one lock.
Known limits: see context/API_CONTRACT.md ("Physics limitations").
"""
import logging
import math
import threading
import uuid
import warnings

import rebound

from backend.collisions import MergeResolver
from backend.models import (MAX_BODIES, Body, BodyCreate, BodyUpdate, Event, Position3, SimulationState,
                            StepResponse, Vec3)

logger = logging.getLogger(__name__)

G_SI = 6.67430e-11  # m^3 kg^-1 s^-2
RAND_SEED = 12345
CURVATURE_FRACTION = 0.01  # max chord deviation per chunk as a fraction of the contact distance
MAX_CHUNKS_PER_STEP = 2000  # bounds wall time; if reached, chunks are longer than the 1% criterion asks
MAX_EVENTS_KEPT = 1000


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


class SimulationFailure(Exception):
    """The engine failed during a step; state was restored to what it was before the step."""


class SimulationService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._event_seq = 0  # never reset, so event ids are never reused
        self._init_state()

    # ---------- construction / reset ----------
    def _init_state(self) -> None:
        self._meta: dict[str, tuple[str, str]] = {}  # id -> (display name, colourHex), creation order
        self._events: list[Event] = []
        self._pending: list[Event] = []  # events recorded since the last step started
        self._resolver = MergeResolver(self._record_merge)
        self._sim = self._new_sim([], 0.0)

    def _new_sim(self, records: list[dict], t: float) -> rebound.Simulation:
        sim = rebound.Simulation()
        sim.units = ("m", "s", "kg")
        sim.G = G_SI  # after `units`, which would otherwise set REBOUND's 6.67408e-11
        sim.rand_seed = RAND_SEED
        sim.integrator = "ias15"
        sim.t = t
        for r in records:
            sim.add(**r)
        sim.collision = "line"
        sim.collision_resolve = self._resolver.resolve
        return sim

    def reset(self) -> SimulationState:
        """Remove all bodies and events, time to 0. Event ids keep counting (never reused)."""
        with self._lock:
            self._init_state()
            return self._snapshot()

    # ---------- reads ----------
    def snapshot(self) -> SimulationState:
        with self._lock:
            return self._snapshot()

    def events(self) -> list[Event]:
        with self._lock:
            return list(self._events)

    def _particles_by_id(self) -> dict:
        return {p.name: p for p in self._sim.particles}

    def _body(self, body_id: str, p) -> Body:
        name, color = self._meta[body_id]
        return Body(id=body_id, name=name, massKg=p.m, radiusM=p.r,
                    positionM=Vec3(x=p.x, y=p.y, z=p.z), velocityMPerS=Vec3(x=p.vx, y=p.vy, z=p.vz),
                    colorHex=color)

    def _snapshot(self) -> SimulationState:
        by_id = self._particles_by_id()
        # Bodies are returned in creation order regardless of REBOUND's internal array order.
        bodies = [self._body(i, by_id[i]) for i in self._meta]
        return SimulationState(status="paused", simulationTimeS=self._sim.t, bodies=bodies)

    # ---------- CRUD ----------
    def add_body(self, data: BodyCreate) -> Body:
        with self._lock:
            if len(self._meta) >= MAX_BODIES:
                raise ConflictError(f"body limit reached ({MAX_BODIES})")
            self._require_free(data.positionM, data.radiusM, ignore_id=None)
            body_id = f"body-{uuid.uuid4().hex[:12]}"
            while body_id in self._meta:
                body_id = f"body-{uuid.uuid4().hex[:12]}"
            self._sim.add(m=data.massKg, r=data.radiusM, x=data.positionM.x, y=data.positionM.y,
                          z=data.positionM.z, vx=data.velocityMPerS.x, vy=data.velocityMPerS.y,
                          vz=data.velocityMPerS.z, name=body_id)
            self._meta[body_id] = (data.name, data.colorHex)
            self._sim.integrator = "ias15"  # reset integrator state after a structural change
            return self._body(body_id, self._sim.particles[body_id])

    def update_body(self, body_id: str, patch: BodyUpdate) -> Body:
        with self._lock:
            self._require_known(body_id)
            p = self._sim.particles[body_id]
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
            name, color = self._meta[body_id]
            self._meta[body_id] = (patch.name if "name" in fields else name,
                                   patch.colorHex if "colorHex" in fields else color)
            if fields & {"massKg", "radiusM", "positionM", "velocityMPerS"}:
                self._sim.integrator = "ias15"
            return self._body(body_id, self._sim.particles[body_id])

    def delete_body(self, body_id: str) -> None:
        with self._lock:
            self._require_known(body_id)
            self._sim.remove(self._sim.particles[body_id].index)
            del self._meta[body_id]
            self._resolver.spin.pop(body_id, None)
            self._sim.integrator = "ias15"

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
    def step(self, dt_s: float) -> StepResponse:
        with self._lock:
            before = self._capture()
            self._pending = []
            t0 = self._sim.t
            try:
                self._advance(t0 + dt_s)
                self._verify_finite()
            except Exception as exc:  # noqa: BLE001 - restore, then report as one failure type
                self._restore(before)
                logger.exception("simulation step failed; state restored")
                raise SimulationFailure(f"simulation step failed and was rolled back: {exc}") from exc
            events = self._pending
            self._pending = []
            self._events.extend(events)
            del self._events[:-MAX_EVENTS_KEPT]
            state = self._snapshot()
            return StepResponse(**state.model_dump(), advancedS=self._sim.t - t0, events=events)

    def _advance(self, target: float) -> None:
        sim = self._sim
        if sim.N == 0:
            sim.t = target  # nothing to integrate; time still advances
            return
        floor = (target - sim.t) / MAX_CHUNKS_PER_STEP
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            while sim.t < target:
                remaining = target - sim.t
                chunk = max(self._chunk_limit(), floor)
                nxt = target if chunk >= remaining * (1 - 1e-9) else sim.t + chunk
                sim.integrate(nxt)
                if self._resolver.errors:
                    raise RuntimeError("collision resolver failed:\n" + self._resolver.errors[-1])
        for w in caught:
            logger.warning("REBOUND warning during step: %s", w.message)

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
            "records": [dict(m=p.m, r=p.r, x=p.x, y=p.y, z=p.z, vx=p.vx, vy=p.vy, vz=p.vz, name=p.name)
                        for p in s.particles],
            "meta": dict(self._meta),
            "heat": self._resolver.heat_J,
            "spin": {k: list(v) for k, v in self._resolver.spin.items()},
        }

    def _restore(self, cap: dict) -> None:
        self._meta = cap["meta"]
        self._resolver.errors.clear()
        self._resolver.heat_J = cap["heat"]
        self._resolver.spin = cap["spin"]
        self._pending = []
        self._sim = self._new_sim(cap["records"], cap["t"])  # re-registers the collision resolver


_service = SimulationService()


def get_service() -> SimulationService:
    return _service
