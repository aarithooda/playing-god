"""Regression tests for the defects an independent review of the spaceflight backend found (2026-11-15). Each test reproduces the
failure scenario of one finding and pins the corrected behaviour; the finding is quoted in the docstring."""
import math
import threading
import time
from dataclasses import replace

import pytest

from backend.simulation import LEGACY_MERGE_CONFIG, SimulationBusyError, SimulationService
from backend.spaceflight import orbits as o
from backend.spaceflight.dynamics import Gravitator, Hierarchy
from backend.spaceflight.engine import SpaceflightError, orbit_about
from backend.spaceflight.requests import MissionCreate, MissionObjective, MissionPlanRequest, OrbitSpec, SpacecraftCreate, StateSpec
from tests.spaceflight.helpers import G, M_EARTH, R_EARTH, add_craft, body, craft_of, earth_moon_service, earth_service, node, rel

G0 = 9.80665


def _coasting_twin_velocity(prop: float, dt: float):
    svc, eid = earth_service()
    c = add_craft(svc, eid, 400.0e3, dry=1000.0, propellant=prop, thrust=10000.0, isp=320.0)
    return rel(svc.step(dt), c.id, eid)[1]


# ---------------------------------------------------------------------------------------------------------------
# burns
# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("propellant", [1.0e-9, 1.0e-7])
def test_a_burn_shorter_than_the_time_resolution_does_not_keep_thrusting(propellant):
    """Finding 1: a finite burn whose cutoff was already due at ignition was never cut off, so the engine thrust until the end of
    the step (665 m/s gained from 1e-9 kg of propellant)."""
    svc, eid = earth_service()
    c = add_craft(svc, eid, 400.0e3, dry=1000.0, propellant=propellant, thrust=10000.0, isp=320.0)
    svc.add_maneuver(c.id, node(at="now", mode="finite", progradeMPerS=50.0))
    state = svc.step(60.0)
    gained = math.dist(rel(state, c.id, eid)[1], _coasting_twin_velocity(propellant, 60.0))
    done = state.spaceflight.maneuvers[0]
    assert gained < 1.0e-5  # what 1e-7 kg can give a tonne is 3e-7 m/s
    assert done.status == "executed" and done.propellantUsedKg == pytest.approx(propellant) and "propellant ran out" in done.failure
    assert done.deliveredDeltaVMPerS == pytest.approx(320.0 * G0 * math.log((1000.0 + propellant) / 1000.0), rel=1e-6)
    assert not craft_of(state, c.id).spacecraft.thrusting and craft_of(state, c.id).massKg == pytest.approx(1000.0)


def _merge_during_burn(burn: dict | None):
    """A legacy-merge universe: Earth, two small bodies A and B that merge after about 16 s, a far bystander C added last, and a
    spacecraft that may be burning. Returns (state, craft id, earth id, C id)."""
    svc, eid = earth_service(LEGACY_MERGE_CONFIG)
    svc.add_body(body("A", 1.0e3, 10.0, x=(5.0e8, 0.0, 0.0)))
    svc.add_body(body("B", 2.0e3, 10.0, x=(5.0e8 + 100.0, 0.0, 0.0), v=(-5.0, 0.0, 0.0)))
    c = add_craft(svc, eid, 400.0e3, dry=1000.0, propellant=1000.0, thrust=10000.0, isp=320.0)
    far = svc.add_body(body("C", 500.0, 10.0, x=(-7.0e8, 0.0, 0.0)))
    if burn is not None:
        svc.add_maneuver(c.id, node(at="now", mode="finite", **burn))
    return svc.step(40.0), c.id, eid, far.id


