"""Minimal in-memory simulation state for milestone 1 (no physics yet)."""
import threading
import uuid

from backend.models import Body, BodyCreate, SimulationState


class SimulationStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._bodies: dict[str, Body] = {}  # insertion-ordered
        self._status = "paused"
        self._time_s = 0.0

    def add_body(self, data: BodyCreate) -> Body:
        body = Body(id=f"body-{uuid.uuid4().hex[:12]}", **data.model_dump())
        with self._lock:
            self._bodies[body.id] = body
        return body

    def snapshot(self) -> SimulationState:
        with self._lock:
            return SimulationState(
                status=self._status,
                simulationTimeS=self._time_s,
                bodies=list(self._bodies.values()),
            )


store = SimulationStore()


def get_store() -> SimulationStore:
    return store
