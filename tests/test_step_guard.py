"""Wall-clock guard for a step, and the IAS15 lone-body warning (P-004).

Guard contract: a step that exceeds `step_time_limit_s` between chunks raises StepTimeoutError (HTTP 503) and is
rolled back exactly like any other failed step: simulation time, bodies, events, event ids and merger ledgers are
those from before the request. The clock is faked, so the tests are deterministic and never sleep.
"""
import logging

import pytest
import rebound
from fastapi.testclient import TestClient

from backend import simulation
from backend.main import app
from backend.models import BodyCreate
from backend.simulation import SimulationFailure, SimulationService, StepTimeoutError, get_service


def make(name="b", m=1.0, r=1.0, x=(0.0, 0.0, 0.0), v=(0.0, 0.0, 0.0)) -> BodyCreate:
    return BodyCreate(name=name, massKg=m, radiusM=r, positionM=dict(zip("xyz", x)),
                      velocityMPerS=dict(zip("xyz", v)), colorHex="#ffffff")


def colliding_pair(svc, bystander=False):
    """Two spheres closing at 2 m/s from 200 m apart: contact at ~99 s. A far bystander keeps the engine from
    dropping to a single body (which the service advances without chunks) after the merger."""
    if bystander:
        svc.add_body(make("C", 10.0, 1.0, x=(1e6, 0, 0)))
    svc.add_body(make("A", 2000.0, 1.0, x=(-100, 0, 0), v=(1, 0, 0)))
    svc.add_body(make("B", 1000.0, 0.8, x=(100, 0, 0), v=(-1, 0, 0)))


@pytest.fixture
def svc():
    return SimulationService()


def test_default_budget_is_configurable_through_the_environment(monkeypatch):
    assert SimulationService().step_time_limit_s == simulation.DEFAULT_STEP_TIME_LIMIT_S == 10.0
    monkeypatch.setenv("PG_STEP_TIME_LIMIT_S", "2.5")
    assert SimulationService().step_time_limit_s == 2.5


def test_exhausted_budget_fails_before_any_chunk_and_changes_nothing(svc):
    colliding_pair(svc)
    before = svc.snapshot()
    svc.step_time_limit_s = -1.0  # deadline already passed: deterministic, independent of timer resolution
    with pytest.raises(StepTimeoutError, match="wall-clock budget"):
        svc.step(150.0)
    assert svc.snapshot() == before and svc.events() == []


def test_timeout_after_a_merger_rolls_back_the_merger_completely(svc, monkeypatch):
    """The merger happens in chunk 2 (chunks forced to 5 s); the clock then runs out before the step ends. Bodies,
    time, events, event ids, ledgers and the pending list must all be those from before the request. The fake
    clock advances by one second per chunk (it ticks when the chunk length is requested), so the outcome does not
    depend on how many internal steps the engine takes."""
    colliding_pair(svc, bystander=True)
    svc.step(90.0)  # contact is ~9 s away
    before = svc.snapshot()
    ticks = [0]

    def chunk_limit():
        ticks[0] += 1
        return 5.0

    monkeypatch.setattr(svc, "_chunk_limit", chunk_limit)
    monkeypatch.setattr(svc, "_clock", lambda: float(ticks[0]))
    svc.step_time_limit_s = 3.5  # the fourth chunk starts at tick 3 and is stopped by the heartbeat at tick 4
    with pytest.raises(StepTimeoutError):
        svc.step(60.0)
    assert ticks[0] >= 4
    assert svc.snapshot() == before  # time 90 s, both bodies at their old places
    assert svc.events() == [] and svc._pending == []
    assert svc._resolver.heat_J == 0.0 and svc._resolver.spin == {} and svc._resolver.errors == []
    assert svc._event_seq == 0  # the unseen event id is reusable

    monkeypatch.undo()  # honest clock and chunking again
    ref = SimulationService()
    colliding_pair(ref, bystander=True)
    ref.step(90.0)
    expected, got = ref.step(60.0), svc.step(60.0)
    # A rollback rebuilds the engine from the saved state, which discards IAS15's internal step history. The
    # replay is therefore the same physics on a different internal step grid: it agrees to the integrator's
    # accuracy, not bitwise, and the detection timestamp may move by one internal step (here 20 ms).
    (ge,), (xe,) = got.events, expected.events
    assert (ge.id, ge.resultMassKg) == (xe.id, xe.resultMassKg)  # body ids are random per service
    assert abs(ge.estimatedContactTimeS - xe.estimatedContactTimeS) < 1e-3
    assert abs(ge.simulationTimeS - xe.simulationTimeS) < 0.1
    for g, x in zip(got.bodies, expected.bodies):  # creation order is preserved
        assert g.name == x.name
        assert g.massKg == x.massKg
        assert g.positionM.x == pytest.approx(x.positionM.x, rel=1e-9, abs=1e-6)
        assert g.velocityMPerS.x == pytest.approx(x.velocityMPerS.x, rel=1e-9, abs=1e-12)
    assert got.events[0].id == "evt-1"


