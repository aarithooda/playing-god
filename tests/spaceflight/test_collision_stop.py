"""The collision policy of this phase: a contact stops the simulation, is reported, and leaves a consistent state.

It applies to every contact of a spacecraft (in every collision mode) and to every contact in a "stop-on-contact" universe. Other
universes keep their own collision handling for body-body contacts.
"""
import math

import pytest

from backend.models import BodyUpdate
from backend.simulation import LEGACY_MERGE_CONFIG, STOP_ON_CONTACT_CONFIG, SimulationService
from backend.spaceflight import orbits as o
from backend.spaceflight.engine import SpaceflightError
from tests.spaceflight.helpers import M_EARTH, R_EARTH, add_craft, body, craft_of, earth_moon_service, earth_service, node, rel


def crash(config=None):
    """A spacecraft on an orbit whose periapsis is below the surface: it hits the Earth within half a revolution."""
    svc, earth = earth_service(config)
    craft = add_craft(svc, earth, 400.0e3)
    svc.add_maneuver(craft.id, node(at="now", progradeMPerS=-300.0))  # periapsis far below the surface
    assert craft_of(svc.snapshot(), craft.id).spacecraft.orbit.regime == "suborbital"
    return svc, earth, craft.id


@pytest.mark.parametrize("config", [None, LEGACY_MERGE_CONFIG, STOP_ON_CONTACT_CONFIG], ids=["outcome-v1", "legacy-merge", "stop-on-contact"])
def test_a_spacecraft_impact_stops_the_simulation_at_the_contact_in_every_mode(config):
    svc, earth, craft = crash(config)
    step = svc.step(6000.0)
    assert step.warnings == ["collision_stopped"] and step.advancedS < 6000.0
    contacts = [e for e in step.events if e.type == "contact"]
    assert len(contacts) == 1 and contacts[0].bodyIds == [craft, earth] and contacts[0].involvesSpacecraft and contacts[0].refined
    # consistent state: both bodies still exist, untouched, and the spacecraft is AT the surface (centre distance = sum of radii)
    assert [b.id for b in step.bodies] == [earth, craft] and craft_of(step, earth).massKg == M_EARTH
    r, v = rel(step, craft, earth)
    assert o.norm(r) == pytest.approx(R_EARTH + 5.0, rel=1e-8)
    assert o.dot(r, v) < 0.0  # still moving inwards: nothing bounced
    assert contacts[0].relativeSpeedMPerS == pytest.approx(o.norm(v), rel=1e-12) and 7000.0 < o.norm(v) < 8200.0
    halt = step.halt
    assert halt.bodyIds == [craft, earth] and halt.simulationTimeS == step.simulationTimeS == contacts[0].simulationTimeS
    assert "collided" in halt.message and halt.refined
    assert svc.snapshot().halt == halt and svc.events()[-1].type == "contact"


def test_the_contact_time_agrees_with_the_two_body_time_of_reaching_the_surface():
    svc, earth, craft = crash(STOP_ON_CONTACT_CONFIG)
    r, v = rel(svc.snapshot(), craft, earth)
    mu = 6.67430e-11 * (M_EARTH + craft_of(svc.snapshot(), craft).massKg)
    el = o.state_to_elements(r, v, mu)
    # true anomaly at which the osculating ellipse reaches the contact radius, on the way down
    cos_nu = (el.semi_latus_rectum / (R_EARTH + 5.0) - 1.0) / el.e
    expected = o.time_to_true_anomaly(el, mu, 2.0 * math.pi - math.acos(cos_nu))
    step = svc.step(6000.0)
    assert step.simulationTimeS == pytest.approx(expected, rel=1e-7)


def test_a_halted_simulation_refuses_to_step_until_the_contact_is_removed():
    svc, earth, craft = crash()
    halted = svc.step(6000.0)
    revision, dumped = svc.revision, svc.snapshot().model_dump_json()
    for _ in range(2):
        with pytest.raises(SpaceflightError) as exc:
            svc.step(10.0)
        assert exc.value.code == "simulation_halted" and exc.value.status == 409
    assert svc.revision == revision and svc.snapshot().model_dump_json() == dumped  # refused: nothing moved
    with pytest.raises(SpaceflightError):
        svc.add_maneuver(craft, node(at="now", progradeMPerS=1.0))
    svc.delete_body(craft)  # removing one of the two bodies clears the halt
    assert svc.snapshot().halt is None
    assert svc.step(10.0).simulationTimeS == pytest.approx(halted.simulationTimeS + 10.0)


