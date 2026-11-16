"""Spacecraft inside the engine: creation, orbit initialisation, unforced motion, manoeuvres, state handling."""
import math

import pytest

from backend.models import BodyUpdate
from backend.simulation import LEGACY_MERGE_CONFIG, ConflictError, SimulationService
from backend.spaceflight import orbits as o
from backend.spaceflight import propulsion
from backend.spaceflight.engine import SpaceflightError
from backend.spaceflight.requests import ManeuverCreate, OrbitSpec, SpacecraftCreate, SpacecraftUpdate, StateSpec
from tests.spaceflight.helpers import (G, M_EARTH, MU_EARTH, R_EARTH, add_craft, body, craft_of, craft_request, earth_moon_service,
                                       earth_service, node, rel)


# ---------------------------------------------------------------------------------------------------------------
# creation and the data model
# ---------------------------------------------------------------------------------------------------------------
def test_a_spacecraft_is_its_own_kind_of_entity_with_a_propulsion_block():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, 400.0e3, dry=1200.0, propellant=800.0, thrust=5000.0, isp=310.0)
    assert craft.id.startswith("craft-") and craft.kind == "spacecraft" and craft.bodyType == "spacecraft"
    assert craft.massKg == 2000.0 and craft.radiusM == 5.0
    sc = craft.spacecraft
    assert (sc.dryMassKg, sc.propellantKg, sc.propellantCapacityKg, sc.thrustN, sc.ispS) == (1200.0, 800.0, 800.0, 5000.0, 310.0)
    assert sc.deltaVRemainingMPerS == pytest.approx(310.0 * 9.80665 * math.log(2000.0 / 1200.0))
    assert sc.massFlowKgPerS == pytest.approx(5000.0 / (310.0 * 9.80665)) and sc.thrusting is False and sc.homeBodyId == earth
    state = svc.snapshot()
    assert [b.kind for b in state.bodies] == ["planet", "spacecraft"]
    assert craft_of(state, earth).spacecraft is None and "spacecraft" not in craft_of(state, earth).model_dump()


def test_the_particle_is_part_of_the_universes_own_rebound_simulation():
    svc, earth = earth_service()
    craft = add_craft(svc, earth)
    assert [p.name for p in svc._sim.particles] == [earth, craft.id] and svc._sim.N == 2
    assert svc._sim.integrator.adaptive_mode.lower() == "prs23"  # a universe with a spacecraft never uses GLOBAL (collapses)


@pytest.mark.parametrize("altitude", [200.0e3, 400.0e3, 35786.0e3])
def test_a_circular_orbit_has_the_analytic_speed_period_and_elements(altitude):
    svc, earth = earth_service()
    craft = add_craft(svc, earth, altitude, dry=500.0, propellant=0.0, thrust=0.0, isp=0.0)
    orbit = craft.spacecraft.orbit
    r = R_EARTH + altitude
    mu = G * (M_EARTH + 500.0)
    assert orbit.referenceBodyId == earth and orbit.regime == "bound"
    assert orbit.radiusM == pytest.approx(r, rel=1e-13) and orbit.altitudeM == pytest.approx(altitude, rel=1e-9)
    assert orbit.speedMPerS == pytest.approx(math.sqrt(mu / r), rel=1e-13)
    assert orbit.periodS == pytest.approx(2.0 * math.pi * math.sqrt(r ** 3 / mu), rel=1e-12)
    assert orbit.eccentricity == pytest.approx(0.0, abs=1e-9) and orbit.semiMajorAxisM == pytest.approx(r, rel=1e-9)
    assert orbit.circularSpeedMPerS == pytest.approx(orbit.speedMPerS, rel=1e-13)
    assert orbit.escapeSpeedMPerS == pytest.approx(math.sqrt(2.0) * orbit.speedMPerS, rel=1e-13)
    assert orbit.sphereOfInfluenceM is None  # a lone Earth has no parent: unbounded