def test_timeout_is_a_simulation_failure_and_service_stays_usable(svc):
    svc.add_body(make("A", x=(0, 0, 0), v=(1, 0, 0)))
    svc.add_body(make("B", x=(1e6, 0, 0)))
    svc.step_time_limit_s = -1.0
    with pytest.raises(SimulationFailure):
        svc.step(10.0)
    svc.step_time_limit_s = 10.0
    out = svc.step(10.0)
    assert out.simulationTimeS == 10.0


def test_empty_simulation_is_not_subject_to_the_budget(svc):
    svc.step_time_limit_s = -1.0
    assert svc.step(5.0).simulationTimeS == 5.0  # nothing to integrate, nothing that can stall


def test_http_timeout_is_503_and_state_is_untouched():
    fresh = SimulationService()
    colliding_pair(fresh)
    fresh.step_time_limit_s = -1.0
    app.dependency_overrides[get_service] = lambda: fresh
    try:
        client = TestClient(app)
        before = client.get("/api/v1/simulation/state").json()
        r = client.post("/api/v1/simulation/step", json={"dtS": 150.0})
        assert r.status_code == 503 and "wall-clock budget" in r.json()["detail"]
        assert client.get("/api/v1/simulation/state").json() == before
        assert client.get("/api/v1/events").json() == {"events": []}
    finally:
        app.dependency_overrides.clear()


def test_real_clock_budget_stops_a_slow_step_and_rolls_back(svc):
    """No fakes: 60 mutually attracting bodies and a 1 ns budget. The loop checks the clock between chunks, so
    the step is cut off after at most one chunk (the 1e7 s request needs ~2000) and nothing is committed."""
    import random
    rnd = random.Random(7)
    for i in range(60):
        svc.add_body(make(f"b{i}", 1e22, 1e5, x=tuple(rnd.uniform(-5e9, 5e9) for _ in range(3)),
                          v=tuple(rnd.uniform(-1e3, 1e3) for _ in range(3))))
    before = svc.snapshot()
    svc.step_time_limit_s = 1e-9
    with pytest.raises(StepTimeoutError):
        svc.step(1e7)
    assert svc.snapshot() == before


# ---------- P-004: IAS15 non-convergence warning for a lone body ----------
def test_rebound_ias15_reports_nonconvergence_for_a_single_force_free_body():
    """Pins the REBOUND 5.2.2 behaviour behind every IAS15 warning seen in this repo (two in tests/spike, two in
    tests/validation): once a merger leaves ONE body, the acceleration is exactly zero and IAS15's convergence test
    (a relative change of the b coefficients) is 0/0, so it reports "did not converge" although the motion is exact.
    It appears sporadically (here at ~200 chunks); with two bodies it never does. If this test starts failing,
    REBOUND fixed it and `SimulationService._drift_lone_body` can go."""
    sim = rebound.Simulation()
    sim.units = ("m", "s", "kg")
    sim.integrator = "ias15"
    sim.add(m=3000.0, vx=0.3, vy=-0.2, vz=0.1)
    with pytest.warns(RuntimeWarning, match="predictor corrector loops in IAS15 did not converge"):
        for k in range(1, 400):
            sim.integrate(0.5 * k, exact_finish_time=1)


def test_lone_body_is_advanced_exactly_and_without_engine_warnings(svc, caplog):
    caplog.set_level(logging.WARNING, logger="backend.simulation")
    body = svc.add_body(make("solo", 3000.0, x=(10.0, -20.0, 30.0), v=(0.3, -0.2, 0.1)))
    for _ in range(400):  # the spurious warning appeared after ~200 half-second chunks
        svc.step(0.5)
    out = svc.snapshot()
    assert out.simulationTimeS == 200.0
    p = out.bodies[0]
    assert p.id == body.id
    assert (p.positionM.x, p.positionM.y, p.positionM.z) == pytest.approx((10.0 + 60.0, -20.0 - 40.0, 30.0 + 20.0), rel=1e-14)
    assert (p.velocityMPerS.x, p.velocityMPerS.y, p.velocityMPerS.z) == (0.3, -0.2, 0.1)
    assert [r for r in caplog.records if "REBOUND warning" in r.getMessage()] == []


