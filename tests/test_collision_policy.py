"""The active collision path: stop on contact (owner decision D-071).

Every universe the application creates stops at the instant two bodies first touch, reports the contact and keeps one consistent
state. Nothing is merged, nothing fragments, no debris, ejecta or aftermath exists. These tests run on the DEFAULT engine, exactly
as the application builds it, and cover what matters under that policy:

- the contact is found, at the right time, with the right bodies (the detection scenarios that used to end in a merge:
  Kepler orbits, radial free fall, fast and near-relativistic head-on passes, grazing geometry, several contacts at once);
- the state at the halt is the physical state at first contact (touching, not overlapping; mass, momentum, angular momentum and
  ENERGY as before the contact, since nothing was dissipated);
- nothing but the halt happened (no body removed or created, no merger or collision event, no record, no debris);
- the user can resolve the contact and continue.

Expected values are closed forms (Kepler's equation, vis-viva, the free-fall time, straight-line kinematics), never REBOUND output.
The same scenarios still pin the dormant merge behaviour in tests/test_stress_p003.py, tests/test_simulation_service.py and
tests/validation/test_independent_physics.py under the marker `dormant_collisions`.
"""
import math

import pytest
from fastapi.testclient import TestClient

from backend import universes
from backend.api_universes import create_preset_universe
from backend.main import app
from backend.models import BodyCreate, BodyUpdate
from backend.simulation import SimulationService

G = 6.67430e-11
C = 299_792_458.0


def make(name="b", m=1.0, r=1.0, x=(0.0, 0.0, 0.0), v=(0.0, 0.0, 0.0), **extra) -> BodyCreate:
    return BodyCreate(name=name, massKg=m, radiusM=r, positionM=dict(zip("xyz", x)), velocityMPerS=dict(zip("xyz", v)),
                      colorHex="#ffffff", **extra)


def of(state, body_id):
    return next(b for b in state.bodies if b.id == body_id)


def vec(v):
    return (v.x, v.y, v.z)


def separation(state, i, j) -> float:
    return math.dist(vec(of(state, i).positionM), vec(of(state, j).positionM))


def momentum(state):
    return tuple(sum(b.massKg * getattr(b.velocityMPerS, k) for b in state.bodies) for k in "xyz")


def energy(state) -> float:
    d = state.diagnostics
    return d.kineticEnergyJ + d.potentialEnergyJ


def assert_halted_at_first_contact(svc, out, i, j, contact_distance):
    """What every stop has in common: one `contact` event of exactly this pair, the halt, the step ended early with the warning,
    the pair exactly touching, and nothing else in the universe changed."""
    assert [e.type for e in out.events] == ["contact"], out.events
    event = out.events[0]
    assert set(event.bodyIds) == {i, j} and event.involvesSpacecraft is False and event.refined is True
    assert out.halt is not None and out.halt.eventId == event.id and set(out.halt.bodyIds) == {i, j}
    assert out.warnings == ["collision_stopped"] and out.simulationTimeS == event.simulationTimeS
    # touching: the refinement puts the pair on the contact distance to 1e-9 relative (CollisionTolerances.contact_distance_rel)
    assert separation(out, i, j) == pytest.approx(contact_distance, rel=4.0e-9)
    assert svc.collision_records() == [] and all(e.type == "contact" for e in svc.events())
    assert all(b.representation is None and b.originEventId is None and b.debris is None for b in out.bodies)
    return event


@pytest.fixture
def svc():
    return SimulationService()  # the default: what every universe gets


