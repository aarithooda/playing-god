"""Stage 1: pre-impact capture and impact geometry (backend/impact/geometry.py).

Expected values come from construction (analytic straight-line fixtures built backwards from a chosen contact state) and
from Kepler's equation (the curved-path fixture), never from the code under test. Tolerances: contact distance 1e-9 relative
for straight lines (plan 9.2); for a curved path the rewind error is bounded by the curvature budget (the service keeps
a_rel dt^2/8 <= 1 % of the contact distance per chunk; the stress tests use 0.02 R with a 2x margin, so does this file).
"""
import math

import pytest

import backend.impact.engine as engine_module
from backend.collisions import contact_time_estimate
from backend.impact.config import CollisionConfig
from backend.impact.geometry import NEARBY_HILL_FACTOR, assign_roles, capture_impact, environment
from backend.impact.models.perfect_merge import PairBody
from backend.simulation import G_SI, SimulationService
from tests.impact import legacy_scenarios as ls

G = G_SI
M_T, M_P, R_T, R_P = 1.0e12, 1.0e9, 6.0, 2.0
T_CONTACT, TAU = 100.0, 0.2


def sub(a, b):
    return [x - y for x, y in zip(a, b)]


def add(a, b):
    return [x + y for x, y in zip(a, b)]


def scl(a, s):
    return [x * s for x in a]


def nrm(a):
    return math.sqrt(sum(c * c for c in a))


def straight_pair(b, speed=1000.0, v_target=(3.0, -4.0, 5.0), x_target=(1.0e6, -2.0e6, 3.0e5), swap=False):
    """A projectile arriving with impact parameter b = sin(theta) and relative speed `speed`, built from the contact state:
    at t_c the centres are R = R_t + R_p apart along n = (sqrt(1-b^2), b, 0) and the relative velocity is (-speed, 0, 0),
    so n . u_hat = -sqrt(1-b^2) < 0 (approaching) and |n x u_hat| = b. Returns the bodies at the detection time
    t_c + TAU and the analytic contact quantities."""
    n = [math.sqrt(1.0 - b * b), b, 0.0]
    u = [-speed, 0.0, 0.0]
    big_r = R_T + R_P
    v_p = add(list(v_target), u)
    tgt_at_contact = list(x_target)
    prj_at_contact = add(tgt_at_contact, scl(n, big_r))
    tgt_d = add(tgt_at_contact, scl(list(v_target), TAU))
    prj_d = add(prj_at_contact, scl(v_p, TAU))
    target = PairBody("target", M_T, R_T, tuple(tgt_d), tuple(v_target))
    projectile = PairBody("projectile", M_P, R_P, tuple(prj_d), tuple(v_p))
    first, second = (projectile, target) if swap else (target, projectile)
    truth = {"n": n, "tgt_c": tgt_at_contact, "prj_c": prj_at_contact, "u": u, "R": big_r,
             "contact_point": add(tgt_at_contact, scl(n, R_T))}
    return first, second, truth


EPS = 2.0 ** -52
NEAR, FAR = (0.0, 0.0, 0.0), (1.0e6, -2.0e6, 3.0e5)


def direction_tolerance(x_target) -> float:
    """Doubles resolve a position of size |x| to ~|x| * 2^-52, which limits the direction of an R-sized separation:
    exact (1e-12) near the origin, ulp-limited far from it (documented in API_CONTRACT 'Physics limitations')."""
    return 1.0e-12 + 16 * EPS * max(abs(c) for c in x_target) / (R_T + R_P)