@pytest.mark.parametrize("burn", [dict(frame="inertial", deltaVMPerS=dict(x=0.0, y=300.0, z=0.0)), dict(progradeMPerS=300.0)])
def test_a_merger_of_other_bodies_during_a_burn_never_pushes_a_bystander(burn):
    """Finding 2: the thrust force kept particle indices from before a merge inside the same integration, so after the merge the
    thrust went to the wrong particle (a bystander gained 121.7 m/s), or the step failed on an index out of range."""
    quiet, craft_q, earth_q, far_q = _merge_during_burn(None)
    state, craft, earth, far = _merge_during_burn(burn)
    assert [e.type for e in state.events] == ["maneuver", "merger"]
    v_far, v_far_quiet = craft_of(state, far).velocityMPerS, craft_of(quiet, far_q).velocityMPerS
    assert math.dist((v_far.x, v_far.y, v_far.z), (v_far_quiet.x, v_far_quiet.y, v_far_quiet.z)) < 1.0e-9  # only the craft's own gravity differs
    # the craft got the whole 40 s of thrust: v_e ln(m0 / (m0 - mdot t))
    ve = 320.0 * G0
    expected = ve * math.log(2000.0 / (2000.0 - 10000.0 / ve * 40.0))
    gained = math.dist(rel(state, craft, earth)[1], rel(quiet, craft_q, earth_q)[1])
    assert gained == pytest.approx(expected, rel=0.02)  # the comparison is with a coasting twin on a curved orbit
    assert craft_of(state, craft).massKg == pytest.approx(2000.0 - 10000.0 / ve * 40.0, rel=1e-12)


def test_a_burn_whose_reference_body_merges_away_is_shut_down_and_booked_as_delivered():
    """Finding 5: when the reference body of a VNB burn merged away the thrust stopped, but the propellant kept draining and the
    node later reported the full delta-v as delivered, with no failure."""
    svc, eid = earth_service(LEGACY_MERGE_CONFIG)
    a = svc.add_body(body("A", 1.0e3, 10.0, x=(5.0e8, 0.0, 0.0)))
    b = svc.add_body(body("B", 2.0e3, 10.0, x=(5.0e8 + 100.0, 0.0, 0.0), v=(-5.0, 0.0, 0.0)))
    # which of the two the merger removes is the resolver's choice, not this test's business: look, then burn about that one
    probe = svc.step(40.0)
    removed = next(name for name in ("A", "B") if all(x.name != name for x in probe.bodies))
    merged_at = next(e for e in probe.events if e.type == "merger").simulationTimeS
    svc, eid = earth_service(LEGACY_MERGE_CONFIG)  # the same universe again, from the start
    a = svc.add_body(body("A", 1.0e3, 10.0, x=(5.0e8, 0.0, 0.0)))
    b = svc.add_body(body("B", 2.0e3, 10.0, x=(5.0e8 + 100.0, 0.0, 0.0), v=(-5.0, 0.0, 0.0)))
    reference = a.id if removed == "A" else b.id
    c = add_craft(svc, eid, 400.0e3, dry=1000.0, propellant=1000.0, thrust=10000.0, isp=320.0)
    svc.add_maneuver(c.id, node(at="now", mode="finite", referenceBodyId=reference, progradeMPerS=600.0))
    state = svc.step(40.0)
    done = state.spaceflight.maneuvers[0]
    ve, flow = 320.0 * G0, 10000.0 / (320.0 * G0)
    assert done.status == "failed" and "reference body" in done.failure and "engine was shut down" in done.failure
    # the engine pushed until the merger and not after it: propellant and delta-v are those of that time, not of the full burn
    assert 0.0 < merged_at < 30.0
    assert done.propellantUsedKg == pytest.approx(flow * merged_at, rel=0.25) and done.propellantUsedKg < flow * 30.0
    assert done.deliveredDeltaVMPerS == pytest.approx(ve * math.log(2000.0 / (2000.0 - done.propellantUsedKg)), rel=1e-12)
    assert done.deliveredDeltaVMPerS < 0.5 * 600.0
    craft = craft_of(state, c.id)
    assert craft.massKg == pytest.approx(2000.0 - done.propellantUsedKg, rel=1e-12) and not craft.spacecraft.thrusting
    assert craft.spacecraft.propellantKg == pytest.approx(1000.0 - done.propellantUsedKg, rel=1e-12)
    # and the simulation goes on
    assert svc.step(10.0).simulationTimeS == pytest.approx(50.0)


