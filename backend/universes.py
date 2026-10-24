"""Universe registry: independent, backend-owned simulations with active-only, epoch-guarded mutation.

A universe id is not independence: every `Universe` owns its own `SimulationService` (REBOUND simulation, merger
resolver, ledgers, events), so nothing mutable is shared (tests/test_universe_registry.py asserts this with `is not`).

Activation epoch (plan sections 6.2-6.5): exactly one universe is active; every activation increments `epoch`. Each
mutation is issued under an epoch and carries a `CommitGuard` that re-validates under the registry lock. The engine
calls it after taking its own lock and again right before committing, so a request that was valid when sent but
overtaken by a switch (including A -> B -> A) is refused or rolled back and can never change the wrong universe.

Lock order: an engine lock may be held while briefly taking the registry lock; the registry lock is never held while
waiting for an engine lock (activation only sets a cancel flag on the outgoing engine).
"""
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from backend.errors import CodedError, universe_not_found
from backend.simulation import CommitGuard, ConflictError, SimulationService

DEFAULT_UNIVERSE_ID = "uni-default"
MAX_UNIVERSES = 8
MAX_SNAPSHOTS_PER_UNIVERSE = 10
ROLES = ("sandbox", "preset", "baseline", "modified")

# Operations a role may not perform (plan section 11.3). The baseline is an immutable experimental reference.
_PROTECTED_OPS = {"baseline": {"body", "snapshot"}}


@dataclass
class Universe:
    id: str
    name: str
    role: str
    engine: SimulationService
    preset_id: str | None = None
    experiment_id: str | None = None
    provenance: dict | None = None
    created_at: str = field(default_factory=lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    snapshots: dict = field(default_factory=dict)
    deleted: bool = False


class UniverseRegistry:
    def __init__(self, engine_factory: Callable[[], SimulationService] = SimulationService):
        self._engine_factory = engine_factory
        self._lock = threading.RLock()
        self._universes: dict[str, Universe] = {}
        self._deleted_ids: set[str] = set()
        self._counter = 0
        default = Universe(DEFAULT_UNIVERSE_ID, "Sandbox", "sandbox", engine_factory())
        self._universes[default.id] = default
        self._active_id = default.id
        self._epoch = 1

    # ---------- reads ----------
    @property
    def active_id(self) -> str:
        return self._active_id

    @property
    def epoch(self) -> int:
        return self._epoch

    def get(self, universe_id: str) -> Universe:
        with self._lock:
            u = self._universes.get(universe_id)
            if u is None:
                raise universe_not_found(universe_id, deleted=universe_id in self._deleted_ids)
            return u

    def list(self) -> list[Universe]:
        with self._lock:
            return list(self._universes.values())

    # ---------- lifecycle ----------
    def create(self, name: str | None = None, role: str = "sandbox", engine: SimulationService | None = None,
               provenance: dict | None = None, preset_id: str | None = None, experiment_id: str | None = None,
               activate: bool = False) -> Universe:
        with self._lock:
            if len(self._universes) >= MAX_UNIVERSES:
                raise CodedError(f"universe limit reached ({MAX_UNIVERSES}); delete one first", code="universe_limit")
            if role not in ROLES:
                raise ConflictError(f"unknown universe role: {role}")
            self._counter += 1
            if name is None:
                name = f"Universe {self._counter}"
            if not 1 <= len(name) <= 64:
                raise ConflictError("universe name must be 1-64 characters")
            uid = f"uni-{self._new_hex()}"
            u = Universe(uid, name, role, engine if engine is not None else self._engine_factory(),
                         preset_id=preset_id, experiment_id=experiment_id, provenance=provenance)
            self._universes[uid] = u
            if activate:
                self.activate(uid)
            return u

    def _new_hex(self) -> str:
        import uuid
        while True:
            h = uuid.uuid4().hex[:12]
            if f"uni-{h}" not in self._universes and f"uni-{h}" not in self._deleted_ids:
                return h

    def delete(self, universe_id: str) -> None:
        with self._lock:
            u = self.get(universe_id)
            if universe_id == self._active_id:
                raise CodedError("the active universe cannot be deleted; activate another one first",
                                 code="active_universe_delete")
            u.deleted = True
            del self._universes[universe_id]
            self._deleted_ids.add(universe_id)
            u.engine.request_cancel()  # a straggling mutation is stopped; the guard also refuses it

    def activate(self, universe_id: str) -> dict:
        """Makes `universe_id` the one active universe. Never integrates and never waits for an engine."""
        with self._lock:
            new = self.get(universe_id)
            previous = self._universes[self._active_id]
            if universe_id == self._active_id:
                return self._activation_result(None)  # idempotent: no epoch change, nothing in flight is disturbed
            previous.engine.request_cancel()
            self._active_id = universe_id
            self._epoch += 1
            new.engine.clear_cancel()
            state, revision = previous.engine.published()
            return self._activation_result({"universeId": previous.id, "simulationTimeS": state.simulationTimeS,
                                            "revision": revision})

    def _activation_result(self, previous: dict | None) -> dict:
        return {"activeUniverseId": self._active_id, "activationEpoch": self._epoch, "previous": previous}

    # ---------- guards ----------
    def _validate(self, universe_id: str, activation_epoch: int, expected_revision: int | None) -> None:
        with self._lock:
            u = self.get(universe_id)
            if universe_id != self._active_id:
                raise CodedError(f"universe {universe_id} is not the active universe; activate it first",
                                 code="universe_not_active")
            if activation_epoch != self._epoch:
                raise CodedError(f"stale activation epoch {activation_epoch} (current: {self._epoch}); "
                                 "the active universe changed since this request was prepared",
                                 code="stale_activation")
            if expected_revision is not None and u.engine.revision != expected_revision:
                raise CodedError(f"stale revision: expected {expected_revision}, universe is at {u.engine.revision}",
                                 code="stale_revision")

    def guard_for(self, universe_id: str, activation_epoch: int, expected_revision: int | None = None) -> CommitGuard:
        """Validates now (raising a CodedError) and returns a closure that re-validates at commit time."""
        self._validate(universe_id, activation_epoch, expected_revision)

        def guard() -> None:
            self._validate(universe_id, activation_epoch, expected_revision)

        return guard

    def guard_current(self, universe_id: str) -> CommitGuard:
        """Guard under whatever the current epoch is (legacy routes, which carry no epoch of their own)."""
        with self._lock:
            return self.guard_for(universe_id, self._epoch)

    def prepare(self, universe_id: str, activation_epoch: int, op: str,
                expected_revision: int | None = None) -> tuple[Universe, CommitGuard]:
        """Guard plus the role rules of plan section 11.3; `op` is one of step, reset, body, snapshot."""
        guard = self.guard_for(universe_id, activation_epoch, expected_revision)
        u = self.get(universe_id)
        if op in _PROTECTED_OPS.get(u.role, ()):
            raise CodedError(f"the {u.role} run is an immutable reference: {op} operations are not allowed",
                             code="baseline_protected")
        return u, guard


_registry = UniverseRegistry()


def get_registry() -> UniverseRegistry:
    return _registry


def get_legacy_guard() -> CommitGuard:
    """FastAPI dependency for the legacy single-simulation routes: they act on `uni-default` only, and refuse
    (409 universe_not_active) while another universe is active."""
    return get_registry().guard_current(DEFAULT_UNIVERSE_ID)
