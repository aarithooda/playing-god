"""Stage 6: body-local impact sites and the reduced-order disturbance front (D-050).

Scientific content PROVISIONAL / APPROXIMATION (D-038, D-050). No shipped profile has a verified wave speed, so every shipped profile
takes the STATIC fallback; the supported path is exercised with an explicitly SYNTHETIC test profile (not a measurement, labelled so).
"""
import dataclasses
import json
import math

import pytest
from fastapi.testclient import TestClient

from backend import universes
from backend.impact import damage
from backend.impact import rotation as rot
from backend.impact.applier import realise, validate_result
from backend.impact.contracts import ImpactSite, MaterialProfile, Provenance, RotationState, Vec3
from backend.impact.materials import list_profiles
from backend.impact.models.provisional import ITEMS
from backend.impact.selector import Selector
from backend.main import app
from backend.simulation import SimulationFailure
import backend.impact.engine as engine_module
from tests.helpers import dump, make
from tests.impact.scenarios import G, make_input, profile
from tests.impact.test_engine_outcomes import ROCK, deferred, pair_service, run_and_check_conservation

SEL = Selector(G)
SYNTHETIC_SPEED = 3000.0


def synthetic_profile(**changes) -> MaterialProfile:
    """TEST ONLY: silicate rock with an invented wave speed and a provenance entry saying so. It is not a measurement."""
    base = profile("silicate-rock")
    entry = Provenance("waveSpeedMPerS", SYNTHETIC_SPEED, "synthetic value for tests, NOT a measurement", None, "literature")
    return dataclasses.replace(base, wave_speed_m_per_s=SYNTHETIC_SPEED, provenance=(*base.provenance, entry), **changes)


def site(c=SYNTHETIC_SPEED, t=100.0, centre=(0.0, 0.0, -1.0), inner=1.0e5, energy=1.0e20, att=None) -> ImpactSite:
    sites, _ = damage.build_sites(make_input(m_t=1.0e24, m_p=5.0e22, r_t=2.0e6, v_over_esc=1.5, target=synthetic_profile(), projectile=profile()), "partial_accretion", synthetic_profile(),
                                  profile(), True, False)
    base = sites[0]
    return dataclasses.replace(
        base, time_s=t, center_local=Vec3(*centre), energy_j=energy,
        damage_profile=dataclasses.replace(base.damage_profile, inner_radius_m=inner),
        propagation=dataclasses.replace(base.propagation, wave_speed_m_per_s=c, attenuation_length_m=att, antipodal_focusing=c is not None))


# ------------------------------------------------------------------------------------------------ support per profile
def test_every_shipped_profile_is_static_because_none_has_a_sourced_wave_speed():
    """The honest state of the registry: no wave speed has been sourced for any profile (D-050), so none is invented or borrowed."""
    profiles = list_profiles()
    assert len(profiles) == 5
    for p in profiles:
        s = damage.propagation_support(p)
        assert p.wave_speed_m_per_s is None and not s.supported and s.wave_speed_m_per_s is None
        assert "static" in s.reason and "wave speed" in s.reason


def test_a_wave_speed_with_literature_provenance_is_supported():
    s = damage.propagation_support(synthetic_profile())
    assert s.supported and s.wave_speed_m_per_s == SYNTHETIC_SPEED


@pytest.mark.parametrize("bad", [math.inf, math.nan, -5.0, 0.0])
def test_an_invalid_wave_speed_is_static_not_repaired(bad):
    p = synthetic_profile()
    object.__setattr__(p, "wave_speed_m_per_s", bad)  # the contract refuses these at construction; this is the defence in depth
    s = damage.propagation_support(p)
    assert not s.supported and s.wave_speed_m_per_s is None and "not a finite positive number" in s.reason