def test_merger_remnant_continues_without_engine_warnings(svc, caplog):
    """The scenario that warned before: merge, then keep stepping the lone remnant in many small chunks."""
    caplog.set_level(logging.WARNING, logger="backend.simulation")
    colliding_pair(svc)
    out = svc.step(110.0)
    assert len(out.events) == 1
    for _ in range(400):
        svc.step(0.5)
    assert [r for r in caplog.records if "REBOUND warning" in r.getMessage()] == []


# ---------- engine stalls: a real REBOUND defect, found by the stress review ----------
def line_of_equal_bodies(svc, n=3, mass=3e12, spacing=1000.0):
    """n equal masses at rest on a line. The net force on every interior body cancels by symmetry."""
    ids = [svc.add_body(make(f"q{i}", mass, 1.0, x=(0.0, spacing * i, 0.0))).id for i in range(n)]
    return ids


def test_symmetric_line_of_equal_masses_no_longer_stalls_the_engine(svc):
    """REBOUND 5.2.2 with its default IAS15 step-size criterion (PRS23) never returns from `integrate` for three
    (or more) equal masses at rest on a line: the middle body's acceleration is round-off noise (~1e-29), the step
    size collapses to ~1e-18 s and ~1e6 steps/s are spent without advancing time. With the GLOBAL criterion that
    `select_ias15` installs it takes a dozen steps. Expectation: outer bodies fall toward the centre by
    0.5 * a * t^2 with a = 1.25 G m / d^2 (first-order: the force grows <= 2% over the 9 m of travel), the middle
    body stays put, and momentum and the symmetry are preserved."""
    m, d, t = 3e12, 1000.0, 300.0
    ids = line_of_equal_bodies(svc, 3, m, d)
    out = svc.step(t)
    assert out.events == [] and out.simulationTimeS == t
    low, mid, high = (next(b for b in out.bodies if b.id == i) for i in ids)
    fall = 0.5 * 1.25 * 6.67430e-11 * m / d ** 2 * t ** 2
    assert low.positionM.y == pytest.approx(fall, rel=0.05)
    assert high.positionM.y == pytest.approx(2 * d - fall, rel=0.05)
    assert mid.positionM.y == pytest.approx(d, abs=1e-6) and abs(mid.velocityMPerS.y) < 1e-9
    assert low.positionM.y + high.positionM.y == pytest.approx(2 * d, abs=1e-6)  # mirror symmetry
    assert abs(sum(b.massKg * b.velocityMPerS.y for b in out.bodies)) < 1e-9 * m


@pytest.mark.parametrize("n", [3, 5])
def test_symmetric_lines_of_equal_masses_run_for_many_small_steps(svc, n):
    ids = line_of_equal_bodies(svc, n)
    for _ in range(60):
        svc.step(5.0)
    assert svc.snapshot().simulationTimeS == 300.0 and len(svc.snapshot().bodies) == n


def test_watchdog_stops_a_genuinely_stalled_engine_and_rolls_back(svc, monkeypatch):
    """Re-create the stall by selecting REBOUND's stalling default criterion again. The budget (0.5 s) must cut
    the single, never-returning `integrate` call short through the heartbeat, so the HTTP request fails with a
    timeout instead of wedging the process and its lock; nothing is committed."""
    import time
    from backend import collisions

    def stalling_select(sim):
        sim.integrator = "ias15"  # PRS23: the REBOUND default

    monkeypatch.setattr(simulation, "select_ias15", stalling_select)
    monkeypatch.setattr(collisions, "select_ias15", stalling_select)
    line_of_equal_bodies(svc, 3)
    before = svc.snapshot()
    svc.step_time_limit_s = 0.5
    started = time.monotonic()
    with pytest.raises(StepTimeoutError):
        svc.step(300.0)
    assert time.monotonic() - started < 5.0
    assert svc.snapshot() == before and svc.events() == []
    # and the service recovers once the engine is healthy again
    monkeypatch.undo()
    simulation.select_ias15(svc._sim)  # the rolled-back engine was rebuilt with the stalling criterion
    svc.step_time_limit_s = 10.0
    assert svc.step(5.0).simulationTimeS == 5.0
