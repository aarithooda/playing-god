"""Mission planning and the evaluation of the actual outcome (planner.py, missions.py, engine)."""
import math

import pytest

from backend.simulation import SimulationService
from backend.spaceflight import orbits as o
from backend.spaceflight.engine import SpaceflightError
from backend.spaceflight.requests import MissionCreate, MissionObjective, MissionPlanRequest, SpacecraftUpdate
from tests.spaceflight.helpers import (D_MOON, G, M_EARTH, M_MOON, R_EARTH, R_MOON, add_craft, body, craft_of, earth_moon_service,
                                       earth_service, node, rel)


def lunar_setup(altitude=300.0e3, propellant=12000.0, thrust=50000.0, **orbit):
    svc = earth_moon_service()
    craft = add_craft(svc, "body-earth", altitude, dry=3000.0, propellant=propellant, thrust=thrust, isp=450.0, name="Lunar probe", **orbit)
    return svc, craft.id


def new_mission(svc, craft, destination="body-moon", **objective):
    objective.setdefault("periapsisAltitudeM", 100.0e3)
    return svc.create_mission(MissionCreate(name="To the Moon", spacecraftId=craft, destinationBodyId=destination,
                                            objective=MissionObjective(**objective)))


def fly(svc, mission_id, dt=3600.0, limit=600):
    """Step until the mission is over; returns (mission, phases seen in order)."""
    phases = []
    for _ in range(limit):
        state = svc.step(dt)
        mission = next(m for m in state.spaceflight.missions if m.id == mission_id)
        label = (mission.status, mission.phase.split(" (")[0])
        if not phases or phases[-1] != label:
            phases.append(label)
        if mission.status in ("completed", "failed"):
            return mission, phases
    raise AssertionError(f"mission still {phases[-1]} after {limit} steps")


# ---------------------------------------------------------------------------------------------------------------
# lifecycle of the reference mission
# ---------------------------------------------------------------------------------------------------------------
def test_a_new_mission_is_a_draft_and_planning_it_proposes_without_touching_the_simulation():
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft)
    assert mission.status == "draft" and mission.phase == "not designed" and mission.plan is None and not mission.committed
    before = [b.model_dump_json() for b in svc.snapshot().bodies]
    planned = svc.plan_mission(mission.id, MissionPlanRequest())
    assert planned.status == "planned" and planned.phase == "proposed (not committed)" and not planned.committed and planned.planRevision == 1
    assert [b.model_dump_json() for b in svc.snapshot().bodies] == before and svc.snapshot().spaceflight.maneuvers == []
    assert svc.snapshot().simulationTimeS == 0.0
    plan = planned.plan
    assert plan["originBodyId"] == "body-earth" and plan["destinationBodyId"] == "body-moon"
    assert [n["role"] for n in plan["nodes"]] == ["departure", "insertion"]
    trajectory = svc.mission_trajectory(mission.id)
    assert trajectory.planRevision == 1 and len(trajectory.timesS) == len(trajectory.spacecraftM) > 100
    assert trajectory.timesS == sorted(trajectory.timesS) and trajectory.timesS[-1] == pytest.approx(plan["trajectoryEndS"])


