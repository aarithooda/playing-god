"""Stage 5: tracked fragments and debris parcels (D-046 parcels, D-047 body budget, D-048 ejection and threshold).

Scientific content PROVISIONAL (D-038, D-048): the invariants below are not. Pure functions first (`fragments.py`), then the realiser over a
parameter grid, then the engine and the budget behaviour.
"""
import collections
import math
import random

import pytest

from backend.impact import fragments as fr
from backend.impact.applier import ResultInvalid, realise, validate_result
from backend.impact.contracts import CollisionTolerances
from backend.impact.models.ls12 import BETA
from backend.impact.models.provisional import ITEMS
from backend.impact.selector import Selector
from tests.impact.scenarios import G, make_input
from tests.impact.test_engine_outcomes import deferred, make, pair_service, run_and_check_conservation

SEL = Selector(G)
TOL = CollisionTolerances()
IDS = {"target", "projectile"}


# ------------------------------------------------------------------------------------------------ masses
@pytest.mark.parametrize("beta", [2.0, 2.85, 3.5])
@pytest.mark.parametrize("n_max", [1, 4, 16])
@pytest.mark.parametrize("share", [0.01, 0.3, 0.9])
def test_the_split_accounts_for_every_kilogram(beta, n_max, share):
    for seed in range(20):
        total, debris = 1.0e24, share * 1.0e24
        largest = (1.0 - share) * 1.0e24
        s = fr.split_masses(debris, largest, total, beta, n_max, None, random.Random(seed))
        assert math.fsum(s.tracked) + s.tail_kg == pytest.approx(debris, rel=1e-15)
        assert s.tail_kg >= 0.0 and len(s.tracked) <= n_max
        assert list(s.tracked) == sorted(s.tracked, reverse=True)  # largest first
        assert all(m > 0.0 for m in s.tracked)
        assert (not s.tracked) or s.tracked[0] <= largest  # a fragment is never heavier than the largest remnant
        assert math.fsum(s.tracked) <= fr.TRACKED_SHARE * debris * (1 + 1e-12)  # the untracked tail always exists (a parcel can hold it)


def test_fragment_masses_are_never_identical():
    s = fr.split_masses(1.0e23, 5.0e23, 1.0e24, BETA, 16, None, random.Random(1))
    assert len(set(s.tracked)) == len(s.tracked) > 8


def test_the_size_distribution_follows_the_power_law_that_was_asked_for():
    """The realised ranks follow m_k ~ k^(-1/q), q = beta / 3 (N(>m) ~ m^-q): the log-log slope of 10^4 realised masses recovers beta."""
    for beta in (2.0, 2.85, 3.6):
        s = fr.split_masses(1.0e24, 1.0e30, 1.0e30, beta, 10_000, None, random.Random(7))
        ranks = range(1, len(s.tracked) + 1)
        xs, ys = [math.log(k) for k in ranks], [math.log(m) for m in s.tracked]
        mx, my = math.fsum(xs) / len(xs), math.fsum(ys) / len(ys)
        slope = math.fsum((x - mx) * (y - my) for x, y in zip(xs, ys)) / math.fsum((x - mx) ** 2 for x in xs)
        assert -slope == pytest.approx(3.0 / beta, rel=0.01)  # 1/q = 3/beta


def test_a_configured_threshold_moves_the_small_fragments_to_the_untracked_tail():
    free = fr.split_masses(1.0e23, 5.0e23, 1.0e24, BETA, 16, None, random.Random(3))
    cut = fr.split_masses(1.0e23, 5.0e23, 1.0e24, BETA, 16, 0.005, random.Random(3))
    assert 0 < len(cut.tracked) < len(free.tracked) and all(m >= 0.005 * 1.0e24 for m in cut.tracked)
    assert math.fsum(cut.tracked) + cut.tail_kg == pytest.approx(1.0e23, rel=1e-15)


def test_no_fragment_slots_means_everything_is_untracked():
    s = fr.split_masses(1.0e23, 5.0e23, 1.0e24, BETA, 0, None, random.Random(3))
    assert s.tracked == () and s.tail_kg == 1.0e23