def test_orbital_elements_are_converted_to_the_state_they_describe_about_a_moving_offset_body():
    svc, earth = earth_service(x=(3.0e9, -2.0e9, 1.0e8), v=(1200.0, -700.0, 30.0))
    spec = dict(eccentricity=0.3, inclinationDeg=51.6, raanDeg=80.0, argPeriapsisDeg=40.0, trueAnomalyDeg=110.0)
    craft = add_craft(svc, earth, 700.0e3, **spec)
    mu = G * (M_EARTH + 2000.0)
    a = (R_EARTH + 700.0e3) / (1.0 - 0.3)
    expected = o.elements_to_state(o.Elements(a, 0.3, math.radians(51.6), math.radians(80.0), math.radians(40.0), math.radians(110.0)), mu)
    r, v = rel(svc.snapshot(), craft.id, earth)
    assert r == pytest.approx(expected[0], rel=1e-9, abs=1e-3) and v == pytest.approx(expected[1], rel=1e-9, abs=1e-6)
    orbit = craft.spacecraft.orbit
    assert (orbit.eccentricity, orbit.inclinationDeg, orbit.raanDeg, orbit.argPeriapsisDeg, orbit.trueAnomalyDeg) == pytest.approx(
        (0.3, 51.6, 80.0, 40.0, 110.0), rel=1e-7)
    assert orbit.periapsisAltitudeM == pytest.approx(700.0e3, rel=1e-6)
    assert orbit.apoapsisAltitudeM == pytest.approx(a * 1.3 - R_EARTH, rel=1e-7)


def test_a_semi_major_axis_can_be_given_instead_of_an_altitude_and_a_hyperbola_is_flagged():
    svc, earth = earth_service()
    created, warnings = svc.add_spacecraft(SpacecraftCreate(name="a", dryMassKg=100.0, orbit=OrbitSpec(centralBodyId=earth, semiMajorAxisM=1.0e7, eccentricity=0.2)))
    assert warnings == [] and created.spacecraft.orbit.semiMajorAxisM == pytest.approx(1.0e7, rel=1e-9)
    created, warnings = svc.add_spacecraft(SpacecraftCreate(name="b", dryMassKg=100.0, orbit=OrbitSpec(
        centralBodyId=earth, periapsisAltitudeM=500.0e3, eccentricity=1.4, trueAnomalyDeg=20.0, inclinationDeg=30.0)))
    assert warnings == ["escape_trajectory"] and created.spacecraft.orbit.regime == "escape"
    assert created.spacecraft.orbit.periodS is None and created.spacecraft.orbit.apoapsisRadiusM is None


def test_an_orbit_can_be_placed_in_the_plane_of_another_bodys_orbit():
    svc = earth_moon_service()
    moon = svc._particle("body-moon")
    moon.vz = 90.0  # tilt the Moon's orbit a little so its plane is not the x-y plane
    craft = add_craft(svc, "body-earth", 300.0e3, matchPlaneOfBodyId="body-moon")
    state = svc.snapshot()
    h_craft = o.cross(*rel(state, craft.id, "body-earth"))
    h_moon = o.cross(*rel(state, "body-moon", "body-earth"))
    assert o.plane_angle(h_craft, h_moon) < 1e-12


@pytest.mark.parametrize("orbit,fragment", [
    (dict(periapsisAltitudeM=400.0e3, eccentricity=1.0), "parabolic"),
    (dict(semiMajorAxisM=6.0e6), "not above the surface"),
    (dict(semiMajorAxisM=1.0e7, eccentricity=0.5), "not above the surface"),
    (dict(semiMajorAxisM=1.0e7, eccentricity=1.5), "negative for e > 1"),
    (dict(semiMajorAxisM=-1.0e7, eccentricity=0.5), "positive for e < 1"),
    (dict(periapsisAltitudeM=400.0e3, eccentricity=1.5, trueAnomalyDeg=170.0), "asymptote"),
])
def test_physically_invalid_orbits_are_refused_and_change_nothing(orbit, fragment):
    svc, earth = earth_service()
    revision = svc.revision
    with pytest.raises(SpaceflightError) as exc:
        svc.add_spacecraft(SpacecraftCreate(name="x", dryMassKg=100.0, orbit=OrbitSpec(centralBodyId=earth, **orbit)))
    assert exc.value.code == "orbit_invalid" and exc.value.status == 422 and fragment in exc.value.detail
    assert svc.revision == revision and len(svc.snapshot().bodies) == 1 and svc._sim.N == 1 and not svc._flight.craft


def test_unknown_or_ineligible_central_bodies_are_refused():
    svc, earth = earth_service()
    craft = add_craft(svc, earth)
    for central in ("nope", craft.id):  # a spacecraft is not a body to orbit
        with pytest.raises(SpaceflightError) as exc:
            add_craft(svc, central)
        assert exc.value.code == "body_not_found" and exc.value.status == 404
    with pytest.raises(SpaceflightError):
        add_craft(svc, earth, matchPlaneOfBodyId=earth)