def test_a_wave_speed_without_matching_non_engineering_provenance_is_static():
    base = profile("silicate-rock")
    no_entry = dataclasses.replace(base, wave_speed_m_per_s=3000.0)
    engineering = dataclasses.replace(base, wave_speed_m_per_s=3000.0, provenance=(*base.provenance, Provenance("waveSpeedMPerS", 3000.0, "guess", None, "engineering")))
    mismatch = dataclasses.replace(base, wave_speed_m_per_s=3000.0, provenance=(*base.provenance, Provenance("waveSpeedMPerS", 2000.0, "paper", None, "literature")))
    for p in (no_entry, engineering, mismatch):
        s = damage.propagation_support(p)
        assert not s.supported and "provenance" in s.reason
    assert not damage.propagation_support(None).supported


# ------------------------------------------------------------------------------------------------ the pure model
def test_the_antipode_is_reached_at_pi_r_over_c_and_the_front_is_monotone():
    s, r = site(), 6.4e6
    assert damage.arrival_time_s(s, r, math.pi) == pytest.approx(s.time_s + math.pi * r / SYNTHETIC_SPEED, rel=1e-12)
    assert damage.arrival_time_s(s, r, 0.0) == s.time_s
    fronts = [damage.front_angle_rad(s, r, s.time_s + k * 200.0) for k in range(-2, 40)]
    assert fronts[0] == 0.0 and fronts[1] == 0.0  # nothing before the event
    assert all(b >= a for a, b in zip(fronts, fronts[1:])) and fronts[-1] == math.pi
    t_half = s.time_s + 0.5 * math.pi * r / SYNTHETIC_SPEED
    assert damage.front_angle_rad(s, r, t_half) == pytest.approx(math.pi / 2, rel=1e-12)


def test_the_antipode_has_no_disturbance_before_the_front_arrives_and_a_focused_one_after():
    s, r = site(centre=(0.0, 0.0, -1.0)), 6.4e6
    antipode = Vec3(0.0, 0.0, 1.0)
    t_arrive = damage.arrival_time_s(s, r, math.pi)
    before = damage.sample_surface(s, r, antipode, t_arrive * (1 - 1e-9))
    assert before["arrived"] is False and before["spreadingFactor"] == 0.0 and before["state"] == "propagating"
    at = damage.sample_surface(s, r, antipode, t_arrive * (1 + 1e-9))
    assert at["arrived"] is True and at["state"] == "completed"
    quarter = damage.sample_surface(s, r, Vec3(1.0, 0.0, 0.0), t_arrive * 2)
    assert at["spreadingFactor"] > quarter["spreadingFactor"] > 0.0  # antipodal focusing: the factor rises again toward pi
    assert not math.isinf(at["spreadingFactor"])  # regularised, finite at the antipode


def test_the_spreading_factor_decreases_with_distance_up_to_the_quarter_circle_and_is_one_at_the_footprint_edge():
    s, r = site(inner=2.0e5), 6.4e6
    d_ref = 2.0e5 / r
    assert damage.spreading_factor(s, r, d_ref) == pytest.approx(1.0, rel=1e-12)
    angles = [d_ref * (1 + 0.5 * k) for k in range(0, 200) if d_ref * (1 + 0.5 * k) <= math.pi / 2]
    vals = [damage.spreading_factor(s, r, a) for a in angles]
    assert all(b <= a + 1e-15 for a, b in zip(vals, vals[1:]))


def test_the_local_damage_proxy_is_localized_and_monotone():
    s, r = site(inner=1.0e5), 6.4e6
    near = damage.local_falloff(s, r, 0.5e5 / r)
    angles = [k * 0.01 for k in range(0, 315)]
    vals = [damage.local_falloff(s, r, a) for a in angles]
    assert near == 1.0 and vals[0] == 1.0 and all(b <= a for a, b in zip(vals, vals[1:]))
    assert vals[-1] < 0.02  # far from the site the proxy is small: the damage is localized, not global


