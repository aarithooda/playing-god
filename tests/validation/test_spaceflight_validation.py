"""Scientific validation of Space Mission Design: the engine's spacecraft dynamics and the mission planner against INDEPENDENT
analytic values and an independent numerical integration. Nothing here calls backend/spaceflight/orbits.py for its expectations.

Tolerances are stated with their reason (the method used: REBOUND IAS15, a 15th-order adaptive integrator whose error is at
round-off level per orbit; `line` collision detection; rocket-equation mass). Measured values are printed with `pytest -s` and
recorded in docs/SPACE_MISSION_DESIGN.md.
"""
import math

import pytest

from backend.api_universes import create_preset_universe
from backend.simulation import STOP_ON_CONTACT_CONFIG, InitialBody, SimulationService
from backend.spaceflight.requests import ManeuverCreate, MissionCreate, MissionObjective, MissionPlanRequest, OrbitSpec, SpacecraftCreate
from tests.validation import kepler_reference as kepler

G = 6.67430e-11
GM_EARTH = 3.98600435507e14  # m^3/s^2, JPL DE440 (the preset's own source value)
GM_MOON = 4.902800118e12
R_EARTH = 6371008.4  # m, the preset's mean radius
R_MOON = 1737400.0
G0 = 9.80665


def norm(v):
    return math.sqrt(sum(c * c for c in v))


def vec(p):
    return (p.x, p.y, p.z)


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def body_of(state, body_id):
    return next(b for b in state.bodies if b.id == body_id)


def relative(state, a, b):
    pa, pb = body_of(state, a), body_of(state, b)
    return sub(vec(pa.positionM), vec(pb.positionM)), sub(vec(pa.velocityMPerS), vec(pb.velocityMPerS))


def lone_earth():
    svc = SimulationService(STOP_ON_CONTACT_CONFIG)
    svc.load_bodies([InitialBody(id="body-earth", name="Earth", kind="planet", massKg=GM_EARTH / G, radiusM=R_EARTH,
                                 positionM=(0.0, 0.0, 0.0), velocityMPerS=(0.0, 0.0, 0.0), colorHex="#3b82f6"),
                     InitialBody(id="body-far", name="Marker", kind="planet", massKg=1.0, radiusM=1.0,
                                 positionM=(0.0, 0.0, 1.0e13), velocityMPerS=(0.0, 0.0, 0.0), colorHex="#ffffff")],
                    history_mode="grid", sample_interval_s=1.0e9)
    return svc


def craft(svc, altitude, mass=1000.0, propellant=0.0, isp=0.0, thrust=0.0, **orbit):
    created, _ = svc.add_spacecraft(SpacecraftCreate(name="V", dryMassKg=mass, propellantKg=propellant, ispS=isp, thrustN=thrust,
                                                     orbit=OrbitSpec(centralBodyId="body-earth", periapsisAltitudeM=altitude, **orbit)))
    return created.id


# ---------------------------------------------------------------------------------------------------------------
# 1-3. circular Earth orbit at a known altitude: speed, period, unforced behaviour
# ---------------------------------------------------------------------------------------------------------------
def test_v1_circular_orbit_at_400_km_has_the_analytic_speed_and_period():
    """400 km circular orbit: v = sqrt(mu / r), T = 2 pi sqrt(r^3 / mu) with mu = G (M + m): about 7.67 km/s and 92.4 min (the
    International Space Station's regime; the altitude is above the preset's MEAN radius, 6371.0 km). Tolerance 1e-12 relative:
    the initial state is a closed-form conversion."""
    svc = lone_earth()
    cid = craft(svc, 400.0e3)
    r = R_EARTH + 400.0e3
    mu = GM_EARTH + G * 1000.0
    v_expected, period_expected = math.sqrt(mu / r), 2.0 * math.pi * math.sqrt(r ** 3 / mu)
    rel_r, rel_v = relative(svc.snapshot(), cid, "body-earth")
    orbit = body_of(svc.snapshot(), cid).spacecraft.orbit
    print(f"\nV1 speed {norm(rel_v):.6f} m/s (analytic {v_expected:.6f}), period {orbit.periodS:.6f} s (analytic {period_expected:.6f})")
    assert norm(rel_r) == pytest.approx(r, rel=1e-13) and norm(rel_v) == pytest.approx(v_expected, rel=1e-12)
    assert orbit.periodS == pytest.approx(period_expected, rel=1e-12)
    assert 7650.0 < v_expected < 7700.0 and period_expected / 60.0 == pytest.approx(92.41, abs=0.02)
    # the simulated orbit really closes after that period
    svc.step(period_expected)
    r1, v1 = relative(svc.snapshot(), cid, "body-earth")
    closure = norm(sub(r1, rel_r))
    print(f"V1 position after one analytic period differs from the start by {closure:.3e} m")
    assert closure < 1e-3  # 1 mm on a 42,500 km path: 2e-11 relative