def test_a_state_vector_can_be_given_absolute_or_relative_to_a_body():
    svc, earth = earth_service(x=(1.0e9, 0.0, 0.0), v=(0.0, 500.0, 0.0))
    spec = StateSpec(positionM=dict(x=7.0e6, y=0.0, z=0.0), velocityMPerS=dict(x=0.0, y=7500.0, z=0.0), relativeToBodyId=earth)
    created, _ = svc.add_spacecraft(SpacecraftCreate(name="rel", dryMassKg=10.0, state=spec))
    assert (created.positionM.x, created.velocityMPerS.y) == (1.0e9 + 7.0e6, 8000.0)
    spec = StateSpec(positionM=dict(x=0.0, y=5.0e8, z=0.0), velocityMPerS=dict(x=1.0, y=2.0, z=3.0))
    created, _ = svc.add_spacecraft(SpacecraftCreate(name="abs", dryMassKg=10.0, state=spec))
    assert (created.positionM.y, created.velocityMPerS.z) == (5.0e8, 3.0)
    inside = StateSpec(positionM=dict(x=1.0e9 + 1000.0, y=0.0, z=0.0), velocityMPerS=dict(x=0.0, y=0.0, z=0.0))
    with pytest.raises(ConflictError):  # inside the Earth
        svc.add_spacecraft(SpacecraftCreate(name="in", dryMassKg=10.0, state=inside))


def test_a_spacecraft_cannot_be_created_or_typed_through_the_body_route():
    svc, earth = earth_service()
    with pytest.raises(ValueError):
        body("fake", 1000.0, 5.0, x=(1.0e8, 0, 0), kind="spacecraft")
    with pytest.raises(ValueError):
        body("fake", 1000.0, 5.0, x=(1.0e8, 0, 0), bodyType="spacecraft")
    craft = add_craft(svc, earth)
    for patch in (dict(massKg=5.0), dict(kind="planet"), dict(bodyType="moon"), dict(material=None)):
        with pytest.raises((ConflictError, ValueError)):
            svc.update_body(craft.id, BodyUpdate(**patch))
    renamed = svc.update_body(craft.id, BodyUpdate(name="Renamed", colorHex="#112233"))
    assert renamed.name == "Renamed" and renamed.kind == "spacecraft" and renamed.spacecraft is not None


# ---------------------------------------------------------------------------------------------------------------
# unforced motion
# ---------------------------------------------------------------------------------------------------------------
def test_an_unforced_circular_orbit_keeps_its_radius_and_closes_after_one_period():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, 400.0e3, thrust=0.0, isp=0.0, propellant=0.0)
    period = craft.spacecraft.orbit.periodS
    r0, v0 = rel(svc.snapshot(), craft.id, earth)
    worst = 0.0
    for _ in range(40):  # ten revolutions in quarter-period steps
        state = svc.step(period / 4.0)
        worst = max(worst, abs(craft_of(state, craft.id).spacecraft.orbit.radiusM - (R_EARTH + 400.0e3)))
    r1, v1 = rel(svc.snapshot(), craft.id, earth)
    assert worst < 1e-3  # metres, on a 6.8e6 m radius
    assert o.norm(o.sub(r1, r0)) < 1e-2 and o.norm(o.sub(v1, v0)) < 1e-5
    assert svc.snapshot().simulationTimeS == pytest.approx(10.0 * period, rel=1e-14)


def test_an_unforced_eccentric_orbit_conserves_energy_and_angular_momentum():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, 300.0e3, eccentricity=0.6, inclinationDeg=63.4, argPeriapsisDeg=270.0, thrust=0.0, isp=0.0, propellant=0.0)
    mu = G * (M_EARTH + 1000.0)
    r, v = rel(svc.snapshot(), craft.id, earth)
    e0, h0 = o.specific_energy(mu, r, v), o.cross(r, v)
    for _ in range(30):
        svc.step(1700.0)
    r, v = rel(svc.snapshot(), craft.id, earth)
    assert o.specific_energy(mu, r, v) == pytest.approx(e0, rel=1e-12)
    assert o.norm(o.sub(o.cross(r, v), h0)) < 1e-12 * o.norm(h0)


def test_the_result_does_not_depend_on_how_the_time_is_cut_into_steps():
    def fly(steps):
        svc, earth = earth_service()
        craft = SimulationService.add_spacecraft(svc, craft_request(earth, 500.0e3, eccentricity=0.1))[0]
        for _ in range(steps):
            svc.step(20000.0 / steps)
        return rel(svc.snapshot(), craft.id, earth)
    one, many = fly(1), fly(97)
    assert o.norm(o.sub(one[0], many[0])) < 1e-3 and o.norm(o.sub(one[1], many[1])) < 1e-6