def test_the_plan_is_close_to_the_patched_conic_estimate_and_states_the_difference():
    """Circular coplanar Earth-Moon model: the N-body departure delta-v must agree with the two-body estimate to a fraction of a
    percent; the transfer is SHORTER than the two-body time because the Moon's gravity pulls the craft in (so the estimate is
    reported, never used as the prediction)."""
    svc, craft = lunar_setup()
    plan = svc.plan_mission(new_mission(svc, craft).id, MissionPlanRequest()).plan
    r0 = R_EARTH + 300.0e3
    hohmann = o.hohmann(G * M_EARTH, r0, D_MOON)
    assert plan["patchedConic"]["hohmannDepartureDeltaVMPerS"] == pytest.approx(hohmann.dv1, rel=1e-5)
    assert plan["departure"]["deltaVMPerS"] == pytest.approx(hohmann.dv1, rel=2e-3)
    assert 0.6 * hohmann.transfer_time < plan["arrival"]["transferTimeS"] < hohmann.transfer_time
    # arrival: periapsis as requested, speed there consistent with vis-viva about the Moon for the reported excess speed
    arrival = plan["arrival"]
    assert arrival["periapsisAltitudeM"] == pytest.approx(100.0e3, abs=1.0) and arrival["direction"] == "prograde"
    mu_moon = G * M_MOON
    v_inf = arrival["hyperbolicExcessSpeedMPerS"]
    assert arrival["periapsisSpeedMPerS"] == pytest.approx(math.sqrt(v_inf ** 2 + 2.0 * mu_moon / arrival["periapsisRadiusM"]), rel=1e-9)
    # insertion: the vis-viva difference to the circular speed at that radius
    circular = math.sqrt(G * (M_MOON + 15000.0) / arrival["periapsisRadiusM"])
    assert plan["insertion"]["deltaVMPerS"] == pytest.approx(arrival["periapsisSpeedMPerS"] - circular, rel=2e-3)
    assert 600.0 < plan["insertion"]["deltaVMPerS"] < 1000.0 and 3000.0 < plan["departure"]["deltaVMPerS"] < 3250.0
    assert plan["totals"]["feasible"] and plan["totals"]["propellantRequiredKg"] < plan["totals"]["propellantAvailableKg"]
    assert plan["predictedOrbit"]["bound"] and plan["predictedOrbit"]["eccentricity"] < 1e-3


def test_committing_schedules_the_nodes_and_flying_completes_the_mission_on_the_actual_state():
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft)
    planned = svc.plan_mission(mission.id, MissionPlanRequest())
    committed = svc.commit_mission(mission.id)
    assert committed.status == "planned" and committed.phase == "awaiting departure" and committed.committed
    nodes = svc.snapshot().spaceflight.maneuvers
    assert [n.role for n in nodes] == ["departure", "insertion"] and all(n.missionId == mission.id and n.status == "planned" for n in nodes)
    assert nodes[0].referenceBodyId == "body-earth" and nodes[1].referenceBodyId == "body-moon" and nodes[1].progradeMPerS < 0.0
    result, phases = fly(svc, mission.id)
    # the first one-hour step already contains the departure burn
    assert phases == [("in_progress", "coasting to Moon"), ("in_progress", "verifying the orbit"), ("completed", "orbit verified")]
    # the outcome is the ACTUAL orbit about the Moon, recomputed here from the state
    state = svc.snapshot()
    r, v = rel(state, craft, "body-moon")
    el = o.state_to_elements(r, v, G * (M_MOON + craft_of(state, craft).massKg))
    assert el.e < 1e-3 and el.periapsis - R_MOON == pytest.approx(100.0e3, abs=2000.0) and el.apoapsis - R_MOON == pytest.approx(100.0e3, abs=2000.0)
    assert result.outcome["bound"] and result.outcome["verifiedForS"] >= result.outcome["periodS"]
    assert all(c["ok"] for c in result.checks) and [c["id"] for c in result.checks] == ["bound", "clear", "periapsis", "apoapsis", "soi"]
    assert craft_of(state, craft).spacecraft.orbit.referenceBodyId == "body-moon"
    # plan and simulation agree at both nodes within the documented tolerances, by a wide margin
    assert [a["role"] for a in result.agreement] == ["departure", "insertion"] and all(a["ok"] for a in result.agreement)
    assert max(a["positionDifferenceM"] for a in result.agreement) < 1.0 and max(a["velocityDifferenceMPerS"] for a in result.agreement) < 1e-3
    # propellant used is what the plan said
    used = 12000.0 - craft_of(state, craft).spacecraft.propellantKg
    assert used == pytest.approx(planned.plan["totals"]["propellantRequiredKg"], rel=1e-9)


