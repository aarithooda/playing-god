"""Stage 3: the gravity-regime outcome functions and model (backend/impact/models/ls12.py). PROVISIONAL (D-038): these tests pin the
selected equations and their outputs against reference values typed in reference_values.py and against analytic identities. They do
NOT show that the equations reproduce the paper's worked examples (UD-1 and UD-2 are open); `test_ud*` document that openly."""
import math

import pytest

from backend.impact import contracts as c
from backend.impact.models import ls12 as m
from backend.impact.models.base import Unsupported
from backend.impact.models.provisional import ITEMS, PROVISIONAL_LABEL, REGISTRY
from tests.impact import reference_values as ref
from tests.impact.scenarios import G, make_input, profile

MODEL = m.LS12Model(G)


def outcome_of(**kwargs):
    return MODEL.evaluate(make_input(**kwargs))


# ------------------------------------------------------------------------------------------------ definitions and identities
def test_specific_impact_energy_follows_eq_1():
    m_t, m_p, v = 3.0e22, 1.0e22, 2500.0
    mu = m_t * m_p / (m_t + m_p)
    assert m.reduced_mass(m_t, m_p) == mu
    assert m.specific_impact_energy(m_t, m_p, v) == pytest.approx(0.5 * mu * v * v / (m_t + m_p), rel=1e-15)


def test_r_c1_is_the_radius_of_the_combined_mass_at_rho_1():
    r = m.r_c1(4.0e15 * 2)  # 8e15 kg at 1000 kg/m^3
    assert 4.0 / 3.0 * math.pi * r ** 3 * 1000.0 == pytest.approx(8.0e15, rel=1e-13)


def test_universal_law_identities():
    assert m.largest_remnant_fraction(0.0) == 1.0
    assert m.largest_remnant_fraction(1.0) == 0.5  # Q_R = Q'*_RD disperses half the mass (definition of Q*_RD)
    for x in (0.2, 0.9, 1.3):
        slope = (m.largest_remnant_fraction(x + 1e-3) - m.largest_remnant_fraction(x)) / 1e-3
        assert slope == pytest.approx(-0.5, abs=1e-12)  # linear with slope -1/2 up to the transition
    with pytest.raises(ValueError):
        m.largest_remnant_fraction(-1.0)


def test_super_catastrophic_law_is_continuous_at_the_transition_and_decreasing():
    below = m.largest_remnant_fraction_linear(1.8)
    above = m.largest_remnant_fraction_supercatastrophic(1.8)
    assert below == pytest.approx(0.1, abs=1e-15) and above == pytest.approx(0.1, abs=1e-15)  # both laws give M_lr/M_tot = 0.1 at 1.8
    assert abs(m.largest_remnant_fraction(1.8 + 1e-12) - m.largest_remnant_fraction(1.8)) <= 1e-12
    values = [m.largest_remnant_fraction(x) for x in (1.8, 2.0, 3.0, 10.0, 100.0)]
    assert values == sorted(values, reverse=True) and all(v > 0 for v in values)
    assert m.largest_remnant_fraction(10.0) == pytest.approx(0.1 * (10.0 / 1.8) ** -1.5, rel=1e-13)  # the power law with eta = -1.5


# ------------------------------------------------------------------------------------------------ disruption thresholds
def test_q_star_rd_gamma1_follows_eq_28_for_a_traced_input():
    assert m.q_star_rd_gamma1(ref.C_STAR_SMALL, 2000.0, G) == pytest.approx(ref.Q_RD_GAMMA1_R2000_C5, rel=1e-12)
    assert m.q_star_rd_gamma1(10.0, 2000.0, G) == pytest.approx(2 * ref.Q_RD_GAMMA1_R2000_C5, rel=1e-12)  # linear in c*
    assert m.q_star_rd_gamma1(5.0, 4000.0, G) == pytest.approx(4 * ref.Q_RD_GAMMA1_R2000_C5, rel=1e-12)  # quadratic in R_C1