def test_moving_the_spacecraft_away_clears_the_halt_and_leaving_it_in_place_stops_again():
    svc, earth, craft = crash()
    first = svc.step(6000.0)
    c = craft_of(first, craft)
    svc.update_body(craft, BodyUpdate(velocityMPerS=dict(x=c.velocityMPerS.x, y=c.velocityMPerS.y, z=c.velocityMPerS.z)))  # an edit, still touching
    assert svc.snapshot().halt is None
    again = svc.step(100.0)
    assert again.warnings == ["collision_stopped"] and again.halt is not None and again.advancedS == 0.0  # stopped where it was
    assert again.simulationTimeS == first.simulationTimeS and [e.type for e in again.events] == ["contact"]
    r, _ = rel(again, craft, earth)
    assert o.norm(r) == pytest.approx(R_EARTH + 5.0, rel=1e-8)
    svc.update_body(craft, BodyUpdate(positionM=dict(x=0.0, y=0.0, z=R_EARTH + 400.0e3), velocityMPerS=dict(x=7668.0, y=0.0, z=0.0)))
    assert svc.snapshot().halt is None and svc.step(600.0).advancedS == pytest.approx(600.0)


def test_reset_and_restore_return_to_a_state_without_the_halt():
    svc, earth, craft = crash()
    snap = svc.capture_snapshot()
    svc.step(6000.0)
    assert svc.snapshot().halt is not None
    svc.restore_snapshot(snap)
    assert svc.snapshot().halt is None and svc.step(60.0).advancedS == pytest.approx(60.0)
    svc.step(6000.0)
    assert svc.snapshot().halt is not None
    svc.reset()
    assert svc.snapshot().halt is None and svc.snapshot().bodies == []


def test_two_bodies_colliding_in_a_stop_on_contact_universe_are_stopped_not_merged():
    svc = SimulationService(STOP_ON_CONTACT_CONFIG)
    a = svc.add_body(body("a", 1.0e22, 1.0e5))
    b = svc.add_body(body("b", 1.0e22, 1.0e5, x=(1.0e6, 0.0, 0.0), v=(-1.0e4, 0.0, 0.0)))
    step = svc.step(150.0)
    assert [e.type for e in step.events] == ["contact"] and step.warnings == ["collision_stopped"]
    assert step.events[0].involvesSpacecraft is False and sorted(step.events[0].bodyIds) == sorted([a.id, b.id])
    assert len(step.bodies) == 2 and all(x.massKg == 1.0e22 for x in step.bodies)
    r, _ = rel(step, b.id, a.id)
    assert o.norm(r) == pytest.approx(2.0e5, rel=1e-8)
    assert 75.0 < step.simulationTimeS < 80.0  # 8.0e5 m gap at 1.0e4 m/s, a little sooner because they attract each other
    assert svc.collision_records() == [] and step.diagnostics.totalMassKg == 2.0e22
    with pytest.raises(SpaceflightError):
        svc.step(1.0)


def test_body_body_contacts_keep_their_own_handling_in_other_universes_even_with_a_spacecraft_present():
    for config, kind in ((LEGACY_MERGE_CONFIG, "merger"), (None, "merger")):
        svc, earth = earth_service(config)
        add_craft(svc, earth, 2.0e7)  # far away, never involved
        svc.add_body(body("rock", 1.0e20, 1.0e5, x=(R_EARTH + 2.0e6, 0.0, 0.0), v=(-3.0e3, 0.0, 0.0)))
        step = svc.step(2000.0)
        assert [e.type for e in step.events] == [kind] and step.halt is None and len(step.bodies) == 2
        assert "collision_stopped" not in step.warnings


def test_a_spacecraft_passing_close_but_above_the_surface_does_not_stop_anything():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, 400.0e3)
    svc.add_maneuver(craft.id, node(at="now", progradeMPerS=-80.0))  # periapsis about 120 km: low, but an orbit
    orbit = craft_of(svc.snapshot(), craft.id).spacecraft.orbit
    assert orbit.regime == "bound" and 5.0e4 < orbit.periapsisAltitudeM < 2.0e5
    for _ in range(6):
        step = svc.step(3000.0)
        assert step.halt is None and step.events == []


def test_a_spacecraft_hitting_the_moon_in_a_mission_universe_fails_its_mission_and_stops():
    from backend.spaceflight.requests import MissionCreate, MissionObjective

    svc = earth_moon_service()
    craft = add_craft(svc, "body-earth", 300.0e3, dry=1000.0, propellant=20000.0, isp=450.0, thrust=1.0e5)
    mission = svc.create_mission(MissionCreate(name="m", spacecraftId=craft.id, destinationBodyId="body-moon",
                                               objective=MissionObjective(periapsisAltitudeM=100.0e3)))
    planned = svc.plan_mission(mission.id, __import__("backend.spaceflight.requests", fromlist=["MissionPlanRequest"]).MissionPlanRequest())
    assert planned.status == "planned"
    svc.commit_mission(mission.id)
    # sabotage the insertion: a huge retrograde burn right after arrival drops the periapsis into the Moon
    arrival = planned.plan["arrival"]["epochS"]
    svc.add_maneuver(craft.id, node(at="epoch", epochS=arrival + 600.0, progradeMPerS=-900.0, referenceBodyId="body-moon"))
    step = None
    for _ in range(400):
        step = svc.step(3600.0)
        if step.halt is not None:
            break
    assert step.halt is not None and step.halt.bodyIds == [craft.id, "body-moon"]
    mission = step.spaceflight.missions[0]
    assert mission.status == "failed" and "collided with body-moon" in mission.reasons[0]