# ---------------------------------------------------------------------------------------------------------------
# the contact is found at the right time
# ---------------------------------------------------------------------------------------------------------------
def test_a_bound_orbit_with_periapsis_inside_the_contact_distance_stops_at_the_kepler_time(svc):
    """e = 0.9, a = 1000 m, radii 100 m and 50 m: the periapsis (100 m) is inside the contact distance (150 m), so the pair touches
    on its first approach. Time from apoapsis to a separation of 150 m by Kepler's equation; speed there by vis-viva. The pair is
    stopped AT that instant (the dormant merge reported it up to one internal step late and merged the bodies)."""
    m1, m2, a, e, r1, r2 = 5.0e12, 1.0e12, 1000.0, 0.9, 100.0, 50.0
    gm, contact = G * (m1 + m2), r1 + r2
    apo = a * (1.0 + e)
    v_apo = math.sqrt(gm * (2.0 / apo - 1.0 / a))
    one = svc.add_body(make("one", m1, r1, x=(-apo * m2 / (m1 + m2), 0.0, 0.0), v=(0.0, -v_apo * m2 / (m1 + m2), 0.0)))
    two = svc.add_body(make("two", m2, r2, x=(apo * m1 / (m1 + m2), 0.0, 0.0), v=(0.0, v_apo * m1 / (m1 + m2), 0.0)))
    before = svc.snapshot()
    ecc = math.acos((1.0 - contact / a) / e)  # r = a (1 - e cos E)
    t_contact = (math.pi - (ecc - e * math.sin(ecc))) / math.sqrt(gm / a ** 3)
    v_contact = math.sqrt(gm * (2.0 / contact - 1.0 / a))

    out = svc.step(2.0 * math.pi * math.sqrt(a ** 3 / gm))  # a whole period requested
    event = assert_halted_at_first_contact(svc, out, one.id, two.id, contact)
    assert out.simulationTimeS == pytest.approx(t_contact, rel=1.0e-8)
    assert event.relativeSpeedMPerS == pytest.approx(v_contact, rel=1.0e-8)
    assert out.advancedS == pytest.approx(t_contact, rel=1.0e-8) and out.advancedS < 0.6 * (2.0 * math.pi * math.sqrt(a ** 3 / gm))
    # nothing was merged or dissipated: both bodies, their masses, and every conserved quantity including the energy
    assert [b.id for b in out.bodies] == [one.id, two.id] and [b.massKg for b in out.bodies] == [m1, m2]
    assert math.dist(momentum(out), momentum(before)) < 1.0e-9 * m2 * v_contact
    assert energy(out) == pytest.approx(energy(before), rel=1.0e-10)
    assert out.diagnostics.angularMomentumAboutOriginKgM2PerS.z == pytest.approx(before.diagnostics.angularMomentumAboutOriginKgM2PerS.z, rel=1.0e-10)


def test_radial_free_fall_stops_at_the_closed_form_contact_time(svc):
    """A probe falls from rest at 1e8 m onto a body of radius 1e6 m: t = sqrt(r0^3 / 2GM) (theta + sin theta cos theta),
    cos^2 theta = contact / r0."""
    central, probe, r0, contact = 1.0e24, 1.0, 1.0e8, 1.0e6 + 1.0
    theta = math.acos(math.sqrt(contact / r0))
    t_contact = math.sqrt(r0 ** 3 / (2.0 * G * (central + probe))) * (theta + math.sin(theta) * math.cos(theta))
    c = svc.add_body(make("central", central, 1.0e6))
    p = svc.add_body(make("probe", probe, 1.0, x=(r0, 0.0, 0.0)))
    out = svc.step(3.0e5)
    event = assert_halted_at_first_contact(svc, out, c.id, p.id, contact)
    assert out.simulationTimeS == pytest.approx(t_contact, rel=1.0e-9)
    assert event.relativeSpeedMPerS == pytest.approx(math.sqrt(2.0 * G * (central + probe) * (1.0 / contact - 1.0 / r0)), rel=1.0e-9)
    assert len(out.bodies) == 2 and of(out, c.id).massKg == central and of(out, p.id).massKg == probe