def test_ud1_is_open_the_paper_example_is_not_reproduced_and_is_documented_as_such():
    """UD-1 (D-038): with the equation as transcribed, R_C1 = 2 km gives 3.35 J/kg, not the printed 5.3 J/kg. This test states the
    difference and the arithmetic leads for the reviewer; it does NOT assert agreement."""
    computed = m.q_star_rd_gamma1(ref.C_STAR_SMALL, 2000.0, G)
    assert computed != pytest.approx(ref.UD1_PAPER_Q_RD, rel=0.05)
    assert math.sqrt(8.0 * ref.UD1_PAPER_Q_RD) == pytest.approx(ref.UD1_PAPER_V_STAR, rel=0.01)  # the printed V* is consistent with the printed Q*
    implied = 2000.0 * math.sqrt(ref.UD1_PAPER_Q_RD / computed)
    assert implied == pytest.approx(ref.UD1_IMPLIED_R_C1_M, abs=1.0)  # the R_C1 the same formula would need for 5.3 J/kg
    assert "LS12-eq28-qrd-gamma1" in ITEMS and "UD-1" in ITEMS["LS12-eq28-qrd-gamma1"].open_item


@pytest.mark.parametrize("gamma", sorted(ref.MASS_RATIO_FACTOR_MU_BAR_0P37))
def test_mass_ratio_correction_against_the_independently_typed_values(gamma):
    r_c = 5000.0
    q1 = m.q_star_rd_gamma1(5.0, r_c, G)
    assert m.q_star_rd(5.0, 0.37, gamma, r_c, G) == pytest.approx(q1 * ref.MASS_RATIO_FACTOR_MU_BAR_0P37[gamma], rel=1e-12)


def test_mass_ratio_correction_is_one_for_equal_masses_and_grows_for_small_projectiles():
    assert m.q_star_rd(5.0, 0.37, 1.0, 3000.0, G) == m.q_star_rd_gamma1(5.0, 3000.0, G)
    qs = [m.q_star_rd(5.0, 0.37, g_, 3000.0, G) for g_ in (1.0, 0.5, 0.1, 0.01)]
    assert qs == sorted(qs)  # a smaller projectile is harder to disrupt with (per unit total mass)
    with pytest.raises(ValueError):
        m.q_star_rd(5.0, 0.37, 1.5, 3000.0, G)


def test_b_crit_equal_densities_is_pinned_and_ud2_is_documented_as_open():
    r_t = 1.0e6
    r_p = r_t * 0.1 ** (1.0 / 3.0)
    assert m.b_crit(r_t, r_p) == pytest.approx(ref.B_CRIT_GAMMA_0P1_EQUAL_DENSITY, rel=1e-12)
    assert m.b_crit(r_t, r_p) != pytest.approx(ref.UD2_PAPER_B_CRIT, abs=0.01)  # UD-2: 0.683 vs the printed 0.66 (open, D-038)
    assert m.b_crit(1.0, 1.0) == 0.5 and m.b_crit(1.0, 1.0e-9) == pytest.approx(1.0, abs=1e-8)
    needed_radius_ratio = 1.0 / ref.UD2_PAPER_B_CRIT - 1.0
    assert needed_radius_ratio == pytest.approx(0.515, abs=1e-3)  # the R_p/R_t the printed 0.66 would need (lead for the reviewer)


# ------------------------------------------------------------------------------------------------ interacting mass
def test_interacting_mass_fraction_limits_and_monotonicity():
    r_t, r_p = 6.0e6, 1.0e6
    assert m.interacting_mass_fraction(r_t, r_p, 0.0) == 1.0  # head-on: the whole projectile interacts
    assert m.interacting_mass_fraction(r_t, r_p, 1.0) == 0.0  # fully grazing: none
    l_equals_2r = 1.0 - 2.0 * r_p / (r_t + r_p)  # the b at which l = 2r: alpha reaches 1 continuously
    assert m.interacting_mass_fraction(r_t, r_p, l_equals_2r) == pytest.approx(1.0, abs=1e-12)
    # l = r gives alpha = (3 r^3 - r^3) / (4 r^3) = 1/2 exactly
    b_half = 1.0 - r_p / (r_t + r_p)
    assert m.interacting_mass_fraction(r_t, r_p, b_half) == pytest.approx(0.5, abs=1e-12)
    alphas = [m.interacting_mass_fraction(r_t, r_p, b / 100.0) for b in range(0, 101)]
    assert alphas == sorted(alphas, reverse=True) and all(0.0 <= a <= 1.0 for a in alphas)
    with pytest.raises(ValueError):
        m.interacting_mass_fraction(r_t, r_p, 1.2)