def test_a_static_site_has_a_local_proxy_and_no_front():
    s = site(c=None)
    out = damage.sample_surface(s, 6.4e6, Vec3(0.0, 0.0, 1.0), s.time_s + 1.0e6)
    assert out["state"] == "static" and out["front"] is None and out["arrived"] is None and out["spreadingFactor"] is None
    assert damage.front_angle_rad(s, 6.4e6, 1.0e9) is None and damage.arrival_time_s(s, 6.4e6, math.pi) is None
    assert damage.sample_surface(s, 6.4e6, Vec3(0.0, 0.0, 1.0), s.time_s - 1.0)["state"] == "not_yet"


def test_the_site_list_is_bounded_and_the_aggregate_is_labelled_and_conserves_energy():
    base = site(c=None)
    many = [dataclasses.replace(base, site_id=f"site-{k}-0", energy_j=float(k + 1), time_s=float(k)) for k in range(70)]
    out = damage.merge_sites(many, "agg-test")
    assert len(out) == damage.MAX_SITES_PER_BODY
    assert sum(s.energy_j for s in out) == pytest.approx(sum(s.energy_j for s in many), rel=1e-12)
    agg = [s for s in out if s.site_id.startswith("agg-")]
    assert len(agg) >= 1 and all(s.propagation.wave_speed_m_per_s is None for s in agg)


def test_the_new_assumptions_are_registered_as_provisional():
    for key in ("PROP-geodesic-front", "DMG-falloff-exponent", "PROP-regularisation"):
        assert key in ITEMS and ITEMS[key].status == "engineering"
    assert "PROP-geodesic-front" in damage.arrival_time_s.__provisional__ or damage.arrival_time_s.__provisional__ == "PROP-geodesic-front"


# ------------------------------------------------------------------------------------------------ sites in results
def test_the_realiser_adds_a_static_site_with_every_limit_stated():
    data = make_input(m_t=1.0e24, m_p=5.0e22, r_t=2.0e6, v_over_esc=1.5)
    spec = SEL.select(data).spec
    res = realise(data, spec, G)
    (target_site,) = res.impact_sites
    assert target_site.body_id == "target" and target_site.propagation.wave_speed_m_per_s is None and not target_site.propagation.antipodal_focusing
    assert target_site.crater_radius_m == 0.0 and target_site.transient_depth_m == 0.0 and target_site.ejecta_cone.half_angle_deg == 90.0
    for w in (damage.STATIC_WARNING, damage.CRATER_WARNING, damage.PROFILE_WARNING):
        assert w in res.warnings
    assert res.fidelity["siteCraterSize"].value == "unsupported" and res.fidelity["sitePropagation"].value == "unsupported"
    assert target_site.damage_profile.inner_radius_m == data.impact.projectile.radius_m  # the footprint scale is geometric
    assert target_site.energy_j == data.impact.pair_kinetic_energy_com_j
    validate_result(res, {"target", "projectile"}, data)


def test_a_supported_profile_gives_a_propagating_site():
    data = make_input(m_t=1.0e24, m_p=5.0e22, r_t=2.0e6, v_over_esc=1.5, target=synthetic_profile())
    res = realise(data, SEL.select(data).spec, G)
    (s,) = res.impact_sites
    assert s.propagation.wave_speed_m_per_s == SYNTHETIC_SPEED and s.propagation.antipodal_focusing
    assert damage.STATIC_WARNING not in res.warnings and res.fidelity["sitePropagation"].value == "approximation"


def test_hit_and_run_marks_both_bodies_and_disruption_supersedes_the_sites():
    hr = make_input(m_t=1.0e24, m_p=2.0e23, r_t=2.0e6, v_over_esc=2.0, b=0.8)
    spec = SEL.select(hr).spec
    res = realise(hr, spec, G)
    if spec.outcome == "hit_and_run":
        assert {s.body_id for s in res.impact_sites} == {"target", "projectile"}
    dis = make_input(m_t=1.0e24, m_p=1.0e24, r_t=2.0e6, v_over_esc=8.0, b=0.0)
    dspec = SEL.select(dis).spec
    assert dspec.outcome in ("catastrophic_disruption", "super_catastrophic_disruption")
    assert realise(dis, dspec, G).impact_sites == ()