@pytest.mark.parametrize("x_target", [NEAR, FAR], ids=["near-origin", "far-from-origin"])
@pytest.mark.parametrize("swap", [False, True])
@pytest.mark.parametrize("b", [0.0, 0.5, 0.9])
def test_straight_line_impact_matches_the_analytic_construction(b, swap, x_target):
    first, second, truth = straight_pair(b, swap=swap, x_target=x_target)
    tol_dir = direction_tolerance(x_target)
    impact, warnings = capture_impact(first, second, T_CONTACT + TAU, 0.5, [], True, contact_time_estimate, G)
    assert warnings == []
    # roles: the more massive body is the target whatever the detector order was
    assert (impact.target.id, impact.projectile.id) == ("target", "projectile")
    # contact time and the linear rewind
    assert impact.contact_time_estimated and impact.contact_time_s == pytest.approx(T_CONTACT, abs=1e-9 * T_CONTACT)
    assert impact.rewind_s == pytest.approx(TAU, abs=1e-9 * T_CONTACT)
    tgt_c, prj_c = impact.target.position_m.as_tuple(), impact.projectile.position_m.as_tuple()
    assert nrm(sub(tgt_c, truth["tgt_c"])) <= 1e-9 * truth["R"] + 1e-6  # absolute floor: positions are ~1e6 m
    assert nrm(sub(prj_c, truth["prj_c"])) <= 1e-9 * truth["R"] + 1e-6
    # contact distance, contact point on BOTH surfaces
    assert nrm(sub(prj_c, tgt_c)) == pytest.approx(truth["R"], rel=1e-9)
    cp = impact.contact_point_m.as_tuple()
    assert nrm(sub(cp, tgt_c)) == pytest.approx(R_T, rel=1e-9)
    assert nrm(sub(cp, prj_c)) == pytest.approx(R_P, rel=1e-9)
    assert nrm(sub(cp, truth["contact_point"])) <= 1e-9 * truth["R"] + 1e-6
    # normal, angle, impact parameter (b = sin theta)
    assert nrm(sub(impact.contact_normal.as_tuple(), truth["n"])) <= max(1e-9, 4 * tol_dir)
    assert impact.impact_parameter == pytest.approx(b, abs=tol_dir)
    assert impact.impact_angle_deg == pytest.approx(math.degrees(math.asin(b)), abs=max(1e-9, 100 * tol_dir))
    # relative velocity, speed, derived energies
    assert impact.impact_speed_m_per_s == pytest.approx(1000.0, rel=1e-12)
    assert nrm(sub(impact.relative_velocity_m_per_s.as_tuple(), truth["u"])) <= 1e-9
    total, mu = M_T + M_P, M_T * M_P / (M_T + M_P)
    assert impact.total_mass_kg == total and impact.reduced_mass_kg == pytest.approx(mu, rel=1e-15)
    assert impact.mass_ratio == M_P / M_T
    assert impact.pair_kinetic_energy_com_j == pytest.approx(0.5 * mu * 1000.0 ** 2, rel=1e-12)
    assert impact.specific_impact_energy_j_per_kg == pytest.approx(0.5 * mu * 1000.0 ** 2 / total, rel=1e-12)
    # momentum of the pair (inertial frame) and orbital angular momentum about the pair centre of mass
    v_t = (3.0, -4.0, 5.0)
    p = [M_T * v_t[k] + M_P * (v_t[k] + truth["u"][k]) for k in range(3)]
    assert nrm(sub(impact.pair_momentum_kg_m_per_s.as_tuple(), p)) <= 1e-12 * nrm(p)
    r_rel, u = sub(prj_c, tgt_c), truth["u"]
    l_expected = scl([r_rel[1] * u[2] - r_rel[2] * u[1], r_rel[2] * u[0] - r_rel[0] * u[2], r_rel[0] * u[1] - r_rel[1] * u[0]], mu)
    l_got = impact.pair_orbital_angular_momentum_com_kg_m2_per_s.as_tuple()
    assert nrm(sub(l_got, l_expected)) <= 1e-9 * max(nrm(l_expected), 1.0)
    # escape speeds: the physical-radii form and LS12's R_C1 form (rho_1 = 1000 kg m^-3), both recorded
    assert impact.mutual_escape_speed_m_per_s.physical_radii == pytest.approx(math.sqrt(2 * G * total / truth["R"]), rel=1e-12)
    r_c1 = (3 * total / (4 * math.pi * 1000.0)) ** (1 / 3)
    assert impact.mutual_escape_speed_m_per_s.ls12_rc1 == pytest.approx(math.sqrt(2 * G * total / r_c1), rel=1e-12)
    # no rotation tracked yet (Stage 2): local directions equal the inertial ones, no latitude/longitude
    assert impact.contact_lat_lon_deg.target is None and impact.spin_axis_angle_deg is None
    assert impact.contact_point_local.target.as_tuple() == impact.contact_normal.as_tuple()
    assert impact.target.spin_rad_per_s is None and impact.target.material_profile is None