def test_a_spacecraft_feels_every_body_not_only_the_one_it_orbits():
    svc = earth_moon_service()
    craft = add_craft(svc, "body-earth", 1.5e8)  # a high orbit: the Moon's pull is not negligible there
    mu = G * (M_EARTH + 2000.0)
    r, v = rel(svc.snapshot(), craft.id, "body-earth")
    energy = o.specific_energy(mu, r, v)
    svc.step(5.0e5)
    r, v = rel(svc.snapshot(), craft.id, "body-earth")
    assert abs(o.specific_energy(mu, r, v) / energy - 1.0) > 1e-4  # two-body energy about Earth is NOT conserved: the Moon acts


# ---------------------------------------------------------------------------------------------------------------
# impulsive manoeuvres
# ---------------------------------------------------------------------------------------------------------------
def test_a_prograde_impulse_now_changes_the_velocity_the_mass_and_the_orbit_at_once():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, 400.0e3, dry=1000.0, propellant=1000.0, isp=320.0)
    r0, v0 = rel(svc.snapshot(), craft.id, earth)
    out = svc.add_maneuver(craft.id, node(at="now", progradeMPerS=150.0, label="raise"))
    assert out.status == "executed" and out.deliveredDeltaVMPerS == pytest.approx(150.0, rel=1e-12) and out.failure is None
    state = svc.snapshot()
    r1, v1 = rel(state, craft.id, earth)
    assert r1 == pytest.approx(r0) and o.sub(v1, v0) == pytest.approx(o.scale(o.unit(v0), 150.0), abs=1e-9)
    after = craft_of(state, craft.id)
    m1 = 2000.0 * math.exp(-150.0 / (320.0 * 9.80665))
    assert after.massKg == pytest.approx(m1, rel=1e-13) and after.spacecraft.propellantKg == pytest.approx(m1 - 1000.0, rel=1e-12)
    assert out.propellantUsedKg == pytest.approx(2000.0 - m1, rel=1e-12)
    # the new apoapsis is the one vis-viva gives for the new speed at the same radius
    mu, r = G * (M_EARTH + m1), R_EARTH + 400.0e3
    a = 1.0 / (2.0 / r - o.dot(v1, v1) / mu)
    assert after.spacecraft.orbit.apoapsisRadiusM == pytest.approx(2.0 * a - r, rel=1e-9)
    assert after.spacecraft.orbit.periapsisRadiusM == pytest.approx(r, rel=1e-9)
    events = svc.events()
    assert [e.type for e in events] == ["maneuver"] and events[0].phase == "impulse" and events[0].bodyIds == [craft.id]
    assert events[0].deliveredDeltaVMPerS == pytest.approx(150.0)


@pytest.mark.parametrize("components,expected", [
    (dict(progradeMPerS=-40.0), (0.0, -40.0, 0.0)), (dict(radialMPerS=25.0), (25.0, 0.0, 0.0)), (dict(radialMPerS=-25.0), (-25.0, 0.0, 0.0)),
    (dict(normalMPerS=30.0), (0.0, 0.0, 30.0)), (dict(normalMPerS=-30.0), (0.0, 0.0, -30.0)),
    (dict(progradeMPerS=3.0, normalMPerS=4.0, radialMPerS=12.0), (12.0, 3.0, 4.0)),
])
def test_retrograde_radial_and_normal_burns_act_along_their_axes(components, expected):
    svc, earth = earth_service()
    craft = add_craft(svc, earth)  # at x = +r moving along +y: prograde = +y, normal = +z, radial-out = +x
    _, v0 = rel(svc.snapshot(), craft.id, earth)
    svc.add_maneuver(craft.id, node(at="now", **components))
    _, v1 = rel(svc.snapshot(), craft.id, earth)
    assert o.sub(v1, v0) == pytest.approx(expected, abs=1e-9)


def test_an_inertial_frame_impulse_is_applied_as_given():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, inclinationDeg=40.0, trueAnomalyDeg=75.0)
    _, v0 = rel(svc.snapshot(), craft.id, earth)
    out = svc.add_maneuver(craft.id, node(at="now", frame="inertial", deltaVMPerS=dict(x=5.0, y=-7.0, z=11.0)))
    _, v1 = rel(svc.snapshot(), craft.id, earth)
    assert o.sub(v1, v0) == pytest.approx((5.0, -7.0, 11.0), abs=1e-9) and out.referenceBodyId is None and out.frame == "inertial"