def test_a_gas_target_has_no_solid_surface_to_mark():
    from tests.impact.scenarios import gas_profile

    data = make_input(m_t=1.0e25, m_p=1.0e23, r_t=3.0e6, v_over_esc=1.5, target=gas_profile(1.0), projectile="rock")
    assert realise(data, SEL.select(data).spec, G).impact_sites == ()


def test_sites_round_trip_through_the_serialisation_contract():
    s = site()
    again = ImpactSite.from_dict(json.loads(json.dumps(s.to_dict())))
    assert again == s and again.to_dict() == s.to_dict()
    data = make_input(m_t=1.0e24, m_p=5.0e22, r_t=2.0e6, v_over_esc=1.5)
    res = realise(data, SEL.select(data).spec, G)
    again = type(res).from_dict(json.loads(json.dumps(res.to_dict())))
    assert again.impact_sites == res.impact_sites and again.compute_digest() == res.compute_digest()


# ------------------------------------------------------------------------------------------------ through the engine
def south_pole_service():
    """A rotating rocky target (spin +z) hit from -z by a small body: the site must be at latitude -90 degrees."""
    svc = deferred()
    omega = 2.0e-4
    svc.add_body(make("target", m=1.0e22, r=1.0e6, material=ROCK, spinRadPerS={"x": 0.0, "y": 0.0, "z": omega}))
    svc.add_body(make("projectile", m=1.0e17, r=2.0e4, x=(0.0, 0.0, -3.0e6), v=(0.0, 0.0, 1.5e3), material=ROCK))
    return svc, omega


def target_site_of(svc):
    (tid,) = [bid for bid, v in svc._sites.items() if svc._materials.get(bid) is not None and svc._sites[bid]]
    return tid, svc._sites[tid][0]


def test_the_south_pole_fixture_puts_the_site_at_minus_ninety_degrees_and_keeps_it_attached():
    svc, omega = south_pole_service()
    svc.step(2.5e3)
    assert [e.type for e in svc.events()] == ["collision"]
    tid, s = target_site_of(svc)
    lat = math.degrees(math.asin(max(-1.0, min(1.0, s.center_local.z))))
    assert lat == pytest.approx(-90.0, abs=1.0e-6)
    state = svc._rotations[tid]
    omega = state.omega_rad_per_s.z  # the remnant's own spin (the impact changed it slightly)
    # a point on the equator is carried round by the rotation: after half a turn its world direction is the opposite one (1e-9)
    eq_local = (1.0, 0.0, 0.0)
    t0 = s.time_s
    w0, w1 = rot.to_world(state, t0, eq_local), rot.to_world(state, t0 + math.pi / omega, eq_local)
    assert math.dist(w1, (-w0[0], -w0[1], w0[2])) < 1.0e-9
    # the pole itself stays where it is in the world
    p0, p1 = rot.to_world(state, t0, s.center_local.as_tuple()), rot.to_world(state, t0 + math.pi / omega, s.center_local.as_tuple())
    assert math.dist(p0, p1) < 1.0e-9 and p0[2] == pytest.approx(-1.0, abs=1.0e-9)


def test_an_equatorial_site_follows_the_rotation_exactly():
    svc = deferred()
    omega = 2.0e-4
    svc.add_body(make("target", m=1.0e22, r=1.0e6, material=ROCK, spinRadPerS={"x": 0.0, "y": 0.0, "z": omega}))
    svc.add_body(make("projectile", m=1.0e17, r=2.0e4, x=(3.0e6, 0.0, 0.0), v=(-1.5e3, 0.0, 0.0), material=ROCK))
    svc.step(2.5e3)
    tid, s = target_site_of(svc)
    assert abs(s.center_local.z) < 1e-3  # on the equator
    state = svc._rotations[tid]
    omega = state.omega_rad_per_s.z
    world0 = rot.to_world(state, s.time_s, s.center_local.as_tuple())
    assert world0[0] == pytest.approx(1.0, abs=1.0e-3)  # the projectile came from +x: the site faces +x in the world at contact
    world_half = rot.to_world(state, s.time_s + math.pi / omega, s.center_local.as_tuple())
    assert math.dist(world_half, (-world0[0], -world0[1], world0[2])) < 1.0e-9


