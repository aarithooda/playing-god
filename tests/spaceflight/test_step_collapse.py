"""The PRS23 step collapse and its guard (D-071).

Root cause, from REBOUND's src/integrator_ias15.c: PRS23 steps with the smallest per-particle timescale
tau^2 = 2 |a|^2 / (|j|^2 + |a| |s|). Where a particle's acceleration passes through zero while its jerk does not, tau is the time left
until the zero, so every step covers a fixed fraction of the remaining time: the step shrinks geometrically and the zero is never
reached. A universe that holds a spacecraft must use PRS23 (the GLOBAL criterion needs a million steps per day next to a low orbit),
so before the guard such a universe could not advance past a configuration in which two bodies close head-on along the line through
a third: the step timed out and was rolled back, every time.

The first test reproduces the collapse on plain REBOUND, with no application code, so the cause is pinned independently of the fix.
"""
import math
import time

import pytest
import rebound

from backend.collisions import GLOBAL_STEPS_AFTER_COLLAPSE, StepCollapseGuard, collapse_threshold
from backend.simulation import SimulationService
from backend.spaceflight.requests import MissionCreate, MissionObjective, MissionPlanRequest
from tests.spaceflight.helpers import G, M_EARTH, R_EARTH, add_craft, body, craft_of, earth_moon_service, earth_service

# Two small bodies 100 m apart on the line through the Earth, closing at 5 m/s. The Earth pulls A with 1.59e-3 m/s^2; B's pull on A
# equals it at a separation of sqrt(G m_B / a_earth) = 28.93 m, reached after (100 - 28.93) / 5 = 14.2 s; they touch at 20 m, 16 s.
X0, M_A, M_B, R_SMALL, CLOSING = 5.0e8, 1.0e10, 2.0e10, 10.0, 5.0


def _plain(mode: str) -> rebound.Simulation:
    sim = rebound.Simulation()
    sim.G = G
    sim.integrator = "ias15"
    sim.integrator.adaptive_mode = mode
    sim.add(m=M_EARTH, r=R_EARTH)
    r = R_EARTH + 400.0e3
    sim.add(m=2000.0, r=5.0, x=r, vy=math.sqrt(G * M_EARTH / r))  # the spacecraft whose low orbit makes PRS23 necessary
    sim.add(m=M_A, r=R_SMALL, x=X0)
    sim.add(m=M_B, r=R_SMALL, x=X0 + 100.0, vx=-CLOSING)
    return sim


def _separation_of_zero_force() -> float:
    return math.sqrt(G * M_B / (G * M_EARTH / X0 ** 2))


def test_prs23_alone_never_passes_the_point_where_a_bodys_acceleration_is_zero():
    """Plain REBOUND, no guard: after 3,000 steps the simulation sits where B's pull on A equals the Earth's, with a step far below
    anything physical, and tens of thousands of further steps move nothing. GLOBAL walks through the same point in about fifteen."""
    crossing = (100.0 - _separation_of_zero_force()) / CLOSING  # 14.2 s (the bodies barely accelerate before it)
    sim = _plain("prs23")
    sim.steps(3000)
    stuck_at = sim.t
    separation = sim.particles[3].x - sim.particles[2].x
    assert stuck_at == pytest.approx(crossing, abs=0.01) and stuck_at < crossing + 0.01
    assert separation == pytest.approx(_separation_of_zero_force(), rel=1e-4)
    assert abs(sim.dt_last_done) < 1.0e-6  # collapsed: a physical step here is about a second
    sim.steps(40_000)
    assert sim.t - stuck_at < 1.0e-4  # forty thousand more steps: no progress
    assert abs(sim.dt_last_done) < 1.0e-15  # and the step is now below the resolution of the time variable itself
    assert sim.t < crossing + 0.01

    reference = _plain("global")
    reference.integrate(15.5)
    assert reference.t == 15.5 and reference.steps_done < 100


def test_the_guard_takes_prs23_through_the_zero_and_the_result_is_the_reference():
    """With the guard the same simulation reaches the target, in one hand-over, and agrees with the GLOBAL reference to round-off:
    no accuracy is traded (every step was chosen by a valid IAS15 criterion)."""
    reference = _plain("global")
    reference.integrate(15.5)
    sim = _plain("prs23")
    guard = StepCollapseGuard()
    guard.arm(sim)
    sim.heartbeat = lambda ptr: guard.beat(ptr.contents)
    sim.integrate(15.5)
    guard.release(sim)
    assert sim.t == 15.5 and guard.fallbacks == 1 and sim.steps_done < 20_000
    assert str(sim.integrator.adaptive_mode).upper() == "PRS23"  # restored
    for k in (1, 2, 3):
        p, q = sim.particles[k], reference.particles[k]
        assert math.dist((p.x, p.y, p.z), (q.x, q.y, q.z)) < 1.0e-8  # craft: 3e-11 m; A and B: identical
        assert math.dist((p.vx, p.vy, p.vz), (q.vx, q.vy, q.vz)) < 1.0e-10
    e0 = _plain("prs23").energy()
    assert abs((sim.energy() - e0) / e0) < 1.0e-13