def test_a_node_that_comes_due_while_the_engine_still_burns_fails_instead_of_sharing_the_propellant():
    """Finding 9: a burn re-timed at ignition could run into the next node of the same craft; two burns then each used their own
    analytic mass. The schedule normally keeps them apart, so the overlap is produced here by moving the second node's start."""
    svc, eid = earth_service()
    c = add_craft(svc, eid, 400.0e3, dry=1000.0, propellant=1000.0, thrust=10000.0, isp=320.0)
    first = svc.add_maneuver(c.id, node(at="now", mode="finite", progradeMPerS=300.0, label="first"))
    second = svc.add_maneuver(c.id, node(at="now", delayS=200.0, mode="impulsive", progradeMPerS=10.0, label="second"))
    inside = 0.5 * (first.startS + first.endS)
    with svc.locked():
        record = svc._flight.maneuvers[second.id]
        svc._flight.put(replace(record, epoch_s=inside, start_s=inside, end_s=inside))
    state = svc.step(first.endS + 10.0)
    by_label = {m.label: m for m in state.spaceflight.maneuvers}
    assert by_label["first"].status == "executed" and by_label["first"].failure is None
    assert by_label["first"].deliveredDeltaVMPerS == pytest.approx(300.0, rel=1e-9)
    assert by_label["second"].status == "failed" and "still burning for first" in by_label["second"].failure
    ve = 320.0 * G0
    assert craft_of(state, c.id).massKg == pytest.approx(2000.0 * math.exp(-300.0 / ve), rel=1e-12)  # one burn's propellant, exactly


def test_a_short_burn_late_in_a_long_simulation_is_not_reported_as_out_of_propellant():
    """Finding 15: the propellant of a finished burn was flow x (end - start); at t ~ 1e9 s the difference of the two times loses
    enough digits on a 0.01 s burn to exceed the shortfall tolerance, and the node (and its mission) failed."""
    svc = SimulationService()
    state = StateSpec(positionM=dict(x=0.0, y=0.0, z=0.0), velocityMPerS=dict(x=0.0, y=0.0, z=0.0))
    created, _ = svc.add_spacecraft(SpacecraftCreate(name="tug", dryMassKg=1000.0, propellantKg=1000.0, thrustN=10000.0, ispS=320.0, state=state))
    for _ in range(10):
        svc.step(1.0e8)
    svc.add_maneuver(created.id, node(at="now", delayS=5.0, mode="finite", frame="inertial", deltaVMPerS=dict(x=0.0, y=0.05, z=0.0)))
    end = svc.step(20.0)
    done = end.spaceflight.maneuvers[0]
    assert done.endS - done.startS < 0.02 and end.simulationTimeS > 1.0e9
    assert done.status == "executed" and done.failure is None
    assert done.deliveredDeltaVMPerS == pytest.approx(0.05, rel=1e-12)
    assert done.propellantUsedKg == pytest.approx(2000.0 * (1.0 - math.exp(-0.05 / (320.0 * G0))), rel=1e-12)


def test_removing_a_node_is_never_refused_because_of_another_node():
    """Finding 10: deleting an early burn raises the mass predicted for a later centred finite burn, which then has to start
    earlier; when that start lay in the past the DELETE was refused with maneuver_in_past."""
    svc, eid = earth_service()
    c = add_craft(svc, eid, 400.0e3, dry=1000.0, propellant=1000.0, thrust=10000.0, isp=320.0)
    early = svc.add_maneuver(c.id, node(at="now", delayS=1.0, mode="impulsive", progradeMPerS=1500.0))
    late = svc.add_maneuver(c.id, node(at="now", delayS=25.0, mode="finite", progradeMPerS=300.0))
    ve, flow = 320.0 * G0, 10000.0 / (320.0 * G0)
    light = 2000.0 * math.exp(-1500.0 / ve)
    assert late.startS == pytest.approx(25.0 - 0.5 * light * (1.0 - math.exp(-300.0 / ve)) / flow) and late.startS > 1.0
    full_duration = 2000.0 * (1.0 - math.exp(-300.0 / ve)) / flow
    assert 25.0 - 0.5 * full_duration < 0.0  # centred on its node, the heavier craft's burn would have to start before now
    svc.delete_maneuver(early.id)
    left = svc.snapshot().spaceflight.maneuvers
    assert [m.id for m in left] == [late.id]
    assert left[0].startS == 0.0 and left[0].endS == pytest.approx(full_duration) and left[0].feasible
    state = svc.step(100.0)
    assert state.spaceflight.maneuvers[0].status == "executed" and state.spaceflight.maneuvers[0].deliveredDeltaVMPerS == pytest.approx(300.0, rel=1e-9)