@pytest.mark.parametrize("dt", [1.0, 30.0, 400.0])
def test_a_fast_head_on_pass_is_not_tunnelled_whatever_the_step(svc, dt):
    """Two 1 m bodies 2 km apart closing at 2 km/s touch after (2000 - 2) / 2000 s. A step far longer than that must still stop
    there: the swept test covers the whole internal step, so the pair cannot pass through each other between two steps."""
    a = svc.add_body(make("a", 1.0e3, 1.0, x=(-1000.0, 0.0, 0.0), v=(1000.0, 0.0, 0.0)))
    b = svc.add_body(make("b", 1.0e3, 1.0, x=(1000.0, 0.0, 0.0), v=(-1000.0, 0.0, 0.0)))
    out = svc.step(dt)
    event = assert_halted_at_first_contact(svc, out, a.id, b.id, 2.0)
    assert out.simulationTimeS == pytest.approx(0.999, rel=1.0e-9)
    assert event.relativeSpeedMPerS == pytest.approx(2000.0, rel=1.0e-9)
    assert of(out, a.id).positionM.x == pytest.approx(-1.0, abs=1.0e-6) and of(out, b.id).positionM.x == pytest.approx(1.0, abs=1.0e-6)


def test_a_near_relativistic_straight_through_pass_is_detected(svc):
    """Numerical stress only (Newtonian physics is not valid at 0.49 c per body): 1e9 m apart, radii 5e5 m, closing at 0.98 c."""
    speed, r = 0.49 * C, 5.0e5
    a = svc.add_body(make("left", 1.0e10, r, x=(-5.0e8, 0.0, 0.0), v=(speed, 0.0, 0.0)))
    b = svc.add_body(make("right", 2.0e10, r, x=(5.0e8, 0.0, 0.0), v=(-speed, 0.0, 0.0)))
    out = svc.step(4.0)
    event = assert_halted_at_first_contact(svc, out, a.id, b.id, 2.0 * r)
    assert out.simulationTimeS == pytest.approx((1.0e9 - 2.0 * r) / (2.0 * speed), rel=1.0e-9)
    assert event.relativeSpeedMPerS == pytest.approx(2.0 * speed, rel=2.0e-10)


@pytest.mark.parametrize("clearance, touches", [(0.999, True), (1.001, False)])
def test_a_fast_pass_stops_only_if_the_bodies_really_touch(svc, clearance, touches):
    """Impact parameter 0.1 % inside or outside the sum of the radii, at 2,000 km/s: a contact is reported for the first, and
    nothing at all for the second (the sweep must not invent one)."""
    b_param = 2.0 * clearance
    a = svc.add_body(make("left", 1.0e6, 1.0, x=(-1000.0, b_param / 2.0, 0.0), v=(1.0e6, 0.0, 0.0)))
    b = svc.add_body(make("right", 1.0e6, 1.0, x=(1000.0, -b_param / 2.0, 0.0), v=(-1.0e6, 0.0, 0.0)))
    out = svc.step(0.002)
    if touches:
        assert_halted_at_first_contact(svc, out, a.id, b.id, 2.0)
        # first contact of the straight paths: sqrt(R^2 - b^2) before closest approach
        assert out.simulationTimeS == pytest.approx((2000.0 - math.sqrt(4.0 - b_param ** 2)) / 2.0e6, rel=1.0e-6)
    else:
        assert out.events == [] and out.halt is None and out.warnings == [] and out.simulationTimeS == 0.002
        assert len(out.bodies) == 2


def test_orbits_that_do_not_touch_never_stop(svc):
    """A circular orbit 5 % outside the contact distance, for three revolutions: no event, no halt."""
    m1, m2, r1, r2 = 5.0e12, 1.0e12, 100.0, 50.0
    d = 1.05 * (r1 + r2)
    v = math.sqrt(G * (m1 + m2) / d)
    svc.add_body(make("one", m1, r1, x=(-d * m2 / (m1 + m2), 0.0, 0.0), v=(0.0, -v * m2 / (m1 + m2), 0.0)))
    svc.add_body(make("two", m2, r2, x=(d * m1 / (m1 + m2), 0.0, 0.0), v=(0.0, v * m1 / (m1 + m2), 0.0)))
    period = 2.0 * math.pi * math.sqrt(d ** 3 / (G * (m1 + m2)))
    for _ in range(30):
        out = svc.step(period / 10.0)
        assert out.events == [] and out.halt is None
    assert svc.snapshot().simulationTimeS == pytest.approx(3.0 * period)


