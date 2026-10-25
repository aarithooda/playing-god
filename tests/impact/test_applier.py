"""Stage 4a: realisation of outcomes into validated results (backend/impact/applier.py: realise, validate_result) — pure, per outcome class.
The outcome class is ASSERTED FROM THE MODEL (found by scanning the impact speed), never hard-coded to a speed range. Scientific content
is PROVISIONAL (D-038)."""
import dataclasses
import math

import pytest

from backend.impact import contracts as c
from backend.impact.applier import (DEBRIS_LAUNCH_FACTOR, ResultInvalid, realise, validate_result)
from backend.impact.selector import Selector
from tests.impact.scenarios import G, gas_profile, make_input, profile

SEL = Selector(G)
TOL = c.CollisionTolerances()


def find(outcome, scan=None, **geometry):
    """The first scenario (scanning v/v_esc) whose selected outcome is `outcome`."""
    grid = scan or [0.5 + 0.02 * k for k in range(0, 600)]
    for x in grid:
        data = make_input(v_over_esc=x, **geometry)
        sel = SEL.select(data)
        if sel.spec.outcome == outcome and not sel.fallback:
            return data, sel.spec
    raise AssertionError(f"no scenario with outcome {outcome} for {geometry}")


GEOM = dict(m_t=1.0e22, m_p=5.0e21, r_t=1.0e6, b=0.0)


def check_conservation(result: c.CollisionResult, angular=True):
    rep = result.conservation
    assert rep.within_tolerance
    assert rep.mass_residual_rel <= TOL.mass_rel and rep.momentum_residual_rel <= TOL.momentum_rel
    if angular:
        assert rep.angular_momentum_residual_rel is not None and rep.angular_momentum_residual_rel <= TOL.angular_momentum_rel
    assert rep.energy.dissipated_non_negative
    total_after = sum(p.mass_kg for p in (*result.transformed, *result.created, *result.debris_parcels))
    assert total_after == pytest.approx(result.conservation.mass_before_kg, rel=1e-14)
    assert result.mass_ledger.consumed_bodies_kg == pytest.approx(total_after, rel=1e-14)


def no_overlap(result):
    posts = [*result.transformed, *result.created, *result.debris_parcels]
    for i in range(len(posts)):
        for j in range(i + 1, len(posts)):
            d = math.dist(posts[i].position_m.as_tuple(), posts[j].position_m.as_tuple())
            assert d >= (posts[i].radius_m + posts[j].radius_m) * (1 - 1e-12)


# ------------------------------------------------------------------------------------------------ one test per outcome class
def test_perfect_merge_below_the_escape_speed():
    data, spec = find("perfect_merge", scan=[0.5, 0.8, 0.95], **GEOM)
    res = realise(data, spec, G)
    check_conservation(res)
    assert res.outcome == "perfect_merge" and res.removed_body_ids == ("projectile",) and [p.id for p in res.transformed] == ["target"]
    assert res.created == () and res.debris_parcels == ()
    (rem,) = res.transformed
    assert rem.mass_kg == 1.5e22 and rem.material.profile_id == "silicate-rock"
    expected_radius = (1.0e6 ** 3 + (1.0e6 * 0.5 ** (1 / 3)) ** 3) ** (1 / 3)
    assert rem.radius_m == pytest.approx(expected_radius, rel=1e-12)  # volume-conserving, as the legacy merge
    v_c = data.impact.pair_momentum_kg_m_per_s.as_tuple()
    assert rem.velocity_m_per_s.as_tuple() == pytest.approx(tuple(x / 1.5e22 for x in v_c), rel=1e-13)  # the COM velocity


def test_partial_accretion_keeps_the_target_id_and_one_parcel():
    data, spec = find("partial_accretion", **GEOM)
    res = realise(data, spec, G)
    check_conservation(res)
    assert [p.id for p in res.transformed] == ["target"] and res.removed_body_ids == ("projectile",) and res.created == ()
    (rem,), (parcel,) = res.transformed, res.debris_parcels
    assert rem.mass_kg > 1.0e22 and parcel.mass_kg == pytest.approx(1.5e22 - rem.mass_kg, rel=1e-13) and parcel.id == "debris-1-0"
    assert parcel.debris.size_distribution is None and parcel.debris.total_mass_kg == parcel.mass_kg  # Stage 5 resolves the population
    assert parcel.origin_event_id == "col-1"
    no_overlap(res)