def test_v2_unforced_orbit_follows_the_independent_kepler_solution_for_100_revolutions():
    """An eccentric, inclined orbit flown by the engine for 100 revolutions against the repository's independent closed-form
    Kepler propagator (f and g functions; shares no code with the engine or with orbits.py). IAS15's phase error grows linearly
    at round-off level, so 1 m after 100 revolutions of a 26,600 km orbit (4e-8 of the orbit size) is a loose bound."""
    svc = lone_earth()
    cid = craft(svc, 500.0e3, eccentricity=0.74, inclinationDeg=63.4, raanDeg=30.0, argPeriapsisDeg=270.0, trueAnomalyDeg=45.0)
    mu = GM_EARTH + G * 1000.0
    r0, v0 = relative(svc.snapshot(), cid, "body-earth")
    period = kepler.elements(r0, v0, mu)["period"]
    worst = 0.0
    for k in range(1, 101):
        svc.step(period * 1.01)  # not a multiple of the period: every phase of the orbit is sampled
        t = svc.snapshot().simulationTimeS
        r, v = relative(svc.snapshot(), cid, "body-earth")
        expected_r, expected_v = kepler.propagate(r0, v0, mu, t)
        worst = max(worst, norm(sub(r, expected_r)))
        assert norm(sub(v, expected_v)) < 1e-3
    energy0 = 0.5 * norm(v0) ** 2 - mu / norm(r0)
    r, v = relative(svc.snapshot(), cid, "body-earth")
    drift = abs((0.5 * norm(v) ** 2 - mu / norm(r)) / energy0 - 1.0)
    print(f"\nV2 worst position difference to the Kepler reference over 100 revolutions: {worst:.3e} m; energy drift {drift:.2e}")
    assert worst < 1.0 and drift < 1e-12


# ---------------------------------------------------------------------------------------------------------------
# 4. delta-v manoeuvre outcome
# ---------------------------------------------------------------------------------------------------------------
def test_v3_a_hohmann_transfer_to_geostationary_radius_matches_the_analytic_orbits():
    """300 km -> 35,786 km: the transfer orbit after the first impulse and the final orbit after the second are compared with the
    analytic Hohmann values derived from energy and angular momentum. Tolerance: the burns are exact impulses at exact epochs, so
    only the two-body time-of-apoapsis estimate used to place the second node (craft mass in mu, 1e-7 relative) matters."""
    svc = lone_earth()
    cid = craft(svc, 300.0e3, mass=1000.0, propellant=3000.0, isp=450.0, thrust=1.0)
    r1, r2 = R_EARTH + 300.0e3, R_EARTH + 35786.0e3
    mu = GM_EARTH + G * 4000.0
    vp = math.sqrt(2.0 * mu * r2 / (r1 * (r1 + r2)))
    dv1 = vp - math.sqrt(mu / r1)
    svc.add_maneuver(cid, ManeuverCreate(at="now", progradeMPerS=dv1))
    transfer = body_of(svc.snapshot(), cid).spacecraft.orbit
    assert transfer.apoapsisRadiusM == pytest.approx(r2, rel=1e-9) and transfer.periapsisRadiusM == pytest.approx(r1, rel=1e-9)
    m1 = 4000.0 * math.exp(-dv1 / (450.0 * G0))
    assert body_of(svc.snapshot(), cid).massKg == pytest.approx(m1, rel=1e-12)
    mu = GM_EARTH + G * m1
    dv2 = math.sqrt(mu / r2) - math.sqrt(2.0 * mu * r1 / (r2 * (r1 + r2)))
    node = svc.add_maneuver(cid, ManeuverCreate(at="apoapsis", progradeMPerS=dv2))
    half_period = math.pi * math.sqrt((0.5 * (r1 + r2)) ** 3 / mu)
    assert node.epochS == pytest.approx(half_period, rel=1e-9)
    svc.step(half_period + 3600.0)
    final = body_of(svc.snapshot(), cid).spacecraft.orbit
    print(f"\nV3 dv1 {dv1:.3f} m/s, dv2 {dv2:.3f} m/s; final a - r_geo = {final.semiMajorAxisM - r2:.3f} m, e = {final.eccentricity:.2e}")
    assert final.semiMajorAxisM == pytest.approx(r2, abs=50.0) and final.eccentricity < 1e-5
    m2 = m1 * math.exp(-dv2 / (450.0 * G0))
    assert body_of(svc.snapshot(), cid).massKg == pytest.approx(m2, rel=1e-12)
    # 35,786 km above the MEAN radius is 7 km inside the geostationary radius: the period is 22 s short of a sidereal day (86,164 s)
    assert final.periodS == pytest.approx(2.0 * math.pi * math.sqrt(r2 ** 3 / (GM_EARTH + G * m2)), rel=1e-9)
    assert final.periodS == pytest.approx(86164.1, rel=5e-4)