def test_sites_change_no_mass_momentum_or_angular_momentum():
    """F3-AC-5: the whole universe conserves exactly as before; the sites are records, not forces."""
    svc, _ = south_pole_service()
    out = run_and_check_conservation(svc, dt=2.5e3)
    assert svc._sites and out.events[0].type == "collision"


def test_the_engine_sites_are_static_and_say_so_for_every_shipped_profile():
    svc, _ = south_pole_service()
    svc.step(2.5e3)
    _, s = target_site_of(svc)
    assert s.propagation.wave_speed_m_per_s is None and s.crater_radius_m == 0.0
    ev = svc.events()[0]
    assert damage.STATIC_WARNING in ev.warnings and damage.CRATER_WARNING in ev.warnings
    record = svc.collision_records()[0]
    assert record.result.impact_sites == (s,)


def test_sites_follow_snapshot_restore_reset_derive_rollback_and_deletion():
    svc, _ = south_pole_service()
    before = svc.capture_snapshot()
    svc.step(2.5e3)
    tid, s = target_site_of(svc)
    after = svc.capture_snapshot()
    assert after.sites == {tid: (s,)} and after.digest != before.digest and before.sites == {}
    svc.restore_snapshot(before)
    assert svc._sites == {}
    svc.restore_snapshot(after)
    assert svc._sites == {tid: (s,)}
    from backend.simulation import SimulationService

    derived = SimulationService.from_snapshot(after, history_mode="step")
    assert derived._sites == svc._sites and derived._sites is not svc._sites
    svc.add_body(make("bystander", m=1.0e10, r=1.0, x=(1.0e12, 1.0e12, 0.0)))
    svc.delete_body(tid)
    assert svc._sites == {}
    svc.reset()
    assert svc._sites == {}


def test_a_failed_step_leaves_no_site_behind(monkeypatch):
    svc, _ = south_pole_service()
    before = dump(svc)

    def explode(result, state):
        state.sites[result.impact_sites[0].body_id] = result.impact_sites  # mutate first, then fail
        raise RuntimeError("injected during application")

    monkeypatch.setattr(engine_module, "apply_result", explode)
    with pytest.raises(SimulationFailure):
        svc.step(2.5e3)
    monkeypatch.undo()
    assert dump(svc) == before and svc._sites == {}


def test_a_universe_without_sites_keeps_its_digest():
    """The digest gains the sites only when some exist (as for materials and products)."""
    from backend.simulation import _digest

    svc = deferred()
    svc.add_body(make("x", m=1e20, r=1e3))
    snap = svc.capture_snapshot()
    args = (svc._sim, svc._meta, svc._history.mode, svc._history.sample_interval_s, svc._materials, svc._rotations, svc._products)
    assert snap.digest == _digest(*args) == _digest(*args, {}) == _digest(*args, None)


def test_a_material_less_pair_never_gets_a_site():
    svc = deferred()
    svc.add_body(make("a", m=1.0e22, r=1.0e6))
    svc.add_body(make("b", m=1.0e17, r=2.0e4, x=(3.0e6, 0.0, 0.0), v=(-1.5e3, 0.0, 0.0)))
    svc.step(2.5e3)
    assert [e.type for e in svc.events()] == ["merger"] and svc._sites == {}


# ------------------------------------------------------------------------------------------------ API
@pytest.fixture
def client():
    return TestClient(app)


