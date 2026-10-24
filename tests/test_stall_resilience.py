"""A stuck or slow step must never make the rest of the backend unusable.

Incident (2026-10-24): a long run reached ~4.8 simulated years, then the simulation "stopped" and a browser refresh
stayed on "Connecting to the simulation backend..." while the health indicator said "connected". Evidence from the
still-running process (py-spy + a read-only decode of its REBOUND struct, context/WORKLOG.md): one `POST /step`
was inside `integrate` with IAS15's internal dt collapsed to ~5e-25 s (three equal masses on a line: D-011), and every
`GET /state` was queued on the lock that step held, while `/healthz` takes no lock. The process predated D-011/D-012.

Contract tested here:
- the real incident state no longer stalls the integrator (regression for D-011 on real data);
- reads return the last committed state without waiting for a running step, and never a half-advanced one;
- mutations wait only a bounded time and then fail with 503 "busy", changing nothing;
- after a failed step the state is the last committed one and the next valid step succeeds.
Nothing here depends on wall-clock timing beyond generous join timeouts that only matter if the contract is broken.
"""
import threading

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.models import BodyCreate
from backend.simulation import SimulationBusyError, SimulationService, get_service

# State recovered from the stuck process (REBOUND 5.2.2, SI): three Earth-mass bodies on a vertical line,
# the outer two falling symmetrically onto the middle one. t is the simulation time when the engine stalled.
INCIDENT_T = 155344829.88062295
INCIDENT_BODIES = [
    dict(name="E0", m=5.972e24, r=6371000.0, x=138969467261.30762, y=4615538501120.55, z=0.0,
         vx=-249.39838198273307, vy=29530.601618017266, vz=0.0),
    dict(name="E1", m=5.972e24, r=6371000.0, x=138969467261.0421, y=4615538501120.284, z=-3367889277.2733226,
         vx=124.69919099136654, vy=29904.699190991367, vz=401.51410248669),
    dict(name="E2", m=5.972e24, r=6371000.0, x=138969467261.0421, y=4615538501120.284, z=3367889277.2733226,
         vx=124.69919099136654, vy=29904.699190991367, vz=-401.51410248669),
]


def make(name="b", m=1.0, r=1.0, x=(0.0, 0.0, 0.0), v=(0.0, 0.0, 0.0)) -> BodyCreate:
    return BodyCreate(name=name, massKg=m, radiusM=r, positionM=dict(zip("xyz", x)),
                      velocityMPerS=dict(zip("xyz", v)), colorHex="#ffffff")


@pytest.fixture
def svc():
    s = SimulationService()
    s.lock_wait_s = 0.2  # keep "busy" tests fast; the default is the step budget plus a margin
    return s


class BlockedStep:
    """Makes `svc.step` hold the lock until released, like a long or stuck integration (without sleeping)."""

    def __init__(self, svc: SimulationService, monkeypatch, advance_time: bool = True):
        self.svc = svc
        self.started = threading.Event()
        self.release = threading.Event()
        self.error: BaseException | None = None
        real_advance = svc._advance

        def blocked_advance(target: float) -> None:
            self.started.set()
            assert self.release.wait(timeout=30), "test bug: step was never released"
            if advance_time:
                real_advance(target)

        monkeypatch.setattr(svc, "_advance", blocked_advance)

    def run(self, dt: float):
        def target():
            try:
                self.svc.step(dt)
            except BaseException as e:  # noqa: BLE001 - reported by the test
                self.error = e

        self.thread = threading.Thread(target=target)
        self.thread.start()
        assert self.started.wait(timeout=10)

    def finish(self):
        self.release.set()
        self.thread.join(timeout=30)
        assert not self.thread.is_alive()


def call_with_timeout(fn, timeout=5.0):
    """Runs fn in a thread; fails (instead of hanging the suite) if it does not return."""
    box: dict = {}

    def run():
        try:
            box["value"] = fn()
        except BaseException as e:  # noqa: BLE001
            box["error"] = e

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(timeout)
    assert not t.is_alive(), "call blocked behind a running step"
    if "error" in box:
        raise box["error"]
    return box.get("value")


# ---------- the incident state ----------
def test_incident_state_completes_instead_of_stalling(monkeypatch):
    """The recovered state hung forever on the pre-D-011 code (verified out of tree). With the GLOBAL criterion the
    same step completes, and the symmetric double collision resolves as two mergers conserving mass."""
    monkeypatch.setenv("PG_STEP_TIME_LIMIT_S", "120")  # generous: only a genuine stall can exceed it
    s = SimulationService()
    s._sim.t = INCIDENT_T
    for b in INCIDENT_BODIES:
        s.add_body(make(b["name"], b["m"], b["r"], (b["x"], b["y"], b["z"]), (b["vx"], b["vy"], b["vz"])))
    total_mass = sum(b["m"] for b in INCIDENT_BODIES)

    r = s.step(1e7)

    assert r.advancedS == pytest.approx(1e7)
    assert r.simulationTimeS == pytest.approx(INCIDENT_T + 1e7)
    assert [e.type for e in r.events] == ["merger", "merger"]
    assert sum(b.massKg for b in r.bodies) == pytest.approx(total_mass, rel=1e-12)
    assert len(r.bodies) == 1