def test_v4_a_finite_burn_in_orbit_matches_an_independent_integration_of_the_thrust_equations():
    """A 150 s prograde-tracking burn in low orbit against an RK4 integration (written here) of
    r'' = -mu r / r^3 + (F / m(t)) v / |v|,  m(t) = m0 - (F / (Isp g0)) t.  Step-halving shows the reference converged to
    millimetres; the engine must agree with it to 1 cm in position and 1e-5 m/s in velocity."""
    thrust, isp, m0, duration_dv = 20000.0, 320.0, 3000.0, 1100.0
    svc = lone_earth()
    cid = craft(svc, 400.0e3, mass=1000.0, propellant=2000.0, isp=isp, thrust=thrust)
    r0, v0 = relative(svc.snapshot(), cid, "body-earth")
    node = svc.add_maneuver(cid, ManeuverCreate(at="now", mode="finite", progradeMPerS=duration_dv))
    duration = node.endS - node.startS
    flow = thrust / (isp * G0)
    assert duration == pytest.approx(m0 * (1.0 - math.exp(-duration_dv / (isp * G0))) / flow, rel=1e-13)
    svc.step(duration)
    r1, v1 = relative(svc.snapshot(), cid, "body-earth")

    def reference(steps):
        h = duration / steps
        y = list(r0) + list(v0)

        def f(t, y):
            r, v = y[:3], y[3:]
            d3 = norm(r) ** 3
            a = thrust / (m0 - flow * t) / norm(v)
            return v + [-GM_EARTH_PLUS * r[i] / d3 + a * v[i] for i in range(3)]

        t = 0.0
        for _ in range(steps):
            k1 = f(t, y)
            k2 = f(t + 0.5 * h, [y[i] + 0.5 * h * k1[i] for i in range(6)])
            k3 = f(t + 0.5 * h, [y[i] + 0.5 * h * k2[i] for i in range(6)])
            k4 = f(t + h, [y[i] + h * k3[i] for i in range(6)])
            y = [y[i] + h / 6.0 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) for i in range(6)]
            t += h
        return y

    # the Earth is 6e21 times heavier than the craft and its recoil over 150 s is far below a micrometre: a fixed centre is exact here
    GM_EARTH_PLUS = GM_EARTH
    coarse, fine = reference(20000), reference(40000)
    assert norm(sub(coarse[:3], fine[:3])) < 1e-3
    dr, dv = norm(sub(r1, fine[:3])), norm(sub(v1, fine[3:]))
    after = body_of(svc.snapshot(), cid)
    print(f"\nV4 engine vs RK4 reference after a {duration:.1f} s burn: {dr:.3e} m, {dv:.3e} m/s; mass {after.massKg:.6f} kg")
    assert dr < 1e-2 and dv < 1e-5
    assert after.massKg == pytest.approx(m0 * math.exp(-duration_dv / (isp * G0)), rel=1e-12)