def test_a_scheduled_impulse_executes_exactly_at_its_epoch_inside_a_step():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, 400.0e3)
    period = craft.spacecraft.orbit.periodS
    out = svc.add_maneuver(craft.id, node(at="epoch", epochS=0.37 * period, progradeMPerS=80.0))
    assert out.status == "planned" and out.startS == out.endS == pytest.approx(0.37 * period)
    assert svc.snapshot().spaceflight.maneuvers[0].status == "planned"
    step = svc.step(period)  # the node lies inside this one step
    assert [e.type for e in step.events] == ["maneuver"] and step.events[0].simulationTimeS == pytest.approx(0.37 * period, rel=1e-13)
    done = step.spaceflight.maneuvers[0]
    assert done.status == "executed" and done.startedAtS == pytest.approx(0.37 * period, rel=1e-13) and step.advancedS == pytest.approx(period)
    # reference: the same universe flown by hand with the engine stopped at the epoch
    ref, earth2 = earth_service()
    craft2 = SimulationService.add_spacecraft(ref, craft_request(earth2, 400.0e3))[0]
    ref.step(0.37 * period)
    ref.add_maneuver(craft2.id, node(at="now", progradeMPerS=80.0))
    ref.step(period - 0.37 * period)
    a, b = rel(svc.snapshot(), craft.id, earth), rel(ref.snapshot(), craft2.id, earth2)
    assert o.norm(o.sub(a[0], b[0])) < 1e-4 and o.norm(o.sub(a[1], b[1])) < 1e-7


def test_a_hohmann_pair_of_burns_at_the_apsides_gives_the_target_circular_orbit():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, 300.0e3, dry=1000.0, propellant=4000.0, isp=450.0)
    r1, r2 = R_EARTH + 300.0e3, R_EARTH + 20000.0e3
    h = o.hohmann(MU_EARTH, r1, r2)
    svc.add_maneuver(craft.id, node(at="now", progradeMPerS=h.dv1))
    second = svc.add_maneuver(craft.id, node(at="apoapsis", progradeMPerS=h.dv2))
    assert second.epochS == pytest.approx(h.transfer_time, rel=1e-3)
    svc.step(second.epochS + 100.0)
    orbit = craft_of(svc.snapshot(), craft.id).spacecraft.orbit
    assert orbit.semiMajorAxisM == pytest.approx(r2, rel=2e-4) and orbit.eccentricity < 5e-4  # craft mass in mu shifts it slightly


def test_a_node_at_the_next_periapsis_is_timed_from_the_orbit():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, 300.0e3, eccentricity=0.4, trueAnomalyDeg=180.0)
    out = svc.add_maneuver(craft.id, node(at="periapsis", progradeMPerS=-10.0))
    assert out.epochS == pytest.approx(0.5 * craft.spacecraft.orbit.periodS, rel=1e-9)
    svc.step(out.epochS)
    assert svc.snapshot().spaceflight.maneuvers[0].status == "executed"
    assert craft_of(svc.snapshot(), craft.id).spacecraft.orbit.altitudeM == pytest.approx(300.0e3, rel=1e-6)


# ---------------------------------------------------------------------------------------------------------------
# finite burns
# ---------------------------------------------------------------------------------------------------------------
def test_a_finite_burn_in_free_space_delivers_exactly_the_rocket_equation():
    """A lone spacecraft (no gravity): the velocity gained along a fixed direction is v_e ln(m0 / m1) and the distance travelled is
    the closed form of integrating that twice."""
    svc = SimulationService()
    state = StateSpec(positionM=dict(x=0.0, y=0.0, z=0.0), velocityMPerS=dict(x=0.0, y=0.0, z=0.0))
    created, _ = svc.add_spacecraft(SpacecraftCreate(name="tug", dryMassKg=1000.0, propellantKg=3000.0, thrustN=20000.0, ispS=300.0, state=state))
    out = svc.add_maneuver(created.id, node(at="now", mode="finite", frame="inertial", deltaVMPerS=dict(x=0.0, y=2000.0, z=0.0)))
    ve, flow = 300.0 * 9.80665, 20000.0 / (300.0 * 9.80665)
    m1 = 4000.0 * math.exp(-2000.0 / ve)
    duration = (4000.0 - m1) / flow
    assert out.status == "planned" and out.endS - out.startS == pytest.approx(duration, rel=1e-13)
    mid = svc.step(0.5 * duration)
    assert [e.phase for e in mid.events] == ["ignition"] and craft_of(mid, created.id).spacecraft.thrusting
    assert craft_of(mid, created.id).massKg == pytest.approx(4000.0 - flow * 0.5 * duration, rel=1e-13)
    end = svc.step(duration)  # past the cutoff: coasts for the rest
    craft = craft_of(end, created.id)
    assert [e.phase for e in end.events] == ["cutoff"] and not craft.spacecraft.thrusting
    assert craft.velocityMPerS.y == pytest.approx(2000.0, rel=1e-12) and craft.velocityMPerS.x == 0.0
    assert craft.massKg == pytest.approx(m1, rel=1e-13)
    # distance at cutoff: ve [ (m1/mdot)(ln(m1/m0)) + t ] ... written as the integral of v(t) = -ve ln(1 - mdot t / m0)
    tau = 4000.0 / flow
    burn_distance = ve * ((tau - duration) * math.log(1.0 - duration / tau) + duration)
    assert craft.positionM.y == pytest.approx(burn_distance + 2000.0 * 0.5 * duration, rel=1e-11)
    done = end.spaceflight.maneuvers[0]
    assert done.status == "executed" and done.deliveredDeltaVMPerS == pytest.approx(2000.0, rel=1e-12)
    assert done.propellantUsedKg == pytest.approx(4000.0 - m1, rel=1e-12)