def test_the_seeded_realisation_is_deterministic_and_the_seed_matters():
    def make_all(seed):
        rng = random.Random(seed)
        s = fr.split_masses(1.0e23, 5.0e23, 1.0e24, BETA, 16, None, rng)
        masses = [*s.tracked, s.tail_kg / 2, s.tail_kg / 2]
        radii = [(m / 1e22) ** (1 / 3) * 1e5 for m in masses]
        lay = fr.ring_layout(5.0e23, 1.0e6, masses, radii, fr.plane_basis((1.0, 0.0, 0.0), (0.0, 1.0, 0.0)), 5.0e3, 1.0e-3, G, rng)
        return s, lay

    a, b, c = make_all(11), make_all(11), make_all(12)
    assert a == b  # bitwise
    assert a[0].tracked != c[0].tracked and a[1].velocities != c[1].velocities
    assert math.fsum(a[0].tracked) + a[0].tail_kg == pytest.approx(math.fsum(c[0].tracked) + c[0].tail_kg, rel=1e-15)  # same totals


# ------------------------------------------------------------------------------------------------ geometry
@pytest.mark.parametrize("seed", range(25))
@pytest.mark.parametrize("n", [1, 2, 5, 12, 20])
def test_the_ring_layout_closes_momentum_and_the_centre_of_mass_and_keeps_products_apart(seed, n):
    rng = random.Random(seed)
    m1, r1, v_esc, eps = 4.0e23, 2.0e6, 6.0e3, 1.0e-3
    masses = [rng.uniform(1e20, 3e22) for _ in range(n)]
    radii = [(m / (4 / 3 * math.pi * 3000.0)) ** (1 / 3) * 1.0 for m in masses]
    lay = fr.ring_layout(m1, r1, masses, radii, fr.plane_basis((0.3, 0.5, 0.1), (0.0, 1.0, 0.0)), v_esc, eps, G, rng)
    allm = [m1, *masses]
    pos = [lay.remnant_position, *lay.positions]
    vel = [lay.remnant_velocity, *lay.velocities]
    scale_p = math.fsum(m * math.sqrt(sum(c * c for c in v)) for m, v in zip(allm, vel))
    for axis in range(3):
        assert abs(math.fsum(m * v[axis] for m, v in zip(allm, vel))) <= 1e-12 * scale_p  # momentum closes (relative to the COM velocity)
        assert abs(math.fsum(m * p[axis] for m, p in zip(allm, pos))) <= 1e-12 * lay.ring_radius_m * math.fsum(allm)  # centre of mass stays
    rad = [r1, *radii]
    for i in range(len(pos)):
        for j in range(i + 1, len(pos)):
            assert math.dist(pos[i], pos[j]) >= (rad[i] + rad[j]) * (1 + eps) * (1 - 1e-12)  # no overlap, clear separation
            v_rel2 = sum((a - b) ** 2 for a, b in zip(vel[i], vel[j]))
            assert v_rel2 >= 2 * G * (allm[i] + allm[j]) / math.dist(pos[i], pos[j]) * (1 - 1e-9)  # every pair starts unbound


def test_ejection_speeds_lie_in_the_provisional_range_and_directions_differ():
    rng = random.Random(5)
    masses = [1e21 * (1 + k) for k in range(12)]
    radii = [1e5] * 12
    lay = fr.ring_layout(1e24, 1e6, masses, radii, fr.plane_basis((1, 0, 0), (0, 1, 0)), 6.0e3, 1e-3, G, rng)
    dv = lay.remnant_velocity
    speeds = [math.dist(v, dv) / 6.0e3 for v in lay.velocities]
    assert all(fr.EJECTION_FACTOR_RANGE[0] - 1e-12 <= f <= fr.EJECTION_FACTOR_RANGE[1] + 1e-12 for f in speeds)
    assert len({tuple(round(c, 6) for c in v) for v in lay.velocities}) == 12  # not one identical velocity with random scatter: all distinct
    assert all(abs(v[2] - dv[2]) < 1e-9 for v in lay.velocities)  # in the collision plane


def test_an_absurd_recoil_is_rejected_not_hidden():
    """A single product heavier than the whole rest: the closure shift would be about the ejection speed itself (> v_esc)."""
    with pytest.raises(ValueError, match="closure shift"):
        fr.ring_layout(1.0e20, 1.0e5, [1.0e24], [1.0e6], fr.plane_basis((1, 0, 0), (0, 1, 0)), 6.0e3, 1e-3, G, random.Random(1))