# ---------------------------------------------------------------------------------------------------------------
# 5. the representative Earth-to-Moon transfer
# ---------------------------------------------------------------------------------------------------------------
def rk4_three_body(state, t_end, steps):
    """Earth, Moon and a massless craft: RK4 with a fixed step, written here. state: dict name -> (m, r, v)."""
    names = list(state)
    masses = [state[n][0] for n in names]
    y = [c for n in names for c in state[n][1]] + [c for n in names for c in state[n][2]]
    n = len(names)

    def f(y):
        pos = [y[3 * i:3 * i + 3] for i in range(n)]
        out = list(y[3 * n:])
        for i in range(n):
            a = [0.0, 0.0, 0.0]
            for j in range(n):
                if i == j or masses[j] == 0.0:
                    continue
                d = [pos[j][k] - pos[i][k] for k in range(3)]
                d3 = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) ** 1.5
                for k in range(3):
                    a[k] += G * masses[j] * d[k] / d3
            out.extend(a)
        return out

    h = t_end / steps
    m = len(y)
    for _ in range(steps):
        k1 = f(y)
        k2 = f([y[i] + 0.5 * h * k1[i] for i in range(m)])
        k3 = f([y[i] + 0.5 * h * k2[i] for i in range(m)])
        k4 = f([y[i] + h * k3[i] for i in range(m)])
        y = [y[i] + h / 6.0 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) for i in range(m)]
    return {name: (y[3 * i:3 * i + 3], y[3 * n + 3 * i:3 * n + 3 * i + 3]) for i, name in enumerate(names)}


@pytest.fixture(scope="module")
def lunar_mission():
    """The reference mission in the Earth-Moon preset: 300 km parking orbit in the Moon's plane -> 100 km circular lunar orbit."""
    from backend import universes

    registry = universes.UniverseRegistry()
    svc = create_preset_universe(registry, "earth-moon-j2000", None, True).engine
    created, _ = svc.add_spacecraft(SpacecraftCreate(
        name="Reference", dryMassKg=3000.0, propellantKg=12000.0, thrustN=50000.0, ispS=450.0,
        orbit=OrbitSpec(centralBodyId="body-earth", periapsisAltitudeM=300.0e3, matchPlaneOfBodyId="body-moon")))
    mission = svc.create_mission(MissionCreate(name="Reference", spacecraftId=created.id, destinationBodyId="body-moon",
                                               objective=MissionObjective(periapsisAltitudeM=100.0e3)))
    planned = svc.plan_mission(mission.id, MissionPlanRequest())
    assert planned.status == "planned"
    return svc, created.id, mission.id, planned.plan


def test_v5_the_planned_transfer_has_textbook_magnitudes(lunar_mission):
    """Minimum-energy transfer from a 300 km orbit: departure about 3.1 km/s, lunar orbit insertion into a 100 km circular orbit
    about 0.8 km/s, flight time 4 to 5 days (well-known mission-design magnitudes; e.g. Apollo's translunar injection was about
    3.05 to 3.15 km/s from a 185 km orbit, with faster 3-day transfers). The exact values depend on the Moon's distance at arrival."""
    _, _, _, plan = lunar_mission
    r0 = R_EARTH + 300.0e3
    d = plan["patchedConic"]["transferApoapsisRadiusM"]
    hohmann_dv = math.sqrt(2.0 * GM_EARTH * d / (r0 * (r0 + d))) - math.sqrt(GM_EARTH / r0)  # tangential burn onto an ellipse with that apoapsis
    print(f"\nV5 departure {plan['departure']['deltaVMPerS']:.2f} m/s (two-body for the same apoapsis {hohmann_dv:.2f}), "
          f"insertion {plan['insertion']['deltaVMPerS']:.2f} m/s, flight time {plan['arrival']['transferTimeS'] / 86400.0:.3f} d, "
          f"v_inf {plan['arrival']['hyperbolicExcessSpeedMPerS']:.1f} m/s, trial flights {plan['model']['trialFlights']}")
    assert plan["departure"]["deltaVMPerS"] == pytest.approx(hohmann_dv, rel=1e-4)
    assert 3050.0 < plan["departure"]["deltaVMPerS"] < 3200.0 and 750.0 < plan["insertion"]["deltaVMPerS"] < 900.0
    assert 3.5 < plan["arrival"]["transferTimeS"] / 86400.0 < 5.5
    assert plan["arrival"]["periapsisAltitudeM"] == pytest.approx(100.0e3, abs=1.0)
    # the insertion delta-v is the periapsis speed minus the circular speed there (vis-viva about the Moon); the periapsis found is
    # within 1 m of the target radius, which is worth 1e-6 of the circular speed
    rp = plan["arrival"]["periapsisRadiusM"]
    assert plan["insertion"]["deltaVMPerS"] == pytest.approx(plan["arrival"]["periapsisSpeedMPerS"] - math.sqrt(GM_MOON / rp), rel=2e-6)