def test_partial_erosion_keeps_the_target_id():
    data, spec = find("partial_erosion", **GEOM)
    res = realise(data, spec, G)
    check_conservation(res)
    (rem,), (parcel,) = res.transformed, res.debris_parcels
    assert rem.id == "target" and rem.mass_kg <= 1.0e22 * (1 + 1e-12) and parcel.mass_kg > 0
    no_overlap(res)


@pytest.mark.parametrize("outcome", ["catastrophic_disruption", "super_catastrophic_disruption"])
def test_disruption_retires_both_ids_and_creates_a_new_largest_remnant(outcome):
    data, spec = find(outcome, **GEOM)
    res = realise(data, spec, G)
    check_conservation(res)
    assert set(res.removed_body_ids) == {"target", "projectile"} and res.transformed == ()
    (rem,), (parcel,) = res.created, res.debris_parcels
    assert rem.id == "rem-1-0" and rem.origin_event_id == "col-1" and rem.mass_kg <= 0.5 * 1.5e22 * (1 + 1e-12) and parcel.mass_kg > 0
    assert rem.mass_kg == pytest.approx(spec.largest_remnant.mass_kg, rel=1e-14)
    no_overlap(res)


def test_scenario_c_hit_and_run_gives_two_remnants_with_exact_conservation():
    data = make_input(m_t=1.0e24, m_p=1.0e23, r_t=2.0e6, v_over_esc=1.5, b=0.7)
    spec = SEL.select(data).spec
    assert spec.outcome == "hit_and_run"  # the regime comes from the model
    res = realise(data, spec, G)
    check_conservation(res)
    assert [p.id for p in res.transformed] == ["target", "projectile"] and res.removed_body_ids == ()
    tgt, prj = res.transformed
    assert prj.mass_kg == 1.0e23 and prj.radius_m == data.impact.projectile.radius_m  # the projectile is unchanged (erosion not modelled)
    assert tgt.mass_kg + prj.mass_kg + sum(p.mass_kg for p in res.debris_parcels) == pytest.approx(1.1e24, rel=1e-14)
    # the removed normal component is dissipated, the tangential motion is kept: the remnants separate
    rel_pos = tuple(a - b for a, b in zip(prj.position_m.as_tuple(), tgt.position_m.as_tuple()))
    rel_vel = tuple(a - b for a, b in zip(prj.velocity_m_per_s.as_tuple(), tgt.velocity_m_per_s.as_tuple()))
    assert sum(a * b for a, b in zip(rel_pos, rel_vel)) >= 0.0  # receding (or tangential)
    assert math.dist(prj.position_m.as_tuple(), tgt.position_m.as_tuple()) >= (tgt.radius_m + prj.radius_m) * (1 - 1e-12)
    assert "hit_and_run_inelastic_normal_contact" in res.warnings and res.conservation.energy.dissipated_j > 0.0
    no_overlap(res)


def test_hit_and_run_with_debris_launches_a_parcel_and_keeps_conservation():
    """The realiser's geometry for a target that loses mass in a hit-and-run. The LS12-based model rarely erodes the target in a grazing
    impact, so the spec is built directly (mass-conserving by construction) to exercise the placement and the closure."""
    exercised = 0
    for b in (0.7, 0.8, 0.9):
        for gamma in (0.1, 0.5, 1.0):
            data = make_input(m_t=1.0e24, m_p=1.0e24 * gamma, r_t=2.0e6, v_over_esc=2.0, b=b)
            base = SEL.select(data).spec
            if base.outcome != "hit_and_run":
                continue
            lost = 0.15e24
            spec = dataclasses.replace(base, largest_remnant=c.RemnantSpec(1.0e24 - lost, "target", ()), debris_mass_kg=lost)
            res = realise(data, spec, G)
            check_conservation(res)
            assert len(res.debris_parcels) == 1 and res.debris_parcels[0].mass_kg == pytest.approx(lost, rel=1e-13)
            assert "debris_launch_speed_placeholder" in res.warnings
            no_overlap(res)
            tgt, prj = res.transformed
            assert tgt.mass_kg == pytest.approx(1.0e24 - lost, rel=1e-14) and prj.mass_kg == 1.0e24 * gamma
            exercised += 1
    assert exercised >= 4  # the placement and closure were really exercised, not skipped