def test_a_head_on_impact_has_zero_impact_parameter_and_a_grazing_one_is_near_one():
    head_on, _ = capture_impact(*straight_pair(0.0)[:2], T_CONTACT + TAU, 0.5, [], True, contact_time_estimate, G)
    graze, _ = capture_impact(*straight_pair(0.999)[:2], T_CONTACT + TAU, 0.5, [], True, contact_time_estimate, G)
    assert head_on.impact_parameter == 0.0 and head_on.impact_angle_deg == 0.0
    assert graze.impact_parameter == pytest.approx(0.999, abs=direction_tolerance(FAR)) and graze.impact_angle_deg > 87.0


def test_equal_masses_choose_the_smaller_id_as_target():
    a = PairBody("b-body", 5.0, 1.0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    b = PairBody("a-body", 5.0, 1.0, (2.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    assert assign_roles(a, b)[0].id == "a-body" and assign_roles(b, a)[0].id == "a-body"
    heavier = PairBody("z", 6.0, 1.0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    assert assign_roles(a, heavier)[0].id == "z"


def test_a_pair_with_no_contact_root_uses_the_detection_state_and_says_so():
    """Bodies already deep inside each other at the detection time and moving apart: no root in the last step."""
    t = PairBody("t", 1e12, 5.0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    p = PairBody("p", 1e9, 1.0, (3.0, 0.0, 0.0), (10.0, 0.0, 0.0))
    impact, warnings = capture_impact(t, p, 50.0, 0.1, [], True, contact_time_estimate, G)
    assert "contact_time_not_estimable" in warnings and "not_approaching_at_contact" in warnings
    assert not impact.contact_time_estimated and impact.contact_time_s == impact.detection_time_s == 50.0 and impact.rewind_s == 0.0


def test_a_pair_at_rest_records_a_zero_relative_velocity_instead_of_inventing_an_angle():
    t = PairBody("t", 1e12, 5.0, (0.0, 0.0, 0.0), (1.0, 1.0, 1.0))
    p = PairBody("p", 1e9, 1.0, (5.5, 0.0, 0.0), (1.0, 1.0, 1.0))
    impact, warnings = capture_impact(t, p, 10.0, 0.1, [], True, contact_time_estimate, G)
    assert "relative_velocity_zero" in warnings
    assert impact.impact_speed_m_per_s == 0.0 and impact.impact_parameter == 0.0 and impact.specific_impact_energy_j_per_kg == 0.0


def test_non_physical_bodies_are_rejected_not_repaired():
    t = PairBody("t", 0.0, 5.0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    p = PairBody("p", 1e9, 1.0, (5.5, 0.0, 0.0), (0.0, 0.0, 0.0))
    with pytest.raises(ValueError):
        capture_impact(t, p, 10.0, 0.1, [], True, contact_time_estimate, G)


# ---------------------------------------------------------------------------------------------------------------
# Environment: dominant attractor, Hill radius, nearby bodies
# ---------------------------------------------------------------------------------------------------------------
def test_environment_picks_the_dominant_attractor_hill_radius_and_nearby_bodies():
    pair = (PairBody("t", 6.0e24, 6.4e6, (0.0, 0.0, 0.0), (0, 0, 0)), PairBody("p", 1.0e22, 1.0e6, (7.0e6, 0.0, 0.0), (0, 0, 0)))
    sun = PairBody("sun", 2.0e30, 7.0e8, (1.5e11, 0.0, 0.0), (0, 0, 0))
    moon = PairBody("moon", 7.3e22, 1.7e6, (3.8e8, 0.0, 0.0), (0, 0, 0))
    far = PairBody("far", 1.0e20, 1.0e5, (0.0, 9.0e12, 0.0), (0, 0, 0))
    env = environment(pair, [far, sun, moon], G)
    total = 6.0e24 + 1.0e22
    com = (1.0e22 * 7.0e6) / total
    d = 1.5e11 - com
    # m/d^2: sun 2e30/(1.5e11)^2 = 8.9e7, moon 7.3e22/(3.8e8)^2 = 5.1e5, far 1e20/(9e12)^2 = 1.2e-6
    assert env.dominant_attractor_id == "sun"
    hill = d * (total / (3 * 2.0e30)) ** (1 / 3)  # ~1.5e9 m
    assert env.hill_radius_m == pytest.approx(hill, rel=1e-12)
    assert NEARBY_HILL_FACTOR == 3.0 and 3.8e8 < NEARBY_HILL_FACTOR * hill < 1.5e11
    assert env.nearby_body_ids == ("moon",)  # inside 3 Hill radii; the sun (1.5e11 m) and the far body are not


def test_environment_of_an_isolated_pair_is_empty():
    pair = (PairBody("t", 1.0e10, 5.0, (0.0, 0.0, 0.0), (0, 0, 0)), PairBody("p", 1.0e9, 1.0, (6.0, 0.0, 0.0), (0, 0, 0)))
    env = environment(pair, [], G)
    assert env.dominant_attractor_id is None and env.hill_radius_m is None and env.nearby_body_ids == ()


# ---------------------------------------------------------------------------------------------------------------
# End to end: the record produced by the service
# ---------------------------------------------------------------------------------------------------------------
def deferred() -> SimulationService:
    return SimulationService(CollisionConfig(mode="outcome-v1"))


def test_capture_happens_before_the_merge_mutates_anything(monkeypatch):
    """F1-PRE: the ImpactState is built from the unmerged particles. A spy reads the live particles at capture time."""
    seen = []
    real = engine_module.capture_impact

    def spy(first, second, *args, **kwargs):
        seen.append(({p.name: p.m for p in svc._sim.particles}, len(svc._sim.particles)))
        return real(first, second, *args, **kwargs)

    svc = deferred()
    monkeypatch.setattr(engine_module, "capture_impact", spy)
    bodies, steps = ls.probe_into_heavy(False)
    svc.load_bodies(bodies, history_mode="step")
    svc.step(steps[0])
    (masses, n), = seen
    assert masses == {"heavy": 1e12, "probe": 1.0} and n == 2  # not yet merged when the state was frozen
    (record,) = svc.collision_records()
    assert record.input.impact.target.mass_kg == 1e12 and record.input.impact.projectile.mass_kg == 1.0
    assert svc.snapshot().bodies[0].massKg == 1e12 + 1.0


def test_record_of_a_merge_links_to_the_legacy_event_and_carries_the_fidelity_and_reasons():
    svc = deferred()
    bodies, steps = ls.probe_into_heavy(False)
    svc.load_bodies(bodies, history_mode="step")
    svc.step(steps[0])
    (event,) = svc.events()
    (record,) = svc.collision_records()
    assert event.id == "evt-1" and record.event_id == "col-1" and record.legacy_event_id == "evt-1"
    assert record.root_event_id == "col-1" and record.parent_event_id is None and record.generation == 0
    assert record.outcome_spec.outcome == "legacy_merge" and record.outcome_spec.model_id == "perfect_merge"
    assert "material_unspecified" in record.warnings  # DQ-2: the label lives in the record, not on the merger event
    assert any("material_unspecified" in r for r in record.selection_reasons)
    assert record.result is None and record.input_digest == record.input.input_digest == record.input.compute_digest()
    assert set(record.fidelity) >= {"outcome", "remnantState"}
    assert not hasattr(event, "warnings")  # the merger event shape is unchanged


def test_the_seed_is_content_addressed():
    from backend.impact.records import derive_seed
    svc = deferred()
    bodies, steps = ls.probe_into_heavy(False)
    svc.load_bodies(bodies, history_mode="step")
    svc.step(steps[0])
    impact = svc.collision_records()[0].input.impact
    a = derive_seed(12345, impact, "perfect_merge", "1")
    assert a == derive_seed(12345, impact, "perfect_merge", "1") == svc.collision_records()[0].input.seed
    assert a != derive_seed(12346, impact, "perfect_merge", "1") and a != derive_seed(12345, impact, "perfect_merge", "2")
    assert 0 <= a < 2 ** 63


def kepler_contact_relative_position(m1, m2, a, e, big_r):
    """Relative position (body 2 - body 1) at the moment the centres are R apart, for the apoapsis start of
    tests/test_stress_p003.py (body 1 at -x, counter-clockwise), from Kepler's equation."""
    gm = G * (m1 + m2)
    n = math.sqrt(gm / a ** 3)
    cos_e = (1 - big_r / a) / e
    e_c = 2 * math.pi - math.acos(cos_e)  # eccentric anomaly in (pi, 2 pi): on the way from apoapsis to periapsis
    t_c = (e_c - e * math.sin(e_c) - math.pi) / n
    b = a * math.sqrt(1 - e * e)
    return t_c, (-a * (math.cos(e_c) - e), -b * math.sin(e_c), 0.0)


def test_curved_path_contact_point_is_within_the_curvature_budget():
    """e = 0.9 binary merging near periapsis (strongly curved, accelerating). The straight-line rewind of the record is
    compared with the true relative position from Kepler's equation: the error stays within 0.02 R (the 1 % curvature
    criterion with a 2x margin, as in the stress tests)."""
    bodies, steps = ls.kepler_merge()
    svc = deferred()
    svc.load_bodies(bodies, history_mode="step")
    svc.step(steps[0])
    (record,) = svc.collision_records()
    m1, m2, a, e, big_r = 5e12, 1e12, 1000.0, 0.9, 150.0
    t_true, rel_true = kepler_contact_relative_position(m1, m2, a, e, big_r)
    impact = record.input.impact
    assert (impact.target.id, impact.projectile.id) == ("one", "two")
    rel = sub(impact.projectile.position_m.as_tuple(), impact.target.position_m.as_tuple())
    assert nrm(rel) == pytest.approx(big_r, rel=1e-9)  # exactly R by construction of the straight-line root
    v_contact = math.sqrt(G * (m1 + m2) * (2 / big_r - 1 / a))
    assert abs(impact.contact_time_s - t_true) <= 0.02 * big_r / v_contact
    assert nrm(sub(rel, rel_true)) <= 0.02 * big_r, (rel, rel_true)
    assert impact.chunk_criterion_satisfied


def test_environment_names_the_planet_when_a_small_pair_collides_next_to_it():
    """Two 100 m bodies close head-on 5e7 m from a planet that orbits a star: the planet (6e24 / (5e7)^2 = 2.4e9) beats the star
    (2e30 / (1.5e11)^2 = 8.9e7) as the dominant attractor of the pair, the same rule `has_satellites` uses."""
    star = ls.body("star", 2.0e30, 7.0e8)
    planet = ls.body("planet", 6.0e24, 6.4e6, (1.5e11, 0.0, 0.0), (0.0, 29780.0, 0.0))
    a = ls.body("a", 1.0e15, 100.0, (1.5e11 + 5.0e7, -300.0, 0.0), (0.0, 29780.0 + 100.0, 0.0))
    b = ls.body("b", 1.0e15, 100.0, (1.5e11 + 5.0e7, 300.0, 0.0), (0.0, 29780.0 - 100.0, 0.0))
    svc = deferred()
    svc.load_bodies([star, planet, a, b], history_mode="step")
    svc.step(4.0)
    (record,) = svc.collision_records()
    env = record.input.impact.environment
    assert env.dominant_attractor_id == "planet"
    assert env.hill_radius_m is not None and 0 < env.hill_radius_m < 5.0e7
