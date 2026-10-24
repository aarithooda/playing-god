"""Shared test helpers (importable as `tests.helpers`)."""
import threading

from backend.models import BodyCreate
from backend.simulation import SimulationService


def make(name="b", m=1.0, r=1.0, x=(0.0, 0.0, 0.0), v=(0.0, 0.0, 0.0), **extra) -> BodyCreate:
    return BodyCreate(name=name, massKg=m, radiusM=r, positionM=dict(zip("xyz", x)),
                      velocityMPerS=dict(zip("xyz", v)), colorHex="#ffffff", **extra)


def two_bodies(svc: SimulationService, offset: float = 1.0e6) -> None:
    svc.add_body(make("A", m=1.0e20, r=1.0))
    svc.add_body(make("B", m=1.0, r=1.0, x=(offset, 0.0, 0.0), v=(0.0, 0.0, 1.0)))


def dump(engine: SimulationService) -> str:
    """Everything an observer can see of an engine, exactly (floats print round-trip)."""
    return engine.snapshot().model_dump_json() + f"|rev={engine.revision}"


class BlockedStep:
    """Makes `engine.step` hold the lock until released, like a long or stuck integration (without sleeping)."""

    def __init__(self, engine: SimulationService, monkeypatch, advance_time: bool = True):
        self.engine = engine
        self.started = threading.Event()
        self.release = threading.Event()
        self.error: BaseException | None = None
        self.result = None
        real_advance = engine._advance

        def blocked_advance(target: float) -> None:
            self.started.set()
            assert self.release.wait(timeout=30), "test bug: step was never released"
            if advance_time:
                real_advance(target)

        monkeypatch.setattr(engine, "_advance", blocked_advance)

    def run(self, dt: float, guard=None):
        def target():
            try:
                self.result = self.engine.step(dt, guard=guard)
            except BaseException as e:  # noqa: BLE001 - reported by the test
                self.error = e

        self.thread = threading.Thread(target=target)
        self.thread.start()
        assert self.started.wait(timeout=10)

    def finish(self):
        self.release.set()
        self.thread.join(timeout=30)
        assert not self.thread.is_alive()


def sun_earth(earth_mass: float = 5.972e24):
    """A Sun + Earth-like pair on a near-circular orbit, for engine-level history/snapshot tests."""
    from backend.simulation import InitialBody
    return [
        InitialBody(id="body-sun", name="Sun", kind="star", massKg=1.989e30, radiusM=6.957e8,
                    positionM=(0.0, 0.0, 0.0), velocityMPerS=(0.0, 0.0, 0.0), colorHex="#ffcc00"),
        InitialBody(id="body-earth", name="Earth", kind="planet", massKg=earth_mass, radiusM=6.371e6,
                    positionM=(1.496e11, 0.0, 0.0), velocityMPerS=(0.0, 29780.0, 0.0), colorHex="#3b82f6"),
    ]


DAY = 86400.0


def loaded_engine(mode: str = "grid", interval: float = DAY, bodies=None) -> SimulationService:
    s = SimulationService()
    s.load_bodies(bodies if bodies is not None else sun_earth(), history_mode=mode,
                  sample_interval_s=interval if mode == "grid" else None)
    return s