@pytest.mark.parametrize("fraction", [0.5, 1.0])
def test_envelope_deposition_conserves_mass_and_momentum_and_books_the_angular_momentum(fraction):
    target = profile("gas-envelope-hhe") if fraction == 1.0 else gas_profile(fraction)
    data = make_input(m_t=1.9e27, m_p=1.0e15, r_t=7.0e7, r_p=5.0e2, v=6.0e4, b=0.3, target=target, projectile="rock")
    spec = SEL.select(data).spec
    assert spec.outcome == "envelope_deposition"
    res = realise(data, spec, G)
    check_conservation(res, angular=False)
    (rem,) = res.transformed
    assert rem.id == "target" and rem.mass_kg == 1.9e27 + 1.0e15 and res.debris_parcels == ()
    if fraction == 1.0:  # the shipped gas profile has no sourced moment of inertia: the angular momentum is booked, not a spin state
        assert res.conservation.angular_momentum_unmodelled and res.conservation.angular_momentum_residual_rel is None and rem.rotation is None
    assert "envelope_dynamics_not_resolved" in res.warnings


def test_envelope_merge_approximation_is_labelled_unsupported():
    data = make_input(m_t=1.9e27, m_p=5.7e26, r_t=7.0e7, r_p=6.0e7, v=3.0e4, target=gas_profile(1.0), projectile=gas_profile(0.9))
    spec = SEL.select(data).spec
    assert spec.outcome == "envelope_merge_approximation"
    res = realise(data, spec, G)
    check_conservation(res, angular=False)
    assert res.fidelity["outcome"] == c.Fidelity.UNSUPPORTED


def test_fallback_for_an_unsupported_regime_is_a_conserving_merge():
    data = make_input(m_t=1.0e12, m_p=5.0e11, r_t=4.0e2, v_over_esc=20.0)
    sel = SEL.select(data)
    assert sel.fallback
    res = realise(data, sel.spec, G)
    check_conservation(res)
    assert res.outcome == "perfect_merge" and "unsupported_regime" in res.warnings and len(res.transformed) == 1


# ------------------------------------------------------------------------------------------------ spin, angular momentum
def test_the_remnant_spin_carries_the_whole_angular_momentum_budget():
    data = make_input(m_t=1.0e22, m_p=5.0e21, r_t=1.0e6, v_over_esc=0.9, b=0.5, spin=2.0e-4)
    spec = SEL.select(data).spec
    res = realise(data, spec, G)
    (rem,) = res.transformed
    assert rem.rotation is not None
    s = tuple(rem.rotation.moment_of_inertia_kg_m2 * w for w in rem.rotation.omega_rad_per_s.as_tuple())
    before = res.conservation.angular_momentum_before_kg_m2_per_s.as_tuple()
    assert s == pytest.approx(before, rel=1e-12)
    assert before[2] != 0.0


def test_an_oblique_impact_without_any_spin_produces_a_spin_state_from_the_orbital_angular_momentum():
    data = make_input(v_over_esc=0.9, b=0.6)
    res = realise(data, SEL.select(data).spec, G)
    (rem,) = res.transformed
    assert rem.rotation is not None and rem.rotation.omega_rad_per_s.as_tuple() != (0.0, 0.0, 0.0)
    head_on = realise(make_input(v_over_esc=0.9, b=0.0), SEL.select(make_input(v_over_esc=0.9, b=0.0)).spec, G)
    assert head_on.transformed[0].rotation is None  # nothing to represent: no state is invented for a non-rotating, head-on pair


def test_a_supercritical_remnant_spin_is_kept_and_reported():
    """DQ-13 (D-043): no shedding model in v1: keep the spin and warn."""
    data = make_input(m_t=1.0e22, m_p=5.0e21, r_t=1.0e6, v_over_esc=0.9, b=0.0, spin=5.0e-3)  # critical spin there is ~8e-4 rad/s
    res = realise(data, SEL.select(data).spec, G)
    assert "remnant_spin_supercritical" in res.warnings
    ok = realise(make_input(v_over_esc=0.9, b=0.0, spin=1.0e-6), SEL.select(make_input(v_over_esc=0.9, b=0.0, spin=1.0e-6)).spec, G)
    assert "remnant_spin_supercritical" not in ok.warnings


def test_a_body_without_a_moment_of_inertia_keeps_the_angular_momentum_in_the_ledger():
    gas = profile("gas-envelope-hhe")  # the shipped gas profile: no sourced moment of inertia
    data = make_input(m_t=1.9e27, m_p=5.7e26, r_t=7.0e7, r_p=6.0e7, v=3.0e4, b=0.4, target=gas, projectile=gas)
    res = realise(data, SEL.select(data).spec, G)
    assert res.transformed[0].rotation is None and res.conservation.angular_momentum_unmodelled
    assert res.conservation.angular_momentum_before_kg_m2_per_s.as_tuple() != (0.0, 0.0, 0.0)