# ---------------------------------------------------------------------------------------------------------------
# several contacts
# ---------------------------------------------------------------------------------------------------------------
def test_of_several_pairs_the_first_to_touch_stops_everything_and_the_others_are_found_after_it_is_resolved(svc):
    """Three independent head-on pairs far apart, touching after 10 s, 20 s and 30 s. Each stop names one pair, at its time, with
    every other body still where free motion puts it; removing one body of the pair lets the simulation go on to the next."""
    pairs = []
    for k, gap in enumerate((20.0, 40.0, 60.0)):  # closing at 2 m/s: 10 s, 20 s, 30 s
        y = 1.0e6 * k
        left = svc.add_body(make(f"L{k}", 1.0, 1.0, x=(-(gap + 2.0) / 2.0, y, 0.0), v=(1.0, 0.0, 0.0)))
        right = svc.add_body(make(f"R{k}", 1.0, 1.0, x=((gap + 2.0) / 2.0, y, 0.0), v=(-1.0, 0.0, 0.0)))
        pairs.append((left.id, right.id, gap / 2.0))
    for k, (left, right, when) in enumerate(pairs):
        out = svc.step(100.0)
        assert_halted_at_first_contact(svc, out, left, right, 2.0)
        assert out.simulationTimeS == pytest.approx(when, rel=1.0e-9)
        assert len(out.bodies) == 6 - k  # nothing but the user's own removals
        for other_left, other_right, other_when in pairs[k + 1:]:
            assert separation(out, other_left, other_right) == pytest.approx(2.0 + 2.0 * (other_when - when), rel=1.0e-9)
        with pytest.raises(Exception) as refused:
            svc.step(1.0)
        assert getattr(refused.value, "code", None) == "simulation_halted"
        svc.delete_body(right)
    out = svc.step(100.0)
    assert out.events == [] and out.halt is None and out.advancedS == pytest.approx(100.0) and len(out.bodies) == 3
    assert [e.type for e in svc.events()] == ["contact"] * 3


@pytest.mark.parametrize("n", [4, 6, 12])
def test_a_ring_of_bodies_converging_on_one_point_stops_at_the_first_touch_with_every_body_intact(svc, n):
    """n equal bodies on a ring, all moving to the centre: neighbours touch simultaneously all round the ring. Under the dormant
    merge resolver this is the configuration in which three or more contacts in one detection pass could merge bodies that do not
    touch (the outstanding defect H4 of D-069). Here nothing merges at all: the simulation stops at the first touch, every body
    exists with its mass, the reported pair touches, and no pair overlaps."""
    ring, speed, mass, radius = 100.0, 10.0, 1.0e6, 5.0
    ids = []
    for k in range(n):
        ang = 2.0 * math.pi * k / n
        d = (math.cos(ang), math.sin(ang), 0.0)
        ids.append(svc.add_body(make(f"ring{k}", mass, radius, x=tuple(ring * c for c in d), v=tuple(-speed * c for c in d))).id)
    out = svc.step(60.0)
    assert [e.type for e in out.events] == ["contact"] and out.halt is not None
    i, j = out.halt.bodyIds
    assert separation(out, i, j) == pytest.approx(2.0 * radius, rel=4.0e-9)
    assert [b.id for b in out.bodies] == ids and all(b.massKg == mass for b in out.bodies)
    for a in range(n):
        for b in range(a + 1, n):
            assert separation(out, ids[a], ids[b]) >= 2.0 * radius * (1.0 - 4.0e-9)  # nobody is inside anybody
    # neighbours are 2 r_ring sin(pi/n) apart, so they touch when the ring has shrunk to radius / sin(pi/n) (gravity is negligible)
    assert out.simulationTimeS == pytest.approx((ring - radius / math.sin(math.pi / n)) / speed, rel=1.0e-4)
    assert math.dist(momentum(out), (0.0, 0.0, 0.0)) < 1.0e-9 * mass * speed