def test_a_finite_burn_that_exhausts_the_propellant_stops_there_and_says_so():
    svc = SimulationService()
    state = StateSpec(positionM=dict(x=0.0, y=0.0, z=0.0), velocityMPerS=dict(x=0.0, y=0.0, z=0.0))
    created, _ = svc.add_spacecraft(SpacecraftCreate(name="tug", dryMassKg=1000.0, propellantKg=100.0, thrustN=5000.0, ispS=300.0, state=state))
    out = svc.add_maneuver(created.id, node(at="now", mode="finite", frame="inertial", deltaVMPerS=dict(x=900.0, y=0.0, z=0.0)))
    assert out.feasible is False
    end = svc.step(out.endS + 10.0)
    capacity = 300.0 * 9.80665 * math.log(1100.0 / 1000.0)
    craft, done = craft_of(end, created.id), end.spaceflight.maneuvers[0]
    assert craft.spacecraft.propellantKg == pytest.approx(0.0, abs=1e-9) and craft.massKg == pytest.approx(1000.0)
    assert craft.velocityMPerS.x == pytest.approx(capacity, rel=1e-12)
    assert done.status == "executed" and done.deliveredDeltaVMPerS == pytest.approx(capacity, rel=1e-12) and "propellant ran out" in done.failure


def test_an_impulse_beyond_the_propellant_delivers_what_there_is():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, dry=1000.0, propellant=50.0, isp=300.0)
    out = svc.add_maneuver(craft.id, node(at="now", progradeMPerS=1000.0))
    capacity = 300.0 * 9.80665 * math.log(1050.0 / 1000.0)
    assert out.deliveredDeltaVMPerS == pytest.approx(capacity) and "propellant ran out" in out.failure and out.status == "executed"
    assert craft_of(svc.snapshot(), craft.id).spacecraft.propellantKg == pytest.approx(0.0, abs=1e-9)
    again = svc.add_maneuver(craft.id, node(at="now", progradeMPerS=10.0))
    assert again.status == "failed" and again.failure == "no propellant on board"


def test_a_centred_finite_burn_approaches_the_impulsive_result_and_tracks_prograde():
    def apoapsis(mode, thrust):
        svc, earth = earth_service()
        craft = SimulationService.add_spacecraft(svc, craft_request(earth, 400.0e3, dry=1000.0, propellant=1000.0, thrust=thrust, isp=320.0))[0]
        svc.add_maneuver(craft.id, node(at="epoch", epochS=1500.0, mode=mode, progradeMPerS=200.0))
        svc.step(4000.0)
        return craft_of(svc.snapshot(), craft.id).spacecraft.orbit.apoapsisAltitudeM
    impulsive = apoapsis("impulsive", 1.0)
    strong, weak = apoapsis("finite", 400000.0), apoapsis("finite", 4000.0)
    assert abs(strong - impulsive) < 50.0  # a 1 s burn is an impulse to within tens of metres of apoapsis
    assert abs(weak - impulsive) < 5000.0 and abs(weak - impulsive) > abs(strong - impulsive)  # 100 s: small but real difference