def test_q_prime_equals_q_star_for_a_fully_interacting_projectile_and_grows_otherwise():
    m_t, m_p = 5.0e24, 1.0e24
    mu = m_t * m_p / (m_t + m_p)
    assert m.interacting_reduced_mass(m_t, m_p, 1.0) == pytest.approx(mu, rel=1e-15)
    assert m.q_prime_star_rd(7.0, mu, m.interacting_reduced_mass(m_t, m_p, 1.0), 0.37) == pytest.approx(7.0, rel=1e-14)
    assert m.q_prime_star_rd(7.0, mu, m.interacting_reduced_mass(m_t, m_p, 0.3), 0.37) > 7.0  # less mass interacts -> harder to disrupt
    assert m.q_prime_star_rd(7.0, mu, mu * 0.5, 0.37) == pytest.approx(7.0 * 2.0 ** (2.0 - 1.5 * 0.37), rel=1e-14)  # the printed exponent 2 - 3 mubar/2


# ------------------------------------------------------------------------------------------------ Genda et al. boundary
def test_g12_formula_matches_the_transcribed_coefficients_and_limits():
    k = ref.G12_COEFFICIENTS
    for gamma, b in ((1.0, 0.0), (0.5, 0.3), (0.1, 0.7), (0.01, 0.9)):
        big_gamma, theta = (1 - gamma) / (1 + gamma), 1 - b
        expected = (k["c1"] * big_gamma * theta ** k["c5"] + k["c2"] * big_gamma + k["c3"] * theta ** k["c5"] + k["c4"])
        assert m.graze_and_merge_speed_ratio(gamma, b) == pytest.approx(expected, rel=1e-14)
    assert m.graze_and_merge_speed_ratio(1.0, 0.0) == pytest.approx(1.86 + 1.08, rel=1e-14)  # Gamma = 0, Theta = 1
    assert m.graze_and_merge_speed_ratio(1.0, 1.0) == pytest.approx(1.08, rel=1e-14)  # tangent: Theta = 0
    bs = [i / 20 for i in range(21)]
    ratios = [m.graze_and_merge_speed_ratio(0.3, b) for b in bs]
    assert ratios == sorted(ratios, reverse=True)  # a more oblique impact needs less speed to escape: v_cr falls with b


@pytest.mark.parametrize("big_gamma,theta_deg,value,tol", ref.G12_PAPER_POINTS)
def test_g12_reproduces_the_relayed_paper_points_for_equal_masses(big_gamma, theta_deg, value, tol):
    b = math.sin(math.radians(theta_deg))
    assert m.graze_and_merge_speed_ratio(1.0, b) == pytest.approx(value, abs=tol)


# ------------------------------------------------------------------------------------------------ the model: regimes
def test_below_the_escape_speed_the_bodies_merge_without_any_strength_model():
    spec = outcome_of(v_over_esc=0.8, b=0.4)
    assert spec.outcome == "perfect_merge" and spec.largest_remnant.mass_kg == 2.0e22 and spec.debris_mass_kg == 0.0
    assert PROVISIONAL_LABEL in spec.warnings
    # a tiny strong body merges below v_esc too: no size restriction for mergers
    small = outcome_of(m_t=1.0e12, m_p=1.0e12, r_t=5.0e2, v_over_esc=0.5)
    assert small.outcome == "perfect_merge"


def test_regime_sequence_with_increasing_speed_is_ordered_and_largest_remnant_never_increases():
    order = ["perfect_merge", "partial_accretion", "partial_erosion", "catastrophic_disruption", "super_catastrophic_disruption"]
    seen, remnants = [], []
    for k in range(0, 400):
        spec = outcome_of(m_t=1.0e22, m_p=5.0e21, r_t=1.0e6, v_over_esc=0.5 + 0.05 * k, b=0.0)
        assert not isinstance(spec, Unsupported)
        if not seen or seen[-1] != spec.outcome:
            seen.append(spec.outcome)
        remnants.append(spec.largest_remnant.mass_kg)
    assert seen == [o for o in order if o in seen] and seen[0] == "perfect_merge" and seen[-1] == "super_catastrophic_disruption"
    assert "catastrophic_disruption" in seen
    assert all(a >= b - 1e-6 * a for a, b in zip(remnants, remnants[1:]))  # monotone: faster -> smaller (or equal) largest remnant