def _engine(with_craft: bool):
    svc, earth = earth_service()
    svc.step_time_limit_s = 10.0
    craft = add_craft(svc, earth, 400.0e3) if with_craft else None
    a = svc.add_body(body("A", M_A, R_SMALL, x=(X0, 0.0, 0.0)))
    b = svc.add_body(body("B", M_B, R_SMALL, x=(X0 + 100.0, 0.0, 0.0), v=(-CLOSING, 0.0, 0.0)))
    return svc, a.id, b.id, None if craft is None else craft.id


def test_a_universe_with_a_spacecraft_advances_through_a_head_on_approach_to_the_contact():
    """The reported failure, through the application: before the guard this step ran into the 10 s time limit and was rolled back
    (HTTP 503), on every attempt. Now it completes in a fraction of a second and stops at the contact of A and B, at the same
    instant as in the same universe without a spacecraft (which uses the GLOBAL criterion and never had the problem)."""
    plain, a0, b0, _ = _engine(with_craft=False)
    expected = plain.step(30.0)
    assert expected.halt is not None and set(expected.halt.bodyIds) == {a0, b0} and plain._step_guard.fallbacks == 0

    svc, a, b, craft = _engine(with_craft=True)
    started = time.monotonic()
    state = svc.step(30.0)
    assert time.monotonic() - started < 5.0  # 0.03 s here; the old behaviour was the full 10 s limit and an error
    assert svc._step_guard.fallbacks >= 1
    assert [e.type for e in state.events] == ["contact"] and set(state.halt.bodyIds) == {a, b}
    assert state.simulationTimeS == pytest.approx(expected.simulationTimeS, abs=1.0e-6)  # contact at 16.0 s
    assert state.halt.relativeSpeedMPerS == pytest.approx(expected.halt.relativeSpeedMPerS, rel=1e-9)
    assert state.warnings == ["collision_stopped"]
    # the spacecraft flew its orbit meanwhile, and the criterion is PRS23 again
    assert craft_of(state, craft).spacecraft.orbit.regime == "bound"
    assert str(svc._sim.integrator.adaptive_mode).upper() == "PRS23"


def test_the_guard_never_acts_on_an_ordinary_flight():
    """Existing behaviour is untouched: the threshold lies orders of magnitude below any step an ordinary universe takes, so the
    guard does nothing in a parking orbit, on a translunar coast, or in a moon system."""
    svc = earth_moon_service()
    craft = add_craft(svc, "body-earth", 300.0e3, dry=3000.0, propellant=12000.0, thrust=50000.0, isp=450.0)
    mission = svc.create_mission(MissionCreate(name="M", spacecraftId=craft.id, destinationBodyId="body-moon",
                                               objective=MissionObjective(periapsisAltitudeM=100.0e3)))
    assert svc.plan_mission(mission.id, MissionPlanRequest()).status == "planned"
    svc.commit_mission(mission.id)
    smallest = math.inf
    for _ in range(140):  # the whole transfer, the insertion and the first lunar revolutions
        svc.step(3600.0)
        smallest = min(smallest, abs(svc._sim.dt_last_done))
    result = next(m for m in svc.snapshot().spaceflight.missions if m.id == mission.id)
    assert result.status == "completed"
    assert svc._step_guard.fallbacks == 0
    assert smallest > 1.0e3 * collapse_threshold(svc._sim)  # the margin between a real step and the collapse threshold


def test_the_threshold_is_far_below_any_physical_step_and_above_the_time_resolution():
    svc, earth = earth_service()
    add_craft(svc, earth, 400.0e3)
    threshold = collapse_threshold(svc._sim)
    # fastest conceivable crossing of the smallest contact distance (craft + Earth radii at the speed of a fall to 5 m from the
    # Earth's centre), times 1e-3: about half a millisecond. A step in low orbit is tens of seconds.
    assert 1.0e-5 < threshold < 1.0e-2
    period = 2.0 * math.pi * math.sqrt((R_EARTH + 400.0e3) ** 3 / (G * M_EARTH))
    assert threshold < 1.0e-6 * period
    lone = SimulationService()
    assert collapse_threshold(lone._sim) > 0.0  # no bodies: only the time-resolution term
    with svc.locked():
        svc._sim.t = 1.0e15
        assert collapse_threshold(svc._sim) >= 64.0 * math.ulp(1.0e15)  # never below what the time variable can resolve
    assert GLOBAL_STEPS_AFTER_COLLAPSE >= 8