# ------------------------------------------------------------------------------------------------ realiser grid with budgets
BUDGET = fr.FragmentBudget(16, 4)
MASS_RATIOS = (1.0, 0.3, 0.05, 1.0e-3)
IMPACT_PARAMETERS = (0.0, 0.4, 0.7, 0.9)
SPEEDS = (0.9, 1.3, 2.5, 6.0, 12.0)


def tiers(data, spec, budget):
    fb = SEL.fallback(data, spec.model_id, ("test",)).spec
    last = None
    for tier, s, represent in ((1, spec, True), (2, fb, True), (3, fb, False)):
        try:
            res = realise(data, s, G, represent_spin=represent, budget=budget)
            validate_result(res, IDS, data)
            return tier, res
        except (ResultInvalid, ValueError) as exc:
            last = exc
    raise AssertionError(f"no valid tier: {last}")


@pytest.mark.parametrize("gamma", MASS_RATIOS)
def test_grid_with_fragments_always_resolves_and_conserves(gamma):
    counts, with_fragments = collections.Counter(), 0
    for b in IMPACT_PARAMETERS:
        for x in SPEEDS:
            for spin in (None, 3.0e-4):
                data = make_input(m_t=1.0e24, m_p=1.0e24 * gamma, r_t=2.0e6, v_over_esc=x, b=b, spin=spin)
                tier, res = tiers(data, SEL.select(data).spec, BUDGET)
                counts[tier] += 1
                rep = res.conservation
                assert rep.within_tolerance and rep.mass_residual_rel <= TOL.mass_rel and rep.momentum_residual_rel <= TOL.momentum_rel
                if rep.angular_momentum_residual_rel is not None:
                    assert rep.angular_momentum_residual_rel <= TOL.angular_momentum_rel
                assert rep.energy.dissipated_non_negative
                posts = [*res.transformed, *res.created, *res.debris_parcels]
                assert sum(p.mass_kg for p in posts) == pytest.approx(rep.mass_before_kg, rel=1e-14)
                led = res.mass_ledger
                assert led.fragments_kg == pytest.approx(sum(p.mass_kg for p in res.created if p.representation == "fragment"), rel=1e-15)
                assert led.parcels_kg == pytest.approx(sum(p.mass_kg for p in res.debris_parcels), rel=1e-15)
                assert len({p.id for p in posts}) == len(posts)
                if any(p.representation == "fragment" for p in res.created):
                    with_fragments += 1
                    assert "ejection_speed_provisional" in res.warnings and "provisional:CP-SCI-1" in res.warnings
    assert counts[1] >= 0.8 * sum(counts.values()), counts
    if gamma >= 0.3:
        assert with_fragments > 0


@pytest.mark.parametrize("budget,expect_fragments,expect_parcels", [
    (fr.FragmentBudget(0, 0), 0, 0), (fr.FragmentBudget(0, 3), 0, 3), (fr.FragmentBudget(5, 0), 5, 0), (fr.FragmentBudget(5, 1), 5, 1)])
def test_every_budget_closes_the_mass_and_the_momentum(budget, expect_fragments, expect_parcels):
    data = make_input(m_t=1.0e24, m_p=5.0e23, r_t=2.0e6, v_over_esc=3.0, b=0.3)
    spec = SEL.select(data).spec
    assert spec.debris_mass_kg > 0
    res = realise(data, spec, G, parcel_allowed=budget.max_fragments + budget.max_parcels > 0, budget=budget)
    validate_result(res, IDS, data)
    n_frag = sum(p.representation == "fragment" for p in res.created)
    assert n_frag <= budget.max_fragments and len(res.debris_parcels) <= max(budget.max_parcels, 0)
    if expect_fragments == 0 and expect_parcels == 0:
        assert n_frag == 0 and not res.debris_parcels and "debris_returned_to_remnant" in res.warnings
        assert res.mass_ledger.returned_to_remnant_kg == pytest.approx(spec.debris_mass_kg, rel=1e-12)
    if budget.max_parcels == 0 and budget.max_fragments > 0:
        assert not res.debris_parcels and "debris_returned_to_remnant" in res.warnings  # the untracked tail went to the remnant
    assert res.conservation.within_tolerance and res.conservation.mass_residual_rel <= TOL.mass_rel