# ---------------------------------------------------------------------------------------------------------------
# orbits
# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("e", [1.0 + 1.0e-9, 1.0005, 1.001, 1.004, 1.01, 1.5, 3.0, 50.0])
@pytest.mark.parametrize("m", [-400.0, -0.9, -1.0e-6, 0.0, 1.0e-9, 0.3, 0.9, 7.0, 400.0])
def test_keplers_equation_is_solved_for_every_hyperbola(e, m):
    """Finding 7: the hyperbolic solver's starting guess M / (e - 1) overflowed sinh, or did not converge in 200 Newton steps,
    for e just above 1 (e = 1.001, M = 0.9 raised OverflowError; e = 1.0005 returned a wrong anomaly)."""
    nu = o.true_from_mean(m, e)
    assert abs(nu) < math.acos(-1.0 / e) + 1.0e-12  # inside the asymptotes
    back = o.mean_from_true(nu, e)
    # the check goes through the true anomaly, which is ill-conditioned next to the asymptote of an almost parabolic orbit
    assert back == pytest.approx(m, rel=1e-9 if e - 1.0 > 1.0e-6 else 1e-6, abs=1e-12)
    assert math.copysign(1.0, nu) == math.copysign(1.0, m) or m == 0.0


def test_a_true_anomaly_beyond_the_asymptote_is_an_orbit_error_not_a_math_error():
    with pytest.raises(o.OrbitError, match="asymptote"):
        o.eccentric_from_true(3.0, 1.5)  # the asymptote of e = 1.5 is at 2.30 rad