def test_the_materials_route_states_support_per_profile(client):
    j = client.get("/api/v1/materials").json()
    assert set(j["propagation"]) == {p["id"] for p in j["profiles"]}
    assert all(v["supported"] is False and v["waveSpeedMPerS"] is None and "static" in v["reason"] for v in j["propagation"].values())


def test_the_surface_route_returns_static_sites_with_the_limitation_stated(client):
    uid = universes.DEFAULT_UNIVERSE_ID
    eng = universes.get_registry().get(uid).engine
    eng.add_body(make("target", m=1.0e22, r=1.0e6, material=ROCK, spinRadPerS={"x": 0.0, "y": 0.0, "z": 2.0e-4}))
    eng.add_body(make("projectile", m=1.0e17, r=2.0e4, x=(0.0, 0.0, -3.0e6), v=(0.0, 0.0, 1.5e3), material=ROCK))
    eng.step(2.5e3)
    tid = next(bid for bid, v in eng._sites.items() if v)
    j = client.get(f"/api/v1/universes/{uid}/bodies/{tid}/surface").json()
    assert j["schemaVersion"] == 1 and j["bodyId"] == tid and "not a resolved shock" in j["label"]
    (row,) = j["sites"]
    assert row["propagation"]["supported"] is False and row["propagation"]["state"] == "static"
    assert row["propagation"]["frontAngleRad"] is None and row["propagation"]["antipodeArrivalTimeS"] is None
    assert "disabled" in row["propagation"]["note"] and row["site"]["propagation"]["waveSpeedMPerS"] is None
    assert row["site"]["centerLocal"]["z"] == pytest.approx(-1.0, abs=1e-6)
    assert client.get(f"/api/v1/universes/{uid}/bodies/{tid}/surface?atTimeS=1e9").json()["evaluatedAtS"] == 1e9
    assert client.get(f"/api/v1/universes/{uid}/bodies/{tid}/surface?atTimeS=nan").status_code == 422


def test_the_surface_route_of_a_plain_body_is_empty_and_unknown_ids_are_404(client):
    uid = universes.DEFAULT_UNIVERSE_ID
    body = client.post("/api/v1/bodies", json={"name": "Plain", "massKg": 1e20, "radiusM": 1e5, "positionM": {"x": 0, "y": 0, "z": 0},
                                                "velocityMPerS": {"x": 0, "y": 0, "z": 0}, "colorHex": "#ffffff"}).json()
    j = client.get(f"/api/v1/universes/{uid}/bodies/{body['id']}/surface").json()
    assert j["sites"] == [] and j["bodyRadiusM"] == 1e5
    assert client.get(f"/api/v1/universes/{uid}/bodies/body-nope/surface").status_code == 404
    assert client.get("/api/v1/universes/uni-nope/bodies/x/surface").status_code == 404


def test_the_surface_route_supports_a_propagating_site(client):
    """A site carrying a (synthetic) wave speed is reported with a front and an antipode arrival time."""
    uid = universes.DEFAULT_UNIVERSE_ID
    eng = universes.get_registry().get(uid).engine
    body = eng.add_body(make("target", m=1.0e22, r=1.0e6, material=ROCK))
    s = site(t=10.0)
    eng._sites[body.id] = (dataclasses.replace(s, body_id=body.id),)
    j = client.get(f"/api/v1/universes/{uid}/bodies/{body.id}/surface?atTimeS=20").json()
    (row,) = j["sites"]
    assert row["propagation"]["supported"] and row["propagation"]["state"] == "propagating"
    assert row["propagation"]["frontAngleRad"] == pytest.approx(SYNTHETIC_SPEED * 10.0 / 1.0e6, rel=1e-12)
    assert row["propagation"]["antipodeArrivalTimeS"] == pytest.approx(10.0 + math.pi * 1.0e6 / SYNTHETIC_SPEED, rel=1e-12)
    assert client.get(f"/api/v1/universes/{uid}/bodies/{body.id}/surface?atTimeS=5").json()["sites"][0]["propagation"]["state"] == "not_yet"