def test_the_outcome_does_not_depend_on_the_step_size_used_to_fly_it():
    finals = []
    for dt in (900.0, 7200.0):
        svc, craft = lunar_setup()
        mission = new_mission(svc, craft)
        svc.plan_mission(mission.id, MissionPlanRequest())
        svc.commit_mission(mission.id)
        result, _ = fly(svc, mission.id, dt=dt, limit=3000)
        assert result.status == "completed"
        svc.step(6.0e5 - svc.snapshot().simulationTimeS)  # the same instant in both flights, a day or more after the insertion
        finals.append((rel(svc.snapshot(), craft, "body-moon")[0], result.agreement[1]["positionDifferenceM"]))
    assert o.norm(o.sub(finals[0][0], finals[1][0])) < 1.0 and max(f[1] for f in finals) < 1.0


def test_reaching_the_moon_without_the_insertion_burn_is_not_a_completed_orbit_mission():
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft)
    svc.plan_mission(mission.id, MissionPlanRequest())
    svc.commit_mission(mission.id)
    insertion = svc.snapshot().spaceflight.maneuvers[1]
    svc.delete_maneuver(insertion.id)  # the spacecraft will still fly past the Moon at 100 km
    state = svc.snapshot()
    failed = state.spaceflight.missions[0]
    assert failed.status == "failed" and "removed" in failed.reasons[0]


def test_an_insertion_burn_that_is_too_small_leaves_the_mission_failed_not_captured():
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft)
    planned = svc.plan_mission(mission.id, MissionPlanRequest())
    svc.commit_mission(mission.id)
    # just before the insertion, take almost all the propellant away: the burn will fall far short
    svc.step(planned.plan["arrival"]["epochS"] - 600.0)
    svc._flight.put(__import__("dataclasses").replace(svc._flight.craft[craft], propellant_kg=50.0))
    result, _ = fly(svc, mission.id, dt=600.0)
    assert result.status == "failed" and "propellant ran out" in result.reasons[0]
    state = svc.snapshot()
    assert craft_of(state, craft).spacecraft.orbit.regime == "escape"  # it flew past: the actual state says so


def test_a_capture_outside_the_tolerance_is_reported_as_the_wrong_orbit():
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft, toleranceM=20.0e3)
    planned = svc.plan_mission(mission.id, MissionPlanRequest())
    svc.commit_mission(mission.id)
    # an extra prograde kick one minute after the insertion raises the apoapsis by far more than the tolerance
    svc.add_maneuver(craft, node(at="epoch", epochS=planned.plan["arrival"]["epochS"] + 60.0, progradeMPerS=120.0, referenceBodyId="body-moon"))
    result, _ = fly(svc, mission.id, dt=600.0, limit=2000)
    assert result.status == "failed" and "not the intended one" in result.reasons[0] or "did not stay" in result.reasons[0]
    failed = {c["id"] for c in result.checks if not c["ok"]}
    assert failed == {"apoapsis"} and result.outcome["bound"]


def test_an_infeasible_plan_says_so_and_flying_it_fails_on_propellant():
    svc, craft = lunar_setup(propellant=4000.0)
    mission = new_mission(svc, craft)
    planned = svc.plan_mission(mission.id, MissionPlanRequest())
    assert planned.status == "planned" and planned.plan["totals"]["feasible"] is False
    assert any("propellant on board does not cover" in r for r in planned.reasons)
    svc.commit_mission(mission.id)
    assert [n.feasible for n in svc.snapshot().spaceflight.maneuvers] == [True, False]  # the departure is covered, the insertion is not
    result, _ = fly(svc, mission.id)
    assert result.status == "failed" and "propellant ran out" in result.reasons[0]


# ---------------------------------------------------------------------------------------------------------------
# variants
# ---------------------------------------------------------------------------------------------------------------
def test_a_retrograde_lunar_orbit_can_be_requested():
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft, direction="retrograde")
    planned = svc.plan_mission(mission.id, MissionPlanRequest())
    assert planned.status == "planned" and planned.plan["arrival"]["direction"] == "retrograde"
    assert planned.plan["arrival"]["inclinationToDestinationOrbitDeg"] == pytest.approx(180.0, abs=0.5)
    svc.commit_mission(mission.id)
    result, _ = fly(svc, mission.id)
    assert result.status == "completed"
    state = svc.snapshot()
    h_craft, h_moon = o.cross(*rel(state, craft, "body-moon")), o.cross(*rel(state, "body-moon", "body-earth"))
    assert o.dot(h_craft, h_moon) < 0.0