# ---------------------------------------------------------------------------------------------------------------
# no aftermath, in any universe
# ---------------------------------------------------------------------------------------------------------------
def test_a_violent_impact_of_bodies_with_materials_and_spin_produces_no_fragments_debris_or_records(svc):
    """A 30 km/s impact of two rocky planets with materials and spin: under the dormant outcome engine this is a disruption with
    fragments and debris parcels. Now: the halt, and two untouched bodies with their materials and rotation."""
    target = svc.add_body(make("target", 6.0e24, 6.4e6, material={"profileId": "silicate-rock"}, spinRadPerS={"x": 0.0, "y": 0.0, "z": 7.0e-5}))
    impactor = svc.add_body(make("impactor", 6.0e23, 3.4e6, x=(-2.0e8, 0.0, 0.0), v=(3.0e4, 0.0, 0.0), material={"profileId": "silicate-rock"}))
    before = svc.snapshot()
    out = None
    for _ in range(20):
        out = svc.step(1000.0)
        if out.halt is not None:
            break
    assert_halted_at_first_contact(svc, out, target.id, impactor.id, 6.4e6 + 3.4e6)
    assert [(b.id, b.name, b.massKg, b.radiusM) for b in out.bodies] == [(b.id, b.name, b.massKg, b.radiusM) for b in before.bodies]
    assert [b.material.profileId for b in out.bodies] == ["silicate-rock", "silicate-rock"]
    assert of(out, target.id).spinRadPerS.z == 7.0e-5
    assert out.diagnostics.totalMassKg == before.diagnostics.totalMassKg
    assert energy(out) == pytest.approx(energy(before), rel=1.0e-9)  # nothing dissipated
    assert svc.collision_state() is None or not getattr(svc.collision_state(), "records", [])


def test_a_body_added_to_a_preset_stops_the_preset_when_it_hits_a_planet(registry):
    """Presets merged on contact until D-071 (legacy-merge). A rock put on a collision course with the Earth of the Solar System
    preset is now reported and stops that universe; the Earth keeps its mass and every preset body is still there."""
    universe = create_preset_universe(registry, "solar-system-j2000", None, True)
    engine = universe.engine
    start = engine.snapshot()
    earth = next(b for b in start.bodies if b.name.lower().startswith("earth"))
    ex, ev = vec(earth.positionM), vec(earth.velocityMPerS)
    rock = engine.add_body(make("rock", 1.0e15, 1.0e4, x=(ex[0] + 4.0 * earth.radiusM, ex[1], ex[2]), v=(ev[0] - 2.0e4, ev[1], ev[2])))
    out = engine.step(3600.0)
    event = assert_halted_at_first_contact(engine, out, earth.id, rock.id, earth.radiusM + 1.0e4)
    assert 100.0 < out.simulationTimeS < 1000.0 and event.relativeSpeedMPerS > 2.0e4
    assert len(out.bodies) == len(start.bodies) + 1 and of(out, earth.id).massKg == earth.massKg
    assert universe.engine.collision_config.mode == "stop-on-contact"


