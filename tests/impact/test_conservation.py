"""Stage 4a: conservation accounting (backend/impact/conservation.py). Pure arithmetic on constructed states: the expected residuals follow
from the construction (a state that conserves by construction, then one error injected at a time)."""
import dataclasses
import math

import pytest

from backend.impact import conservation as cons
from backend.impact.contracts import CollisionTolerances

G = 6.67430e-11
TOL = CollisionTolerances()


def pair(m1=3.0e22, m2=1.0e22, r1=1.5e6, r2=1.0e6, v=4.0e3):
    """Two bodies at contact on the x axis, head-on, with spins."""
    gap = r1 + r2
    x1 = (-gap * m2 / (m1 + m2), 0.0, 0.0)
    x2 = (gap * m1 / (m1 + m2), 0.0, 0.0)
    return [cons.State(m1, x1, (0.0, 0.0, 0.0), r1, (0.0, 0.0, 2.0e30), 0.4 * m1 * r1 * r1),
            cons.State(m2, x2, (-v, 0.0, 0.0), r2, (0.0, 1.0e29, 0.0), 0.4 * m2 * r2 * r2)]


def merged_from(before):
    x_c, v_c = cons.centre_of_mass(before)
    m = cons.total_mass(before)
    l_orb = cons.orbital_angular_momentum(before, x_c, v_c)
    s = tuple(a + b for a, b in zip(l_orb, cons.spin_angular_momentum(before)))
    r = (sum(b.radius ** 3 for b in before)) ** (1 / 3)
    return [cons.State(m, x_c, v_c, r, s, 0.4 * m * r * r)]


def report(before, after, **kw):
    return cons.build_report(before, after, G, TOL, angular_scale=1.0, **kw)


def test_a_conserving_merge_has_zero_residuals_and_positive_dissipation():
    before = pair()
    rep, shift = report(before, merged_from(before))
    assert rep.mass_residual_rel == 0.0 and rep.momentum_residual_rel <= 1e-15
    assert rep.angular_momentum_residual_rel <= 1e-15 and rep.within_tolerance
    assert rep.energy.dissipated_j > 0.0 and rep.energy.dissipated_non_negative and shift == 0.0  # one product: no placement artefact


def test_residuals_detect_each_injected_error_separately():
    before = pair()
    good = merged_from(before)
    bad_mass = [dataclasses.replace(good[0], mass=good[0].mass * (1 + 1e-10))]
    rep, _ = report(before, bad_mass)
    assert rep.mass_residual_rel == pytest.approx(1e-10, rel=1e-3) and not rep.within_tolerance
    bad_p = [dataclasses.replace(good[0], velocity=(good[0].velocity[0] * (1 + 1e-9), 0.0, 0.0))]
    rep, _ = report(before, bad_p)
    assert rep.momentum_residual_rel > TOL.momentum_rel and not rep.within_tolerance
    bad_l = [dataclasses.replace(good[0], spin=(good[0].spin[0], good[0].spin[1], good[0].spin[2] * (1 + 1e-6)))]
    rep, _ = report(before, bad_l)
    assert rep.angular_momentum_residual_rel > TOL.angular_momentum_rel and not rep.within_tolerance


def test_energy_created_by_the_collision_is_rejected_and_dissipation_is_not():
    before = pair()
    x_c, v_c = cons.centre_of_mass(before)
    m1, m2 = before[0].mass, before[1].mass
    # two products that fly apart much faster than the bodies approached: kinetic energy appears from nowhere
    fast = [cons.State(m1, (-1.0e7, 0, 0), (-1.0e5, 0, 0), before[0].radius), cons.State(m2, (1.0e7 * m1 / m2, 0, 0), (1.0e5 * m1 / m2, 0, 0), before[1].radius)]
    rep, _ = report(before, fast, angular_unmodelled="test")
    assert not rep.energy.dissipated_non_negative and rep.energy.dissipated_j < 0.0 and not rep.within_tolerance


def test_unmodelled_angular_momentum_is_reported_not_forced():
    before = pair()
    good = merged_from(before)
    no_spin = [dataclasses.replace(good[0], spin=(0.0, 0.0, 0.0), inertia=None)]
    rep, _ = report(before, no_spin, angular_unmodelled="the remnant has no moment of inertia")
    assert rep.angular_momentum_residual_rel is None and rep.angular_momentum_unmodelled
    assert rep.within_tolerance  # mass and momentum are conserved; the angular momentum is reported as unmodelled, not as a pass
    without_note, _ = report(before, no_spin)
    assert without_note.angular_momentum_residual_rel > 0.5 and not without_note.within_tolerance


def test_the_frame_does_not_matter():
    before = pair()
    shifted = [dataclasses.replace(b, position=tuple(p + 5.0e9 for p in b.position), velocity=tuple(v + 3.0e4 for v in b.velocity)) for b in before]
    a, _ = report(before, merged_from(before))
    b, _ = report(shifted, merged_from(shifted))
    assert b.within_tolerance and b.energy.dissipated_j == pytest.approx(a.energy.dissipated_j, rel=1e-9)


def test_energy_partition_terms_against_hand_formulas():
    before = pair()
    rep, _ = report(before, merged_from(before))
    e = rep.energy
    mu = before[0].mass * before[1].mass / (before[0].mass + before[1].mass)
    assert e.kinetic_translational_before_j == pytest.approx(0.5 * mu * 4.0e3 ** 2, rel=1e-12)
    assert e.mutual_potential_before_j == pytest.approx(-G * before[0].mass * before[1].mass / (before[0].radius + before[1].radius), rel=1e-12)
    assert e.self_gravitational_before_j == pytest.approx(-0.6 * G * (before[0].mass ** 2 / before[0].radius + before[1].mass ** 2 / before[1].radius), rel=1e-12)
    assert e.rotational_before_j == pytest.approx(sum(0.5 * sum(c * c for c in b.spin) / b.inertia for b in before), rel=1e-12)
    assert e.mutual_potential_after_j == 0.0  # one product has no mutual potential


def test_placement_shift_is_the_potential_artefact_of_keeping_products_apart():
    a = cons.State(1.0e22, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 1.0e6)
    touching = cons.State(1.0e21, (1.0e6 + 3.0e5, 0.0, 0.0), (0.0, 0.0, 0.0), 3.0e5)
    apart = dataclasses.replace(touching, position=((1.0e6 + 3.0e5) * 1.001, 0.0, 0.0))
    assert cons.placement_shift([a, touching], G) == pytest.approx(0.0, abs=1e-6)
    expected = G * 1.0e22 * 1.0e21 * (1 / 1.3e6 - 1 / (1.3e6 * 1.001))
    assert cons.placement_shift([a, apart], G) == pytest.approx(expected, rel=1e-9)
    assert cons.placement_shift([a, apart], G) > 0.0


def test_extreme_mass_ratio_keeps_the_residuals_at_round_off():
    before = pair(m1=1.0e30, m2=1.0e12, r1=7.0e8, r2=1.0e3, v=2.0e4)
    rep, _ = report(before, merged_from(before))
    assert rep.mass_residual_rel <= 1e-15 and rep.momentum_residual_rel <= 1e-12 and rep.within_tolerance