def test_an_elliptical_capture_orbit_is_planned_and_verified():
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft, periapsisAltitudeM=200.0e3, apoapsisAltitudeM=5000.0e3)
    planned = svc.plan_mission(mission.id, MissionPlanRequest())
    assert planned.plan["targetOrbit"]["apoapsisAltitudeM"] == pytest.approx(5000.0e3)
    svc.commit_mission(mission.id)
    result, _ = fly(svc, mission.id)
    assert result.status == "completed"
    assert result.outcome["periapsisAltitudeM"] == pytest.approx(200.0e3, abs=20.0e3) and result.outcome["apoapsisAltitudeM"] == pytest.approx(5000.0e3, abs=50.0e3)
    assert result.outcome["eccentricity"] == pytest.approx((5000.0e3 - 200.0e3) / (2 * R_MOON + 5200.0e3), abs=0.01)


def test_a_faster_transfer_costs_more_delta_v_and_arrives_sooner():
    svc, craft = lunar_setup()
    slow = svc.plan_mission(new_mission(svc, craft).id, MissionPlanRequest()).plan
    svc2, craft2 = lunar_setup()
    fast = svc2.plan_mission(new_mission(svc2, craft2).id, MissionPlanRequest(transferTimeS=3.0 * 86400.0)).plan
    assert fast["arrival"]["transferTimeS"] < slow["arrival"]["transferTimeS"] and fast["arrival"]["transferTimeS"] == pytest.approx(3.0 * 86400.0, rel=0.08)
    assert fast["departure"]["deltaVMPerS"] > slow["departure"]["deltaVMPerS"] and fast["insertion"]["deltaVMPerS"] > slow["insertion"]["deltaVMPerS"]


def test_finite_burns_are_planned_with_their_gravity_losses_and_flown_as_planned():
    svc, craft = lunar_setup()
    impulsive = svc.plan_mission(new_mission(svc, craft).id, MissionPlanRequest()).plan
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft)
    planned = svc.plan_mission(mission.id, MissionPlanRequest(burnMode="finite"))
    plan = planned.plan
    assert plan["departure"]["cutoffS"] - plan["departure"]["ignitionS"] > 300.0
    assert plan["departure"]["deltaVMPerS"] > impulsive["departure"]["deltaVMPerS"] + 10.0  # the gravity loss of a 10-minute burn
    assert plan["arrival"]["periapsisAltitudeM"] == pytest.approx(100.0e3, abs=1.0)
    svc.commit_mission(mission.id)
    nodes = svc.snapshot().spaceflight.maneuvers
    assert [n.mode for n in nodes] == ["finite", "finite"] and nodes[0].startS == pytest.approx(plan["departure"]["ignitionS"], abs=1e-6)
    result, phases = fly(svc, mission.id, dt=300.0, limit=4000)
    assert result.status == "completed" and ("in_progress", "departure burn") in phases
    assert max(a["positionDifferenceM"] for a in result.agreement) < 1.0
    assert result.outcome["semiMajorAxisM"] == pytest.approx(plan["predictedOrbit"]["semiMajorAxisM"], abs=50.0)


def test_a_flyby_mission_is_judged_at_the_closest_approach():
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft, type="flyby", periapsisAltitudeM=2000.0e3)
    planned = svc.plan_mission(mission.id, MissionPlanRequest())
    assert planned.plan["insertion"] is None and [n["role"] for n in planned.plan["nodes"]] == ["departure", "observation"]
    svc.commit_mission(mission.id)
    result, phases = fly(svc, mission.id)
    assert result.status == "completed" and result.phase == "flyby completed"
    assert result.outcome["closestApproachAltitudeM"] == pytest.approx(2000.0e3, abs=50.0) and result.outcome["eccentricity"] > 1.0
    assert craft_of(svc.snapshot(), craft).spacecraft.propellantKg == pytest.approx(12000.0 - planned.plan["totals"]["propellantRequiredKg"])