# ------------------------------------------------------------------------------------------------ the engine
def test_a_disruption_gives_a_remnant_fragments_and_parcels_with_exact_totals():
    """Scenario D (backend, PROVISIONAL science): within the declared envelope an energetic impact leaves a largest remnant, tracked
    fragments and parcels, and the whole universe conserves mass, momentum and angular momentum."""
    svc, *_ = pair_service(8.0, 0.0)
    out = run_and_check_conservation(svc)
    (event,) = out.events
    assert event.outcome == "super_catastrophic_disruption"
    kinds = collections.Counter(b.id.split("-")[0] for b in out.bodies)
    assert kinds["rem"] == 1 and kinds["frag"] >= 2 and kinds["debris"] >= 1
    fragment_ids = [b.id for b in out.bodies if b.id.startswith("frag-")]
    assert all(b.representation == "fragment" and b.originEventId == "col-1" for b in out.bodies if b.id in fragment_ids)
    assert event.debrisMassKg == pytest.approx(sum(b.massKg for b in out.bodies if b.id.startswith("debris-")), rel=1e-12)
    assert "ejection_speed_provisional" in event.warnings and "provisional:CP-SCI-1" in event.warnings
    assert all(b.massKg > 0 for b in out.bodies)  # nothing massless: visual samples are frontend-only and never bodies


@pytest.mark.parametrize("already", [0, 3, 4, 10])
def test_the_global_fragment_budget_counts_the_fragments_that_already_exist(already):
    svc = deferred(max_tracked_fragments_per_event=4, max_tracked_fragments_total=4)
    pair_service(3.0, 0.0, svc=svc)
    for k in range(already):
        svc._products[f"old-{k}"] = ("fragment", "col-0", None)
    mass0 = svc.snapshot().diagnostics.totalMassKg
    out = svc.step(svc.approach_s)
    new_fragments = sum(b.id.startswith("frag-") for b in out.bodies)
    assert new_fragments == max(0, 4 - already) if already < 4 else new_fragments == 0
    assert out.diagnostics.totalMassKg == pytest.approx(mass0, rel=1e-14)


@pytest.mark.parametrize("far", [100, 150, 180, 186, 188, 189, 190, 191, 195])
def test_the_body_cap_never_loses_mass_and_is_never_exceeded(far):
    """D-047: whatever room is left, the mass is accounted for (fragments, parcels or the remnant) and MAX_BODIES is respected."""
    from backend.models import MAX_BODIES

    svc = deferred()
    for i in range(far):
        svc.add_body(make(f"far{i}", m=1e10, r=1.0, x=(1e12 + 1e5 * i, 1e12, 0)))
    pair_service(3.0, 0.0, svc=svc)
    mass0 = svc.snapshot().diagnostics.totalMassKg
    out = svc.step(svc.approach_s)
    assert len(out.bodies) <= MAX_BODIES
    assert out.diagnostics.totalMassKg == pytest.approx(mass0, rel=1e-14)
    ev = next(e for e in out.events if e.type == "collision")
    created = len(out.bodies) - (far + 1)
    room = MAX_BODIES - 8 - (far + 2 - 1)  # bodies the event may add beyond the one it leaves, keeping the reserve for the user
    assert created <= max(room, 0)
    if room <= 0:
        assert "debris_returned_to_remnant" in ev.warnings


def test_fragments_follow_snapshot_restore_and_derive_like_every_other_product():
    svc, *_ = pair_service(3.0, 0.0)
    before = svc.capture_snapshot()
    svc.step(svc.approach_s)
    assert any(v[0] == "fragment" for v in svc._products.values())
    after = svc.capture_snapshot()
    svc.restore_snapshot(before)
    assert not any(v[0] == "fragment" for v in svc._products.values())
    svc.restore_snapshot(after)
    assert sum(v[0] == "fragment" for v in svc._products.values()) > 0


def test_cratering_remains_unsupported_for_every_shipped_profile():
    """D-048 (2): no HH11 constants are documented, so no cratering distribution exists and none was invented for Stage 5."""
    from backend.impact.materials import list_profiles

    for p in list_profiles():
        assert p.cratering is None  # no shipped profile carries cratering constants


def test_the_new_assumptions_are_registered_as_provisional():
    for key in ("DQ6-ejection-factor", "FRAG-tracked-share", "FRAG-parcel-dmin", "LS12-beta"):
        assert key in ITEMS and ITEMS[key].status in ("engineering", "unverified", "transcribed")
    assert ITEMS["DQ6-ejection-factor"].status == "engineering" and "universal constant" in ITEMS["DQ6-ejection-factor"].open_item