def test_the_regime_is_taken_from_the_model_value_not_a_hard_coded_range():
    spec = outcome_of(m_t=1.0e22, m_p=1.0e22, r_t=1.0e6, v_over_esc=3.0, b=0.0)
    ratio = spec.parameters["QRatio"].value
    frac = spec.parameters["largestRemnantFraction"].value
    assert (spec.outcome == "super_catastrophic_disruption") == (ratio >= 1.8)
    assert spec.largest_remnant.mass_kg == pytest.approx(frac * 2.0e22, rel=1e-14)
    assert spec.largest_remnant.mass_kg + spec.debris_mass_kg == pytest.approx(2.0e22, rel=1e-14)  # nothing is lost


def test_mass_is_accounted_in_every_outcome():
    for v in (0.9, 1.05, 1.5, 2.5, 5.0, 12.0):
        for b in (0.0, 0.3, 0.6):
            spec = outcome_of(m_t=2.0e22, m_p=3.0e21, r_t=1.2e6, v_over_esc=v, b=b)
            if isinstance(spec, Unsupported):
                continue
            second = spec.second_remnant.mass_kg if spec.second_remnant else 0.0
            assert spec.largest_remnant.mass_kg + second + spec.debris_mass_kg == pytest.approx(2.3e22, rel=1e-13), (v, b, spec.outcome)


def test_c_star_scales_the_threshold_exactly_with_identical_geometry():
    base = make_input(v_over_esc=2.0)
    soft = profile(ls12=c.Ls12Params(1.9, 0.3, 0.36, "test"))  # strengthless-planet-like constants
    hard = profile(ls12=c.Ls12Params(5.0, 2.0, 0.36, "test"))
    import dataclasses
    def with_profile(p):
        return dataclasses.replace(base, impact=dataclasses.replace(base.impact, target=dataclasses.replace(base.impact.target, material_profile=p)))
    a, b = MODEL.evaluate(with_profile(soft)), MODEL.evaluate(with_profile(hard))
    assert b.parameters["QStarRD"].value / a.parameters["QStarRD"].value == pytest.approx(5.0 / 1.9, rel=1e-13)  # exactly the c* ratio
    assert a.parameters["largestRemnantFraction"].value < b.parameters["largestRemnantFraction"].value  # weaker body loses more


def test_scenario_c_hit_and_run_is_chosen_by_the_model():
    """Scenario C geometry: b = 0.7, v_i = 1.5 v_esc, gamma = 0.1 (equal densities, so b_crit = 0.683 < 0.7)."""
    spec = outcome_of(m_t=1.0e24, m_p=1.0e23, r_t=2.0e6, v_over_esc=1.5, b=0.7)
    assert spec.outcome == "hit_and_run"
    assert spec.second_remnant is not None and spec.second_remnant.mass_kg == 1.0e23
    assert spec.largest_remnant.mass_kg <= 1.0e24 * (1 + 1e-15)
    assert "projectile_erosion_not_modelled" in spec.warnings and "g12_protoplanet_calibration" in spec.warnings
    assert spec.parameters["vCriticalGrazeAndMerge"].value < 1.5 * spec.parameters["escapeSpeedPhysicalRadii"].value
    total = spec.largest_remnant.mass_kg + spec.second_remnant.mass_kg + spec.debris_mass_kg
    assert total == pytest.approx(1.1e24, rel=1e-13)


def test_slow_grazing_impact_is_graze_and_merge():
    spec = outcome_of(m_t=1.0e24, m_p=1.0e23, r_t=2.0e6, v_over_esc=1.05, b=0.75)
    assert spec.outcome == "graze_and_merge" and spec.largest_remnant.mass_kg == 1.1e24 and spec.second_remnant is None