def test_finite_burn_windows_are_validated_before_anything_changes():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, dry=1000.0, propellant=1000.0, thrust=1000.0, isp=320.0)
    with pytest.raises(SpaceflightError) as exc:  # a centred 5-minute burn at t = 10 s would have to start in the past
        svc.add_maneuver(craft.id, node(at="epoch", epochS=10.0, mode="finite", progradeMPerS=200.0))
    assert exc.value.code == "maneuver_in_past"
    first = svc.add_maneuver(craft.id, node(at="epoch", epochS=2000.0, mode="finite", progradeMPerS=200.0))
    with pytest.raises(SpaceflightError) as exc:
        svc.add_maneuver(craft.id, node(at="epoch", epochS=first.endS - 1.0, mode="finite", progradeMPerS=5.0, centered=False))
    assert exc.value.code == "maneuver_overlap"
    assert [m.id for m in svc.snapshot().spaceflight.maneuvers] == [first.id]


@pytest.mark.parametrize("kwargs,code", [
    (dict(at="now"), "maneuver_invalid"),
    (dict(at="epoch", epochS=-5.0, progradeMPerS=1.0), "maneuver_in_past"),
    (dict(at="now", progradeMPerS=1.0, referenceBodyId="nope"), "body_not_found"),
    (dict(at="apoapsis", progradeMPerS=1.0), "maneuver_invalid"),
])
def test_invalid_nodes_are_refused(kwargs, code):
    svc, earth = earth_service()
    created, _ = svc.add_spacecraft(SpacecraftCreate(name="b", dryMassKg=100.0, propellantKg=50.0, ispS=300.0, thrustN=10.0, orbit=OrbitSpec(
        centralBodyId=earth, periapsisAltitudeM=500.0e3, eccentricity=1.4)))
    with pytest.raises(SpaceflightError) as exc:
        svc.add_maneuver(created.id, node(**kwargs))
    assert exc.value.code == code


def test_a_spacecraft_without_an_engine_cannot_manoeuvre():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, thrust=0.0, isp=0.0, propellant=0.0)
    with pytest.raises(SpaceflightError) as exc:
        svc.add_maneuver(craft.id, node(at="now", progradeMPerS=1.0))
    assert exc.value.code == "no_propulsion"
    craft = add_craft(svc, earth, 900.0e3, thrust=0.0, isp=300.0)
    with pytest.raises(SpaceflightError):
        svc.add_maneuver(craft.id, node(at="now", mode="finite", progradeMPerS=1.0))


def test_a_manoeuvre_preview_predicts_the_executed_orbit_and_changes_nothing():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, 400.0e3)
    before = svc.snapshot().model_dump_json()
    preview = svc.preview_maneuver(craft.id, node(at="now", progradeMPerS=120.0))
    assert svc.snapshot().model_dump_json() == before and svc.snapshot().spaceflight is None
    svc.add_maneuver(craft.id, node(at="now", progradeMPerS=120.0))
    orbit = craft_of(svc.snapshot(), craft.id).spacecraft.orbit
    assert preview.after.apoapsisAltitudeM == pytest.approx(orbit.apoapsisAltitudeM, rel=1e-9)
    assert preview.before.eccentricity == pytest.approx(0.0, abs=1e-8) and preview.feasible and preview.basis == "present state"
    later = svc.preview_maneuver(craft.id, node(at="apoapsis", progradeMPerS=50.0))
    assert "two-body" in later.basis and later.before.trueAnomalyDeg == pytest.approx(180.0, abs=1e-6)


# ---------------------------------------------------------------------------------------------------------------
# the book follows the engine's state handling
# ---------------------------------------------------------------------------------------------------------------
def test_editing_propulsion_updates_the_mass_and_is_blocked_while_burning():
    svc, earth = earth_service()
    craft = add_craft(svc, earth, dry=1000.0, propellant=1000.0, thrust=1000.0)
    updated = svc.update_spacecraft(craft.id, SpacecraftUpdate(propellantKg=3000.0, ispS=450.0))
    assert updated.massKg == 4000.0 and updated.spacecraft.propellantCapacityKg == 3000.0 and updated.spacecraft.ispS == 450.0
    svc.add_maneuver(craft.id, node(at="now", mode="finite", progradeMPerS=300.0))
    svc.step(5.0)
    with pytest.raises(SpaceflightError) as exc:
        svc.update_spacecraft(craft.id, SpacecraftUpdate(thrustN=5.0))
    assert exc.value.code == "burn_in_progress"
    with pytest.raises(SpaceflightError):
        svc.update_spacecraft("craft-missing", SpacecraftUpdate(thrustN=5.0))


