"""Stage 4a: systematic invariants of the realised outcomes over a broad parameter grid (mass ratio x impact parameter x speed x spin x
material), instead of single hand-picked cases. Scientific content PROVISIONAL (D-038); the invariants are not.

For every point of the grid:
1. the selector never raises and yields a spec that accounts for all mass;
2. one of the three resolution tiers yields a VALID result (tier 1: the model's outcome; tier 2: the labelled perfect-merge fallback; tier 3:
   a merge without rotation states, which cannot fail on physics grounds), so the engine can never hit an unrecoverable error;
3. every valid result conserves mass (1e-14), linear momentum (1e-12) and, when the angular momentum is represented, angular momentum
   (1e-10), creates no energy, and has no overlapping products.
"""
import collections
import math

import pytest

from backend.impact.applier import ResultInvalid, realise, validate_result
from backend.impact.contracts import CollisionTolerances
from backend.impact.selector import Selector
from tests.impact.scenarios import G, gas_profile, make_input, profile

SEL = Selector(G)
TOL = CollisionTolerances()
IDS = {"target", "projectile"}

MASS_RATIOS = (1.0, 0.7, 0.3, 0.1, 0.03, 1.0e-3, 1.0e-5)
IMPACT_PARAMETERS = (0.0, 0.2, 0.4, 0.6, 0.7, 0.8, 0.9, 0.97)
SPEEDS = (0.5, 0.9, 1.05, 1.3, 1.8, 2.5, 4.0, 7.0, 12.0)
SPINS = (None, 3.0e-4)


def tiers(data, spec):
    """The three resolution tiers in the order the engine tries them; yields (tier, result) for the first valid one."""
    attempts = [(1, spec, True)]
    fb = SEL.fallback(data, spec.model_id, ("test",)).spec
    attempts += [(2, fb, True), (3, fb, False)]
    last = None
    for tier, s, represent in attempts:
        try:
            res = realise(data, s, G, represent_spin=represent)
            validate_result(res, IDS, data)
            return tier, res
        except (ResultInvalid, ValueError) as exc:
            last = exc
    raise AssertionError(f"no valid tier: {last}")


def assert_invariants(res):
    rep = res.conservation
    assert rep.within_tolerance
    assert rep.mass_residual_rel <= TOL.mass_rel and rep.momentum_residual_rel <= TOL.momentum_rel
    if rep.angular_momentum_residual_rel is not None:
        assert rep.angular_momentum_residual_rel <= TOL.angular_momentum_rel
    else:
        assert rep.angular_momentum_unmodelled  # never silently dropped: stated, and booked by the applier
    assert rep.energy.dissipated_non_negative
    posts = [*res.transformed, *res.created, *res.debris_parcels]
    assert sum(p.mass_kg for p in posts) == pytest.approx(rep.mass_before_kg, rel=1e-14)
    assert all(math.isfinite(c) for p in posts for c in (*p.position_m.as_tuple(), *p.velocity_m_per_s.as_tuple(), p.radius_m, p.mass_kg))
    for i in range(len(posts)):
        for j in range(i + 1, len(posts)):
            assert math.dist(posts[i].position_m.as_tuple(), posts[j].position_m.as_tuple()) >= (posts[i].radius_m + posts[j].radius_m) * (1 - 1e-12)
    ids = [p.id for p in posts]
    assert len(set(ids)) == len(ids)


@pytest.mark.parametrize("gamma", MASS_RATIOS)
def test_grid_every_point_has_a_valid_tier_and_conserves(gamma):
    counts = collections.Counter()
    for b in IMPACT_PARAMETERS:
        for x in SPEEDS:
            for spin in SPINS:
                data = make_input(m_t=1.0e24, m_p=1.0e24 * gamma, r_t=2.0e6, v_over_esc=x, b=b, spin=spin)
                sel = SEL.select(data)
                second = sel.spec.second_remnant.mass_kg if sel.spec.second_remnant else 0.0
                assert sel.spec.largest_remnant.mass_kg + second + sel.spec.debris_mass_kg == pytest.approx(1.0e24 * (1 + gamma), rel=1e-13)
                tier, res = tiers(data, sel.spec)
                assert_invariants(res)
                counts[tier] += 1
    assert counts[1] > 0  # the model's own outcome is the normal case
    assert counts[1] >= 0.9 * sum(counts.values()), counts  # fallbacks are the exception, not the rule


@pytest.mark.parametrize("target,projectile", [("rock", "rock"), ("rock", profile("rubble-silicate")), ("rock", profile("water-ice")),
                                               (profile("rubble-silicate"), "rock"), (profile("iron"), profile("iron")),
                                               (profile("gas-envelope-hhe"), "rock"), (profile("gas-envelope-hhe"), profile("gas-envelope-hhe")),
                                               (gas_profile(0.5), gas_profile(0.5)), ("rock", None), (None, None)])
def test_grid_over_material_combinations(target, projectile):
    for b in (0.0, 0.5, 0.85):
        for x in (0.8, 1.5, 4.0, 10.0):
            data = make_input(m_t=1.0e25, m_p=3.0e24, r_t=3.0e6, v_over_esc=x, b=b, target=target, projectile=projectile)
            sel = SEL.select(data)
            if sel.spec.outcome == "legacy_merge":  # a body without a material: the exact legacy merge, not realised here (DQ-2)
                assert target is None or projectile is None
                continue
            tier, res = tiers(data, sel.spec)
            assert_invariants(res)


@pytest.mark.parametrize("m_t,r_t", [(1.0e12, 4.0e2), (1.0e18, 5.0e4), (6.0e24, 6.4e6), (2.0e30, 7.0e8)])
def test_grid_over_body_scales(m_t, r_t):
    """Same dimensionless impacts at asteroid, planet and star scale (small bodies fall under D-041 and use the labelled fallback)."""
    for gamma in (1.0, 0.1):
        for b in (0.0, 0.6, 0.9):
            for x in (0.7, 1.5, 6.0):
                data = make_input(m_t=m_t, m_p=m_t * gamma, r_t=r_t, v_over_esc=x, b=b)
                tier, res = tiers(data, SEL.select(data).spec)
                assert_invariants(res)


def test_a_slow_grazing_equal_mass_impact_needs_the_last_resort_and_stays_conserving():
    """Found by the grid: the remnant of a slow, very grazing equal-mass impact would have to spin faster than break-up, so its rotational
    energy exceeds the available energy. Tier 1 and tier 2 are rejected; the merge without rotation states conserves everything."""
    data = make_input(m_t=1.0e24, m_p=1.0e24, r_t=2.0e6, v_over_esc=1.05, b=0.97)
    spec = SEL.select(data).spec
    with pytest.raises(ResultInvalid):
        validate_result(realise(data, spec, G), IDS, data)
    tier, res = tiers(data, spec)
    assert tier == 3 and res.transformed[0].rotation is None
    assert res.conservation.angular_momentum_unmodelled and res.conservation.angular_momentum_before_kg_m2_per_s.as_tuple() != (0.0, 0.0, 0.0)
    assert_invariants(res)