def test_head_on_equal_masses_at_high_speed_are_catastrophic_or_worse():
    spec = outcome_of(m_t=1.0e22, m_p=1.0e22, r_t=1.0e6, v_over_esc=6.0, b=0.0)
    assert spec.outcome in ("catastrophic_disruption", "super_catastrophic_disruption")
    assert spec.largest_remnant.mass_kg <= 0.5 * 2.0e22 * (1 + 1e-12)


def test_oblique_impacts_disrupt_less_than_head_on_at_the_same_speed():
    head_on = outcome_of(m_t=1.0e22, m_p=1.0e22, r_t=1.0e6, v_over_esc=4.0, b=0.0).largest_remnant.mass_kg
    oblique = outcome_of(m_t=1.0e22, m_p=1.0e22, r_t=1.0e6, v_over_esc=4.0, b=0.45).largest_remnant.mass_kg
    assert oblique >= head_on


# ------------------------------------------------------------------------------------------------ validity envelope and labels
def test_disruption_of_small_bodies_is_unsupported_not_a_plausible_looking_outcome():
    """D-041: below the LS12 simulation set's smallest target (1e4 m) the strength regime may matter."""
    small = dict(m_t=1.0e12, m_p=5.0e11, r_t=4.0e2, v_over_esc=20.0, b=0.0)
    result = outcome_of(**small)
    assert isinstance(result, Unsupported)
    assert any("strength regime" in reason for reason in result.reasons)
    big = outcome_of(m_t=1.0e22, m_p=5.0e21, r_t=1.0e6, v_over_esc=20.0, b=0.0)
    assert not isinstance(big, Unsupported)  # the same dimensionless impact at planetary size is supported


def test_small_body_hit_and_run_is_also_unsupported():
    result = outcome_of(m_t=1.0e12, m_p=1.0e11, r_t=4.0e2, v_over_esc=3.0, b=0.8)
    assert isinstance(result, Unsupported) or result.outcome == "graze_and_merge"


def test_extrapolated_velocity_is_labelled():
    fast = outcome_of(m_t=1.0e24, m_p=1.0e24, r_t=2.0e6, v=2.0e4, b=0.0)
    assert "outside_calibration_velocity" in fast.warnings and fast.fidelity["outcome"] == c.Fidelity.APPROXIMATION
    inside = outcome_of(m_t=1.0e22, m_p=1.0e22, r_t=1.0e6, v=3.0e3, b=0.0)
    assert "outside_calibration_velocity" not in inside.warnings and inside.fidelity["outcome"] == c.Fidelity.MODEL


def test_spin_is_recorded_but_not_used():
    still = outcome_of(v_over_esc=2.0)
    spinning = outcome_of(v_over_esc=2.0, spin=7.0e-5)
    assert "spin_not_in_model" in spinning.warnings and "spin_not_in_model" not in still.warnings
    assert still.largest_remnant == spinning.largest_remnant and still.outcome == spinning.outcome


def test_target_without_ls12_parameters_is_unsupported_with_a_clear_reason():
    result = MODEL.evaluate(make_input(v_over_esc=2.0, target=profile("iron")))
    assert isinstance(result, Unsupported) and "no LS12 parameters" in result.reasons[0]
    assert isinstance(MODEL.evaluate(make_input(v_over_esc=2.0, target=None)), Unsupported)


def test_every_provisional_function_is_registered_and_every_item_is_used():
    used = set(REGISTRY.values())
    assert used <= set(ITEMS)
    # ENV threshold, validity and graze/hit-and-run/escape items are used by name inside models or documented as engineering choices
    required = {"LS12-eq28-qrd-gamma1", "LS12-eq6-bcrit", "LS12-eq23-mass-ratio", "LS12-eq11-15-interacting-mass", "LS12-eq5-universal-law",
                "LS12-eq44-supercatastrophic", "G12-eq16-graze-and-merge"}
    import backend.impact.models.envelope, backend.impact.models.cratering  # noqa: F401  (register their items)
    assert required <= set(REGISTRY.values())
    assert {"ENV-0.5-threshold", "HH11-cratering-form"} <= set(REGISTRY.values())
    for item in ITEMS.values():
        assert item.status in ("transcribed", "unverified", "engineering") and item.open_item and item.source