def test_a_failed_step_rolls_the_spaceflight_state_back(monkeypatch):
    svc, earth = earth_service()
    craft = add_craft(svc, earth)
    svc.add_maneuver(craft.id, node(at="epoch", epochS=100.0, progradeMPerS=50.0))
    before = svc.snapshot().model_dump_json()
    real = svc._verify_finite

    def boom():
        raise ArithmeticError("injected")
    monkeypatch.setattr(svc, "_verify_finite", boom)
    with pytest.raises(Exception):
        svc.step(500.0)  # the burn executed inside the step, then the step failed
    monkeypatch.setattr(svc, "_verify_finite", real)
    assert svc.snapshot().model_dump_json() == before and svc._flight.maneuvers[next(iter(svc._flight.maneuvers))].status == "planned"
    assert craft_of(svc.snapshot(), craft.id).spacecraft.propellantKg == 1000.0 and svc._particle(craft.id).m == 2000.0
    step = svc.step(500.0)
    assert [e.id for e in step.events] == ["burn-1"]  # the id of the rolled-back event was never seen, so it is used now


def test_snapshots_and_reset_carry_spacecraft_nodes_and_propellant():
    svc = earth_moon_service()
    craft = add_craft(svc, "body-earth", 300.0e3)
    svc.add_maneuver(craft.id, node(at="epoch", epochS=500.0, progradeMPerS=30.0))
    snap = svc.capture_snapshot()
    saved = svc.snapshot().model_dump_json()
    svc.step(1000.0)
    assert svc.snapshot().spaceflight.maneuvers[0].status == "executed" and svc.snapshot().model_dump_json() != saved
    svc.restore_snapshot(snap)
    assert svc.snapshot().model_dump_json() == saved
    again = svc.step(1000.0)
    assert again.spaceflight.maneuvers[0].status == "executed"  # the restored node executes again
    svc.reset()
    state = svc.snapshot()
    assert [b.id for b in state.bodies] == ["body-earth", "body-moon"] and state.spaceflight is None and not svc._flight.craft


def test_the_state_digest_includes_the_propulsion_state_only_for_spacecraft():
    plain, _ = earth_service()
    digest = plain.capture_snapshot().digest
    other, _ = earth_service()
    other._meta = dict(zip(plain._meta, other._meta.values()))  # same ids are needed for equal digests; ids are random
    svc, earth = earth_service()
    craft = add_craft(svc, earth)
    with_craft = svc.capture_snapshot().digest
    svc.update_spacecraft(craft.id, SpacecraftUpdate(ispS=321.0))
    assert svc.capture_snapshot().digest != with_craft and digest != with_craft


def test_deleting_a_spacecraft_or_a_reference_body_cleans_up():
    svc = earth_moon_service()
    craft = add_craft(svc, "body-earth", 300.0e3)
    svc.add_maneuver(craft.id, node(at="epoch", epochS=900.0, progradeMPerS=30.0))
    svc.delete_body(craft.id)
    state = svc.snapshot()
    assert craft.id not in [b.id for b in state.bodies] and not svc._flight.craft
    assert state.spaceflight.maneuvers[0].status == "failed" and "removed" in state.spaceflight.maneuvers[0].failure
    svc.delete_maneuver(state.spaceflight.maneuvers[0].id)
    assert svc.snapshot().spaceflight is None
    craft = add_craft(svc, "body-earth", 300.0e3)
    svc.add_maneuver(craft.id, node(at="epoch", epochS=900.0, progradeMPerS=30.0, referenceBodyId="body-moon"))
    svc.delete_body("body-moon")
    assert svc.snapshot().spaceflight.maneuvers[0].failure == "the reference body was removed"
    svc.step(1200.0)  # nothing is executed, nothing breaks
    assert craft_of(svc.snapshot(), craft.id).spacecraft.propellantKg == 1000.0


def test_a_legacy_preset_universe_without_spacecraft_is_untouched_by_all_this():
    svc = SimulationService(LEGACY_MERGE_CONFIG)
    svc.add_body(body("a", 1.0e22, 1.0e5))
    svc.add_body(body("b", 1.0e22, 1.0e5, x=(1.0e6, 0.0, 0.0), v=(-1.0e4, 0.0, 0.0)))
    step = svc.step(150.0)
    dumped = step.model_dump()
    assert [e.type for e in step.events] == ["merger"] and "spaceflight" not in dumped and "halt" not in dumped and "warnings" not in dumped
    assert svc._sim.integrator.adaptive_mode.lower() == "global"