def test_v6_the_engines_translunar_coast_matches_an_independent_three_body_integration(lunar_mission):
    """The coast from just after the departure burn to one day before arrival, flown by the engine, against the RK4 three-body
    integration above (30 s steps, converged to a few metres by step-halving). This checks the engine's propagation of the
    spacecraft under Earth AND Moon gravity independently of REBOUND. The comparison stops a day short of the Moon because
    a fixed-step RK4 cannot resolve the close lunar passage; agreement is required to 100 m on a 300,000 km leg (3e-10)."""
    from backend import universes

    _, _, _, plan = lunar_mission
    registry = universes.UniverseRegistry()
    svc = create_preset_universe(registry, "earth-moon-j2000", None, True).engine
    created, _ = svc.add_spacecraft(SpacecraftCreate(
        name="Coast", dryMassKg=3000.0, propellantKg=12000.0, thrustN=50000.0, ispS=450.0,
        orbit=OrbitSpec(centralBodyId="body-earth", periapsisAltitudeM=300.0e3, matchPlaneOfBodyId="body-moon")))
    cid = created.id
    t_dep = plan["departure"]["epochS"]
    svc.add_maneuver(cid, ManeuverCreate(at="epoch", epochS=t_dep, progradeMPerS=plan["departure"]["deltaVMPerS"], referenceBodyId="body-earth"))
    svc.step(t_dep + 1800.0)  # half an hour after the burn: about 9,000 km up, where a 30 s RK4 step is accurate
    start = svc.snapshot()
    span = plan["arrival"]["epochS"] - 86400.0 - start.simulationTimeS
    initial = {b.id: (0.0 if b.kind == "spacecraft" else b.massKg, list(vec(b.positionM)), list(vec(b.velocityMPerS))) for b in start.bodies}
    steps = int(span / 30.0)
    coarse, fine = rk4_three_body(initial, span, steps), rk4_three_body(initial, span, 2 * steps)
    convergence = norm(sub(coarse[cid][0], fine[cid][0]))
    svc.step(span)
    end = svc.snapshot()
    difference = norm(sub(vec(body_of(end, cid).positionM), fine[cid][0]))
    moon_difference = norm(sub(vec(body_of(end, "body-moon").positionM), fine["body-moon"][0]))
    leg = norm(sub(vec(body_of(end, cid).positionM), vec(body_of(start, cid).positionM)))
    print(f"\nV6 coast of {span / 86400.0:.2f} d over {leg / 1e3:.0f} km: engine vs RK4 {difference:.2f} m (RK4 step-halving {convergence:.2f} m); "
          f"Moon {moon_difference:.3f} m")
    assert convergence < 20.0 and difference < 100.0 and moon_difference < 1.0