# ------------------------------------------------------------------------------------------------ purity and determinism
def test_realisation_is_pure_and_deterministic():
    data, spec = find("catastrophic_disruption", **GEOM)
    a, b = realise(data, spec, G), realise(data, spec, G)
    assert a == b and a.result_digest == b.result_digest == a.compute_digest()
    assert c.CollisionResult.from_json(a.to_json()) == a
    other = dataclasses.replace(data, seed=data.seed + 1)  # the seed is recorded in the parcel, nothing else is random
    assert realise(other, spec, G).result_digest != a.result_digest and realise(other, spec, G).conservation == a.conservation


def test_the_placeholder_launch_speed_is_what_the_parcel_gets():
    data, spec = find("partial_erosion", **GEOM)
    res = realise(data, spec, G)
    (rem,), (parcel,) = res.transformed, res.debris_parcels
    rel = math.dist(parcel.velocity_m_per_s.as_tuple(), rem.velocity_m_per_s.as_tuple())
    assert rel == pytest.approx(DEBRIS_LAUNCH_FACTOR * data.impact.mutual_escape_speed_m_per_s.physical_radii, rel=1e-12)
    assert "debris_launch_speed_placeholder" in res.warnings and DEBRIS_LAUNCH_FACTOR == 1.1


def test_parcel_not_allowed_returns_the_debris_to_the_remnant():
    data, spec = find("partial_erosion", **GEOM)
    res = realise(data, spec, G, parcel_allowed=False)
    check_conservation(res)
    assert res.debris_parcels == () and res.transformed[0].mass_kg == pytest.approx(1.5e22, rel=1e-14)
    assert "debris_returned_to_remnant" in res.warnings and res.mass_ledger.returned_to_remnant_kg > 0.0


def test_a_spec_that_does_not_conserve_mass_is_refused():
    data, spec = find("partial_erosion", **GEOM)
    bad = dataclasses.replace(spec, debris_mass_kg=spec.debris_mass_kg * 2)
    with pytest.raises(ValueError):
        realise(data, bad, G)


# ------------------------------------------------------------------------------------------------ validation before mutation
def test_validate_result_rejects_overlap_unknown_ids_reused_ids_and_nonconservation():
    data, spec = find("partial_erosion", **GEOM)
    res = realise(data, spec, G)
    live = {"target", "projectile"}
    validate_result(res, live, data)  # fine
    with pytest.raises(ResultInvalid, match="does not exist"):
        validate_result(res, {"target"}, data)
    with pytest.raises(ResultInvalid, match="already exists"):
        validate_result(res, live | {res.debris_parcels[0].id}, data)
    rem, parcel = res.transformed[0], res.debris_parcels[0]
    overlapping = dataclasses.replace(res, debris_parcels=(dataclasses.replace(parcel, position_m=rem.position_m),))
    with pytest.raises(ResultInvalid, match="overlap"):
        validate_result(overlapping, live, data)
    broken = dataclasses.replace(res, conservation=dataclasses.replace(res.conservation, within_tolerance=False))
    with pytest.raises(ResultInvalid, match="conservation"):
        validate_result(broken, live, data)
    bad_ledger = dataclasses.replace(res, mass_ledger=dataclasses.replace(res.mass_ledger, consumed_bodies_kg=res.mass_ledger.consumed_bodies_kg * 1.1))
    with pytest.raises(ResultInvalid, match="ledger"):
        validate_result(bad_ledger, live, data)


@pytest.mark.parametrize("mass_ratio", [1.0, 0.3, 0.05, 1.0e-3])
@pytest.mark.parametrize("b", [0.0, 0.4, 0.8])
def test_conservation_over_a_grid_of_impacts(mass_ratio, b):
    for x in (0.7, 1.1, 1.6, 2.5, 5.0, 10.0):
        data = make_input(m_t=1.0e24, m_p=1.0e24 * mass_ratio, r_t=2.0e6, v_over_esc=x, b=b)
        sel = SEL.select(data)
        res = realise(data, sel.spec, G)
        assert res.conservation.mass_residual_rel <= TOL.mass_rel and res.conservation.momentum_residual_rel <= TOL.momentum_rel, (mass_ratio, b, x, sel.spec.outcome)