def test_planning_works_from_a_slightly_tilted_parking_orbit_and_reports_a_large_tilt_as_no_solution():
    svc, craft = lunar_setup(inclinationDeg=0.3)
    planned = svc.plan_mission(new_mission(svc, craft).id, MissionPlanRequest())
    assert planned.status == "planned" and planned.plan["parkingOrbit"]["planeMismatchDeg"] == pytest.approx(0.3, abs=1e-6)
    assert planned.plan["arrival"]["inclinationToDestinationOrbitDeg"] > 1.0  # the lunar orbit comes out inclined
    svc, craft = lunar_setup(inclinationDeg=25.0, raanDeg=90.0)
    planned = svc.plan_mission(new_mission(svc, craft).id, MissionPlanRequest())
    assert planned.status == "draft" and planned.phase == "no transfer found" and planned.plan is None
    assert "tilted 25.00 deg" in planned.reasons[0]


# ---------------------------------------------------------------------------------------------------------------
# what is not supported is said, not approximated
# ---------------------------------------------------------------------------------------------------------------
def test_an_interplanetary_destination_is_unsupported_with_the_reason():
    svc = SimulationService()
    sun = svc.add_body(body("Sun", 1.989e30, 6.957e8, kind="star"))
    earth = svc.add_body(body("Earth", M_EARTH, R_EARTH, x=(1.496e11, 0.0, 0.0), v=(0.0, 29780.0, 0.0)))
    mars = svc.add_body(body("Mars", 6.417e23, 3.3895e6, x=(0.0, 2.279e11, 0.0), v=(-24070.0, 0.0, 0.0)))
    craft = add_craft(svc, earth.id, 300.0e3, propellant=20000.0)
    mission = new_mission(svc, craft.id, destination=mars.id)
    planned = svc.plan_mission(mission.id, MissionPlanRequest())
    assert planned.status == "unsupported" and planned.plan is None and "Interplanetary transfers" in planned.reasons[0]
    with pytest.raises(SpaceflightError) as exc:
        svc.commit_mission(mission.id)
    assert exc.value.code == "mission_not_planned"
    after = svc.step(1000.0)
    assert after.spaceflight.missions[0].status == "unsupported"  # it stays what it is


@pytest.mark.parametrize("setup,fragment", [
    (dict(eccentricity=0.2), "near-circular parking orbit"),
    (dict(altitude=2.5e8), "well inside the destination's orbit"),
    (dict(inclinationDeg=180.0), "retrograde with respect to the destination"),
])
def test_unsuitable_parking_orbits_are_unsupported(setup, fragment):
    altitude = setup.pop("altitude", 300.0e3)
    svc, craft = lunar_setup(altitude, **setup)
    planned = svc.plan_mission(new_mission(svc, craft).id, MissionPlanRequest())
    assert planned.status == "unsupported" and fragment in planned.reasons[0]


def test_propulsion_and_pending_nodes_are_preconditions():
    svc, craft = lunar_setup(propellant=0.0)
    assert "no usable propulsion" in svc.plan_mission(new_mission(svc, craft).id, MissionPlanRequest()).reasons[0]
    svc, craft = lunar_setup(thrust=5.0)
    planned = svc.plan_mission(new_mission(svc, craft).id, MissionPlanRequest(burnMode="finite"))
    assert planned.status == "unsupported" and "thrust is too low" in planned.reasons[0]
    svc, craft = lunar_setup()
    svc.add_maneuver(craft, node(at="epoch", epochS=5000.0, progradeMPerS=1.0))
    assert "pending manoeuvre nodes" in svc.plan_mission(new_mission(svc, craft).id, MissionPlanRequest()).reasons[0]
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft, destination="body-earth")
    assert "already orbits" in svc.plan_mission(mission.id, MissionPlanRequest()).reasons[0]