def test_v7_flying_the_plan_gives_the_planned_orbit_within_the_stated_tolerances(lunar_mission):
    """Plan versus simulation. The planner flies a copy with the same integrator, so the two differ only by round-off amplified
    along the trajectory: the documented agreement tolerance is 1 km / 1 m/s at each node; the measured differences are printed."""
    svc, cid, mid, plan = lunar_mission
    svc.commit_mission(mid)
    mission = None
    for _ in range(400):
        mission = svc.step(1800.0).spaceflight.missions[0]
        if mission.status in ("completed", "failed"):
            break
    assert mission.status == "completed", mission.reasons
    for row in mission.agreement:
        print(f"\nV7 {row['role']}: plan vs simulation {row['positionDifferenceM']:.3e} m, {row['velocityDifferenceMPerS']:.3e} m/s")
        assert row["ok"] and row["positionDifferenceM"] < 1.0e-2 and row["velocityDifferenceMPerS"] < 1.0e-5
    outcome, predicted = mission.outcome, plan["predictedOrbit"]
    print(f"V7 actual lunar orbit: a = {outcome['semiMajorAxisM']:.1f} m, e = {outcome['eccentricity']:.2e}, altitudes "
          f"{outcome['periapsisAltitudeM'] / 1e3:.3f} / {outcome['apoapsisAltitudeM'] / 1e3:.3f} km, period {outcome['periodS']:.1f} s")
    assert predicted["minAltitudeM"] - 200.0 < outcome["periapsisAltitudeM"] and outcome["apoapsisAltitudeM"] < predicted["maxAltitudeM"] + 200.0
    assert outcome["periapsisAltitudeM"] == pytest.approx(100.0e3, abs=500.0) and outcome["apoapsisAltitudeM"] == pytest.approx(100.0e3, abs=500.0)
    assert outcome["periodS"] == pytest.approx(2.0 * math.pi * math.sqrt((R_MOON + 100.0e3) ** 3 / GM_MOON), rel=1e-4)  # 117.8 min
    # independent of the mission bookkeeping: the spacecraft really stays between 99 and 101 km for five more revolutions
    low, high = math.inf, -math.inf
    for _ in range(200):
        state = svc.step(outcome["periodS"] / 40.0)
        altitude = norm(relative(state, cid, "body-moon")[0]) - R_MOON
        low, high = min(low, altitude), max(high, altitude)
    print(f"V7 altitude over five further revolutions: {low / 1e3:.3f} .. {high / 1e3:.3f} km")
    assert 99.0e3 < low and high < 101.0e3


def test_v8_the_sun_omitted_from_the_mission_preset_changes_the_arrival_by_a_measured_amount():
    """Limitation, measured: the Earth-Moon preset has no Sun. The same departure (same time, same delta-v) planned there is flown
    in Sun + Earth + Moon (states from the same archived Horizons data): the closest approach to the Moon moves by hundreds of
    kilometres (measured: about 320 km at J2000.0, sampled every minute), so a plan from one universe is NOT a prediction for the
    other. The band asserted is wide; the value is recorded in docs/SPACE_MISSION_DESIGN.md."""
    from backend import universes
    from backend.presets.loader import load_preset

    registry = universes.UniverseRegistry()
    em = create_preset_universe(registry, "earth-moon-j2000", None, True).engine
    spec = dict(name="S", dryMassKg=3000.0, propellantKg=12000.0, thrustN=50000.0, ispS=450.0,
                orbit=OrbitSpec(centralBodyId="body-earth", periapsisAltitudeM=300.0e3, matchPlaneOfBodyId="body-moon"))
    created, _ = em.add_spacecraft(SpacecraftCreate(**spec))
    mission = em.create_mission(MissionCreate(name="S", spacecraftId=created.id, destinationBodyId="body-moon",
                                              objective=MissionObjective(type="flyby", periapsisAltitudeM=100.0e3)))
    plan = em.plan_mission(mission.id, MissionPlanRequest()).plan
    full = load_preset("solar-system-moons-j2000")
    sem = SimulationService(STOP_ON_CONTACT_CONFIG)
    sem.load_bodies([b for b in full.bodies if b.id in ("body-sun", "body-earth", "body-moon")], history_mode="grid", sample_interval_s=1.0e9)
    craft_id = sem.add_spacecraft(SpacecraftCreate(**spec))[0].id
    sem.add_maneuver(craft_id, ManeuverCreate(at="epoch", epochS=plan["departure"]["epochS"], progradeMPerS=plan["departure"]["deltaVMPerS"],
                                              referenceBodyId="body-earth"))
    closest = math.inf
    sem.step(plan["arrival"]["epochS"] - 43200.0)
    for _ in range(1440):  # a day around the planned arrival, minute by minute
        state = sem.step(60.0)
        if state.halt is not None:
            closest = R_MOON
            break
        closest = min(closest, norm(relative(state, craft_id, "body-moon")[0]))
    miss = closest - plan["arrival"]["periapsisRadiusM"]
    print(f"\nV8 same departure with the Sun present: closest approach {closest / 1e3:.0f} km from the Moon's centre "
          f"instead of {plan['arrival']['periapsisRadiusM'] / 1e3:.0f} km (difference {miss / 1e3:.0f} km)")
    assert 50.0e3 < abs(miss) < 1.0e7