def test_the_halt_survives_reads_and_is_cleared_by_reset_restore_removal_or_a_separating_edit(svc):
    a = svc.add_body(make("a", 1.0e3, 1.0, x=(-10.0, 0.0, 0.0), v=(1.0, 0.0, 0.0)))
    b = svc.add_body(make("b", 1.0e3, 1.0, x=(10.0, 0.0, 0.0), v=(-1.0, 0.0, 0.0)))
    snap = svc.capture_snapshot()
    assert svc.step(60.0).halt is not None and svc.snapshot().halt is not None  # reads keep showing it
    # 1. a separating edit: the pair still touches, but moves apart, so the simulation runs
    svc.update_body(b.id, BodyUpdate(velocityMPerS={"x": 5.0, "y": 0.0, "z": 0.0}))
    resumed = svc.step(10.0)
    assert resumed.halt is None and resumed.advancedS == pytest.approx(10.0) and resumed.events == []
    # 2. a snapshot from before the contact
    svc.restore_snapshot(snap)
    assert svc.snapshot().halt is None
    assert svc.step(60.0).halt is not None
    # 3. an edit that leaves them closing does not clear anything: the next step stops at once, without advancing
    svc.update_body(a.id, BodyUpdate(name="still closing"))
    stuck = None
    try:
        stuck = svc.step(10.0)
    except Exception as exc:  # noqa: BLE001 - either refused outright or stopped again at the same instant
        assert getattr(exc, "code", None) == "simulation_halted"
    assert stuck is None or (stuck.halt is not None and stuck.advancedS == 0.0)
    # 4. removing one of the pair
    svc.delete_body(a.id)
    assert svc.snapshot().halt is None and svc.step(5.0).advancedS == pytest.approx(5.0)
    # 5. reset
    svc.reset()
    assert svc.snapshot().halt is None and svc.snapshot().bodies == []


# ---------------------------------------------------------------------------------------------------------------
# through the API
# ---------------------------------------------------------------------------------------------------------------
def test_no_route_reports_a_merger_a_collision_outcome_or_debris_any_more():
    """End to end over HTTP on a fresh sandbox and on a preset: bodies on collision courses, stepped to the contact. The only event
    type that exists is `contact`; the collision-record routes stay empty; no body carries a debris or fragment field."""
    client = TestClient(app)
    for source in ({"kind": "empty"}, {"kind": "preset", "presetId": "earth-moon-j2000"}):
        uid = client.post("/api/v1/universes", json={"source": source, "activate": True}).json()["id"]
        epoch = client.get("/api/v1/universes").json()["activationEpoch"]
        assert client.get(f"/api/v1/universes/{uid}").json()["collisionMode"] == "stop-on-contact"
        base = {"x": 5.0e9, "y": 0.0, "z": 0.0}  # well away from the preset's own bodies
        for name, x, vx in (("p", -1.0e6, 2.0e3), ("q", 1.0e6, -2.0e3)):
            r = client.post(f"/api/v1/universes/{uid}/bodies?activationEpoch={epoch}", json={
                "name": name, "massKg": 1.0e20, "radiusM": 1.0e5, "positionM": {**base, "x": base["x"] + x},
                "velocityMPerS": {"x": vx, "y": 0.0, "z": 0.0}, "colorHex": "#aaaaaa", "material": {"profileId": "silicate-rock", "layers": None}})
            assert r.status_code == 201, r.text
        out = client.post(f"/api/v1/universes/{uid}/step?activationEpoch={epoch}", json={"dtS": 3600.0}).json()
        assert [e["type"] for e in out["events"]] == ["contact"] and out["warnings"] == ["collision_stopped"]
        assert out["simulationTimeS"] == pytest.approx(450.0, rel=1.0e-3)  # 1.8e6 m of gap at 4 km/s
        names = [b["name"] for b in out["bodies"]]
        assert names.count("p") == names.count("q") == 1
        assert all(k not in b for b in out["bodies"] for k in ("representation", "originEventId", "debris", "fragmentClass"))
        assert {e["type"] for e in client.get(f"/api/v1/universes/{uid}/events").json()["events"]} == {"contact"}
        assert client.get(f"/api/v1/universes/{uid}/collisions").json()["records"] == []
        assert "escaped" not in out["diagnostics"]
        assert universes.get_registry().get(uid).engine.collision_records() == []