def test_the_orbit_summary_never_raises_whatever_the_state():
    """Finding 4: the summary computed while a state is published could raise (math domain error for an almost radial, very fast
    state), after the change it described was already committed: HTTP 500, and the published state then lacked the new body."""
    ref = Gravitator("e", M_EARTH, R_EARTH, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    hierarchy = Hierarchy((ref,), {"e": None}, {"e": math.inf})
    r, v, th = 64000809.14317202, -12150731.428549984, 1.288833903176878e-08  # the state the review found
    out = orbit_about((r, 0.0, 0.0), (v * math.cos(th), abs(v) * math.sin(th), 0.0), 1000.0, ref, hierarchy, G, {})
    assert out.regime in ("escape", "degenerate") and math.isfinite(out.speedMPerS)
    for k in range(4000):  # a sweep over almost-radial states at every speed
        radius, speed, angle = 10.0 ** (7.0 + 6.0 * (k % 40) / 40.0), 10.0 ** (2.0 + 6.0 * (k % 31) / 31.0), 10.0 ** (-14.0 + 8.0 * (k % 53) / 53.0)
        sign = 1.0 if k % 2 else -1.0
        out = orbit_about((radius, 0.0, 0.0), (sign * speed * math.cos(angle), speed * math.sin(angle), 0.0), 1000.0, ref, hierarchy, G, {})
        assert out.regime in ("bound", "suborbital", "escape", "degenerate")

    svc, eid = earth_service()
    created, _ = svc.add_spacecraft(SpacecraftCreate(name="P", dryMassKg=1000.0, state=StateSpec(
        positionM=dict(x=r, y=0.0, z=0.0), velocityMPerS=dict(x=v * math.cos(th), y=abs(v) * math.sin(th), z=0.0), relativeToBodyId=eid)))
    assert [b.id for b in svc.snapshot().bodies] == [eid, created.id]
    assert svc.step(1.0).simulationTimeS == 1.0


# ---------------------------------------------------------------------------------------------------------------
# planner and missions
# ---------------------------------------------------------------------------------------------------------------
def _lunar(**objective):
    svc = earth_moon_service()
    craft = add_craft(svc, "body-earth", 300.0e3, dry=3000.0, propellant=12000.0, thrust=50000.0, isp=450.0, name="Lunar probe")
    objective.setdefault("periapsisAltitudeM", 100.0e3)
    mission = svc.create_mission(MissionCreate(name="To the Moon", spacecraftId=craft.id, destinationBodyId="body-moon",
                                               objective=MissionObjective(**objective)))
    return svc, craft.id, mission.id


def test_a_departure_far_in_the_future_is_refused_at_once_instead_of_integrating_for_hours():
    """Finding 3: the planner integrated an ephemeris up to `earliestDepartureS` (allowed up to 1e15 s) without checking its time
    budget: 2e8 s took 8.8 s against a 2 s budget, and larger values scaled linearly."""
    svc, _, mission = _lunar()
    svc.plan_time_limit_s = 2.0
    started = time.monotonic()
    planned = svc.plan_mission(mission, MissionPlanRequest(earliestDepartureS=2.0e8))
    assert time.monotonic() - started < svc.plan_time_limit_s  # refused before any integration (it took 8.8 s before)
    assert planned.status == "unsupported" and "revolutions of Moon ahead" in planned.reasons[0]
    # a departure inside the window is still planned, and later than asked
    svc.plan_time_limit_s = 25.0
    week = 7.0 * 86400.0
    planned = svc.plan_mission(mission, MissionPlanRequest(earliestDepartureS=week))
    assert planned.status == "planned" and planned.plan["departure"]["epochS"] >= week


@pytest.mark.parametrize("burn_mode", ["impulsive", "finite"])
def test_the_time_budget_also_covers_the_work_before_the_first_trial_flight(burn_mode):
    """Finding 3, second part: the ephemeris and the finite-burn calibration ran without budget checks. The planner is given a
    clock that advances one second per look, so the result does not depend on how fast the machine is: with a 3 s budget the
    design must give up during the preparation, before any trial flight."""
    from backend.simulation import _copy_sim
    from backend.spaceflight.planner import TransferRequest, design_transfer

    svc, craft_id, _ = _lunar()
    looks = []

    def clock() -> float:
        looks.append(None)
        return float(len(looks))

    with svc.locked():
        sim, craft = _copy_sim(svc._sim), svc._flight.craft[craft_id]
    request = TransferRequest(destination_id="body-moon", periapsis_altitude_m=100.0e3, capture="circular", apoapsis_altitude_m=None,
                              direction="prograde", transfer_time_s=None, burn_mode=burn_mode, earliest_departure_s=None)
    result = design_transfer(sim, craft_id, craft, {craft_id}, request, time_budget_s=3.0, clock=clock, names={"body-moon": "Moon"})
    assert result.status == "no_solution" and result.plan is None
    assert result.reasons == ("planning exceeded its 3 s time budget before a transfer was found",)  # not "... before converging (N trial flights)"
    assert len(looks) <= 6  # it stopped at the first checks, not after hundreds of ephemeris samples
    # the same request with a real budget is planned
    planned = design_transfer(_copy_sim(svc._sim), craft_id, craft, {craft_id}, request, time_budget_s=60.0, names={"body-moon": "Moon"})
    assert planned.status == "ok"


def test_only_one_transfer_is_designed_at_a_time_in_a_universe():
    """Finding 3, third part: designs run outside the simulation lock, so parallel requests could occupy every worker thread."""
    svc, _, mission = _lunar()
    assert svc._plan_slot.acquire(blocking=False)  # a design is running
    try:
        with pytest.raises(SpaceflightError) as refused:
            svc.plan_mission(mission, MissionPlanRequest())
        assert refused.value.code == "plan_in_progress" and refused.value.status == 409
    finally:
        svc._plan_slot.release()
    assert svc.plan_mission(mission, MissionPlanRequest()).status == "planned"  # and the slot is free again afterwards


def test_a_fast_transfer_is_found_without_flying_the_whole_search_window():
    """Finding 11: the first guess of the departure time assumed arrival at the transfer orbit's apoapsis also for a requested
    (shorter) flight time, where the craft arrives well before apoapsis. Looking into it showed a second cost: a fast approach
    is focused so little by the destination that the scan never found its preferred bracket and flew all 41 window samples
    (48 trial flights) before using the one it had. Both are pinned here. The flight time of the plan is shorter than the
    two-body time asked for because the destination's gravity speeds up the last leg."""
    for days in (3.0, 2.5):
        svc, _, mission = _lunar()
        planned = svc.plan_mission(mission, MissionPlanRequest(transferTimeS=days * 86400.0))
        assert planned.status == "planned", (days, planned.reasons)
        assert planned.plan["arrival"]["transferTimeS"] == pytest.approx(days * 86400.0, rel=0.08)
        assert planned.plan["arrival"]["transferTimeS"] < days * 86400.0
        assert planned.plan["arrival"]["periapsisAltitudeM"] == pytest.approx(100.0e3, abs=1.0)
        assert planned.plan["model"]["trialFlights"] <= 20
    svc, _, mission = _lunar()  # faster than any ellipse from this orbit (a hyperbolic departure): refused with the reason
    refused = svc.plan_mission(mission, MissionPlanRequest(transferTimeS=1.5 * 86400.0))
    assert refused.status == "unsupported" and "shorter than any elliptical transfer" in refused.reasons[0]


def test_a_flyby_is_not_completed_by_being_well_aimed_before_the_pass():
    """Finding 8: a flyby was judged on the osculating periapsis at the observation time alone, so a craft that was aimed correctly
    but observed early (the pass had not happened) completed the mission."""
    svc, craft, mission = _lunar(type="flyby", periapsisAltitudeM=2000.0e3)
    svc.plan_mission(mission, MissionPlanRequest())
    svc.commit_mission(mission)
    with svc.locked():  # observe two hours before the planned closest approach
        watch = next(m for m in svc._flight.maneuvers.values() if m.role == "observation")
        early = watch.epoch_s - 7200.0
        svc._flight.put(replace(watch, epoch_s=early, start_s=early, end_s=early))
    result = None
    for _ in range(400):
        state = svc.step(3600.0)
        result = next(m for m in state.spaceflight.missions if m.id == mission)
        if result.status in ("completed", "failed"):
            break
    checks = {c["id"]: c for c in result.checks}
    assert result.status == "failed" and "early or late" in result.reasons[0]
    assert checks["periapsis"]["ok"] and not checks["observed"]["ok"]  # well aimed, but not there
    assert checks["observed"]["actual"] > 2000.0e3 + 50.0e3


def test_a_mission_request_answers_with_the_state_it_made_even_if_another_request_follows_at_once():
    """Finding 13: mission mutations read their answer from the published state after releasing the lock; a delete in between
    turned a committed create into a 404."""
    svc, craft, mission = _lunar()
    original = svc._publish
    deleted = []

    def publish_then_delete():
        original()
        if not deleted:  # the "other request": runs right after the commit, before the first one has answered
            deleted.append(True)
            del svc._flight.missions[mission]
            original()

    svc._publish = publish_then_delete
    planned = svc.plan_mission(mission, MissionPlanRequest())
    assert planned.id == mission and planned.status == "planned" and deleted


def test_ids_of_nodes_and_missions_are_not_reused_after_a_reset_or_a_restore():
    """Finding 14: reset and snapshot restore rewound the id counter, so `msn-1` could name a different mission with the same
    plan revision (a client that cached the planned trajectory by those two would show a stale path)."""
    svc, craft, mission = _lunar()
    snap = svc._take_snapshot()
    other = add_craft(svc, "body-earth", 500.0e3, dry=3000.0, propellant=12000.0, thrust=50000.0, isp=450.0, name="Second")
    later = svc.create_mission(MissionCreate(name="Later", spacecraftId=other.id, destinationBodyId="body-moon",
                                             objective=MissionObjective(periapsisAltitudeM=100.0e3)))
    assert later.id != mission
    svc.restore_snapshot(snap)
    assert [m.id for m in svc.snapshot().spaceflight.missions] == [mission]
    again = add_craft(svc, "body-earth", 500.0e3, dry=3000.0, propellant=12000.0, thrust=50000.0, isp=450.0, name="Third")
    fresh = svc.create_mission(MissionCreate(name="Fresh", spacecraftId=again.id, destinationBodyId="body-moon",
                                             objective=MissionObjective(periapsisAltitudeM=100.0e3)))
    assert fresh.id not in (mission, later.id)


# ---------------------------------------------------------------------------------------------------------------
# previews
# ---------------------------------------------------------------------------------------------------------------
def test_a_preview_that_cannot_get_the_simulation_is_refused_without_marking_the_universe_as_failed():
    """Finding 12: previews took the mutation lock path; when a step held the lock they overwrote the universe's last failure
    with "busy" although a preview changes nothing."""
    svc, eid = earth_service()
    svc.lock_wait_s = 0.05
    holding, release = threading.Event(), threading.Event()

    def hold():
        with svc.locked():
            holding.set()
            release.wait(5.0)

    worker = threading.Thread(target=hold)
    worker.start()
    try:
        assert holding.wait(5.0)
        with pytest.raises(SimulationBusyError):
            svc.preview_orbit(OrbitSpec(centralBodyId=eid, periapsisAltitudeM=400.0e3), 1000.0, 5.0)
        assert svc.last_failure is None
    finally:
        release.set()
        worker.join()
    assert svc.preview_orbit(OrbitSpec(centralBodyId=eid, periapsisAltitudeM=400.0e3), 1000.0, 5.0).orbit.regime == "bound"