def test_the_guard_is_inert_for_a_simulation_that_does_not_use_prs23():
    sim = _plain("global")
    guard = StepCollapseGuard()
    guard.arm(sim)
    sim.heartbeat = lambda ptr: guard.beat(ptr.contents)
    sim.integrate(15.5)
    guard.release(sim)
    assert guard.fallbacks == 0 and str(sim.integrator.adaptive_mode).upper() == "GLOBAL"


def test_the_planner_cannot_be_held_by_a_copy_that_stops_making_progress():
    """The planner flies copies of the universe with collisions switched off, so A and B, which touch in the live universe, pass
    through each other's centre there: a true singularity that no step criterion survives. Before the watch such a copy held a
    worker thread forever; now the design ends at its time budget and says so."""
    svc = earth_moon_service()
    craft = add_craft(svc, "body-earth", 300.0e3, dry=3000.0, propellant=12000.0, thrust=50000.0, isp=450.0)
    earth = craft_of(svc.snapshot(), "body-earth")
    x = earth.positionM.x - 2.0e8  # on the Earth-Moon line, on the far side from the Moon
    svc.add_body(body("A", M_A, R_SMALL, x=(x, earth.positionM.y, 0.0), v=(0.0, earth.velocityMPerS.y, 0.0)))
    svc.add_body(body("B", M_B, R_SMALL, x=(x - 100.0, earth.positionM.y, 0.0), v=(CLOSING, earth.velocityMPerS.y, 0.0)))
    mission = svc.create_mission(MissionCreate(name="M", spacecraftId=craft.id, destinationBodyId="body-moon",
                                               objective=MissionObjective(periapsisAltitudeM=100.0e3)))
    svc.plan_time_limit_s = 2.0
    started = time.monotonic()
    planned = svc.plan_mission(mission.id, MissionPlanRequest())
    assert time.monotonic() - started < 20.0
    assert planned.status in ("draft", "planned")  # a plan, or an honest "time budget" refusal: never a hang
    if planned.status == "draft":
        assert "time budget" in planned.reasons[0]


def test_the_documented_permanent_stall_of_three_masses_on_a_line_is_cured_as_well(monkeypatch):
    """The stall this project met first (context/WORKLOG.md, 2026-10-24; tests/test_step_guard.py): three equal masses at rest on
    a line. The middle body's acceleration is round-off noise for the whole run, so with PRS23 the step collapsed for good. That
    was avoided by selecting GLOBAL for such systems; here PRS23 is forced back (as a universe with a spacecraft has it) and the
    guard carries it: the step completes, and the result is the one GLOBAL gives."""
    from backend import collisions, simulation

    def line(svc):
        return [svc.add_body(body(f"q{i}", 3.0e12, 1.0, x=(0.0, 1000.0 * i, 0.0))).id for i in range(3)]

    reference = SimulationService()  # GLOBAL: no satellites, no spacecraft
    ids_ref = line(reference)
    expected = reference.step(300.0)

    def prs23(sim):
        sim.integrator = "ias15"  # REBOUND's default criterion: PRS23

    monkeypatch.setattr(simulation, "select_ias15", prs23)
    monkeypatch.setattr(collisions, "select_ias15", prs23)
    svc = SimulationService()
    svc.step_time_limit_s = 10.0
    ids = line(svc)
    assert str(svc._sim.integrator.adaptive_mode).upper() == "PRS23"
    started = time.monotonic()
    state = svc.step(300.0)
    assert time.monotonic() - started < 5.0 and state.simulationTimeS == 300.0 and state.events == []
    assert svc._step_guard.fallbacks >= 1
    for i, j in zip(ids, ids_ref):
        got, want = craft_of(state, i), craft_of(expected, j)
        assert got.positionM.y == pytest.approx(want.positionM.y, abs=1.0e-9)
        assert got.velocityMPerS.y == pytest.approx(want.velocityMPerS.y, abs=1.0e-12)
    middle = craft_of(state, ids[1])
    assert middle.positionM.y == pytest.approx(1000.0, abs=1.0e-6) and abs(middle.velocityMPerS.y) < 1.0e-9