# ---------- reads never wait for a step ----------
def test_reads_return_the_last_committed_state_while_a_step_is_running(svc, monkeypatch):
    svc.add_body(make("A", x=(0, 0, 0)))
    svc.add_body(make("B", x=(1e6, 0, 0)))
    committed = svc.snapshot()
    step = BlockedStep(svc, monkeypatch)
    step.run(100.0)
    try:
        assert call_with_timeout(svc.snapshot) == committed  # not blocked, not half-advanced
        assert call_with_timeout(svc.events) == []
    finally:
        step.finish()
    assert step.error is None
    assert svc.snapshot().simulationTimeS == pytest.approx(100.0)  # committed only when the step finished


def test_a_failed_step_leaves_the_last_committed_state_visible(svc, monkeypatch):
    svc.add_body(make("A"))
    svc.add_body(make("B", x=(1e6, 0, 0)))
    committed = svc.snapshot()

    def failing_advance(target):  # mutates the engine, then fails: the half-advanced state must never be exposed
        svc._sim.t = target
        raise RuntimeError("engine blew up")

    monkeypatch.setattr(svc, "_advance", failing_advance)
    with pytest.raises(Exception, match="rolled back"):
        svc.step(50.0)
    assert svc.snapshot() == committed
    assert svc.snapshot().simulationTimeS == 0.0


def test_a_valid_step_succeeds_after_a_transient_failure(svc, monkeypatch):
    svc.add_body(make("A"))
    svc.add_body(make("B", x=(1e6, 0, 0)))
    real = svc._advance
    calls = {"n": 0}

    def flaky(target):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient")
        real(target)

    monkeypatch.setattr(svc, "_advance", flaky)
    with pytest.raises(Exception):
        svc.step(10.0)
    assert svc.snapshot().simulationTimeS == 0.0
    r = svc.step(10.0)
    assert r.advancedS == pytest.approx(10.0) and svc.snapshot().simulationTimeS == pytest.approx(10.0)


# ---------- mutations are bounded ----------
def test_mutations_during_a_running_step_fail_busy_and_change_nothing(svc, monkeypatch):
    a = svc.add_body(make("A"))
    svc.add_body(make("B", x=(1e6, 0, 0)))
    committed = svc.snapshot()
    step = BlockedStep(svc, monkeypatch)
    step.run(100.0)
    try:
        for attempt in (
            lambda: svc.add_body(make("C", x=(5e6, 0, 0))),
            lambda: svc.delete_body(a.id),
            lambda: svc.reset(),
            lambda: svc.step(1.0),
        ):
            with pytest.raises(SimulationBusyError, match="busy"):
                call_with_timeout(attempt)
        assert svc.snapshot() == committed
    finally:
        step.finish()
    assert step.error is None
    assert [b.name for b in svc.snapshot().bodies] == ["A", "B"]  # nothing leaked in


# ---------- over HTTP ----------
@pytest.fixture
def client(svc):
    app.dependency_overrides[get_service] = lambda: svc
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_http_reads_and_health_answer_during_a_step_and_writes_get_503(svc, client, monkeypatch):
    svc.add_body(make("A"))
    svc.add_body(make("B", x=(1e6, 0, 0)))
    step = BlockedStep(svc, monkeypatch)
    step.run(100.0)
    try:
        assert call_with_timeout(lambda: client.get("/healthz").status_code) == 200
        state = call_with_timeout(lambda: client.get("/api/v1/simulation/state"))
        assert state.status_code == 200 and state.json()["simulationTimeS"] == 0.0
        assert call_with_timeout(lambda: client.get("/api/v1/events").status_code) == 200
        busy = call_with_timeout(lambda: client.post("/api/v1/bodies", json=make("C", x=(5e6, 0, 0)).model_dump()))
        assert busy.status_code == 503 and "busy" in busy.json()["detail"]
        assert busy.headers["retry-after"]
        stepped = call_with_timeout(lambda: client.post("/api/v1/simulation/step", json={"dtS": 1.0}))
        assert stepped.status_code == 503
    finally:
        step.finish()
    after = client.get("/api/v1/simulation/state").json()
    assert after["simulationTimeS"] == pytest.approx(100.0) and len(after["bodies"]) == 2