def test_mission_requests_are_validated():
    svc, craft = lunar_setup()
    with pytest.raises(SpaceflightError) as exc:
        new_mission(svc, "craft-none")
    assert exc.value.code == "spacecraft_not_found"
    with pytest.raises(SpaceflightError) as exc:
        new_mission(svc, craft, destination=craft)
    assert exc.value.code == "body_not_found"
    new_mission(svc, craft)
    with pytest.raises(SpaceflightError) as exc:
        new_mission(svc, craft)  # one open mission per spacecraft
    assert exc.value.code == "mission_conflict"
    with pytest.raises(ValueError):
        MissionObjective(periapsisAltitudeM=100.0e3, apoapsisAltitudeM=50.0e3)
    with pytest.raises(ValueError):
        MissionObjective(type="flyby", periapsisAltitudeM=100.0e3, apoapsisAltitudeM=500.0e3)
    with pytest.raises(SpaceflightError):
        svc.plan_mission("msn-404", MissionPlanRequest())


# ---------------------------------------------------------------------------------------------------------------
# staleness, abort, delete
# ---------------------------------------------------------------------------------------------------------------
def test_a_proposed_plan_goes_out_of_date_when_the_universe_or_the_time_moves_on():
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft)
    svc.plan_mission(mission.id, MissionPlanRequest())
    svc.update_spacecraft(craft, SpacecraftUpdate(ispS=440.0))
    with pytest.raises(SpaceflightError) as exc:
        svc.commit_mission(mission.id)
    assert exc.value.code == "mission_not_planned" and "changed after the transfer was designed" in exc.value.detail
    planned = svc.plan_mission(mission.id, MissionPlanRequest())
    assert planned.status == "planned" and planned.planRevision == 2
    svc.step(planned.plan["departure"]["ignitionS"] + 50.0)  # the departure passes uncommitted
    stale = svc.snapshot().spaceflight.missions[0]
    assert stale.status == "draft" and stale.phase == "plan out of date" and "passed the planned departure" in " ".join(stale.reasons)


def test_a_committed_mission_notes_when_the_universe_changed_under_it_but_is_still_judged_on_the_outcome():
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft)
    svc.plan_mission(mission.id, MissionPlanRequest())
    svc.commit_mission(mission.id)
    svc.add_body(body("pebble", 1.0e3, 1.0, x=(0.0, 9.0e8, 0.0)))
    state = svc.step(100.0)
    current = state.spaceflight.missions[0]
    assert current.planStale and "no longer predicts" in current.reasons[0] and current.status == "planned"


def test_aborting_removes_the_pending_nodes_and_deleting_removes_the_mission():
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft)
    svc.plan_mission(mission.id, MissionPlanRequest())
    svc.commit_mission(mission.id)
    with pytest.raises(SpaceflightError) as exc:
        svc.plan_mission(mission.id, MissionPlanRequest())
    assert exc.value.code == "mission_committed"
    aborted = svc.abort_mission(mission.id)
    assert aborted.status == "failed" and aborted.phase == "aborted" and svc.snapshot().spaceflight.maneuvers == []
    with pytest.raises(SpaceflightError) as exc:
        svc.abort_mission(mission.id)
    assert exc.value.code == "mission_over"
    svc.delete_mission(mission.id)
    assert svc.snapshot().spaceflight is None
    again = new_mission(svc, craft)  # the spacecraft is free for a new mission
    assert svc.plan_mission(again.id, MissionPlanRequest()).status == "planned"


def test_missions_and_their_plans_survive_snapshot_restore():
    svc, craft = lunar_setup()
    mission = new_mission(svc, craft)
    svc.plan_mission(mission.id, MissionPlanRequest())
    svc.commit_mission(mission.id)
    snap = svc.capture_snapshot()
    saved = svc.snapshot().model_dump_json()
    result, _ = fly(svc, mission.id)
    assert result.status == "completed"
    svc.restore_snapshot(snap)
    assert svc.snapshot().model_dump_json() == saved and len(svc.mission_trajectory(mission.id).timesS) > 100
    again, _ = fly(svc, mission.id)
    assert again.status == "completed" and again.outcome["semiMajorAxisM"] == pytest.approx(result.outcome["semiMajorAxisM"], abs=1e-3)


def test_the_planner_gives_up_within_its_time_budget():
    svc, craft = lunar_setup()
    svc.plan_time_limit_s = 0.0
    planned = svc.plan_mission(new_mission(svc, craft).id, MissionPlanRequest())
    assert planned.status == "draft" and "time budget" in planned.reasons[0]
