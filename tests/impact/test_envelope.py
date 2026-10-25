"""Stage 3: gas-envelope approximations (backend/impact/models/envelope.py, decision D-040). Structural tests: the threshold is a provisional
engineering choice, the results never claim resolved gas dynamics, and gas bodies never reach a rigid-body model."""
import pytest

from backend.impact.contracts import Fidelity
from backend.impact.models.base import Unsupported
from backend.impact.models.envelope import ENVELOPE_GAS_FRACTION_THRESHOLD, EnvelopeModel, gas_mass_fraction, is_envelope_dominated
from backend.impact.models.provisional import PROVISIONAL_LABEL
from tests.impact.scenarios import gas_profile, make_input, profile

MODEL = EnvelopeModel()
M_GIANT, M_ROCK = 1.9e27, 1.0e15


def giant_hit_by_rock(gas_fraction=1.0, projectile=None):
    return make_input(m_t=M_GIANT, m_p=M_ROCK, r_t=7.0e7, r_p=5.0e2, v=6.0e4, target=gas_profile(gas_fraction),
                      projectile=projectile if projectile is not None else "rock")


def test_threshold_is_provisional_and_exactly_one_half():
    assert ENVELOPE_GAS_FRACTION_THRESHOLD == 0.5


@pytest.mark.parametrize("fraction,dominated", [(0.0, False), (0.49, False), (0.4999999, False), (0.5, True), (0.5000001, True), (0.9, True), (1.0, True)])
def test_threshold_boundaries(fraction, dominated):
    p = gas_profile(fraction) if fraction > 0 else profile("silicate-rock")
    assert gas_mass_fraction(p) == pytest.approx(fraction, abs=1e-15)
    assert is_envelope_dominated(p) is dominated


def test_gas_fraction_counts_only_gas_phase_layers():
    p = gas_profile(0.3)
    assert gas_mass_fraction(p) == pytest.approx(0.3) and [l.phase for l in p.layers] == ["gas", "solid"]
    assert gas_mass_fraction(profile("gas-envelope-hhe")) == 1.0  # the shipped registry profile
    assert gas_mass_fraction(profile("iron")) == 0.0


def test_rocky_asteroid_into_a_gas_giant_is_envelope_deposition_without_a_resolved_gas_claim():
    spec = MODEL.evaluate(giant_hit_by_rock(1.0))
    assert spec.outcome == "envelope_deposition" and spec.second_remnant is None and spec.debris_mass_kg == 0.0
    assert spec.largest_remnant.mass_kg == M_GIANT + M_ROCK  # the projectile's mass is deposited, nothing lost
    assert "envelope_dynamics_not_resolved" in spec.warnings and PROVISIONAL_LABEL in spec.warnings
    assert "unsupported_regime" not in spec.warnings
    assert spec.fidelity["outcome"] == Fidelity.APPROXIMATION and spec.fidelity["remnantMasses"] == Fidelity.COMPUTED
    assert spec.energy_partition_j["dissipated"] > 0.0
    assert spec.parameters["threshold"].source.startswith("provisional")
    assert not any("rigid" in r and "applies" in r for r in spec.regime_reasons)


def test_target_just_above_and_just_below_the_threshold_are_handled_differently():
    above = MODEL.evaluate(giant_hit_by_rock(0.5))
    assert not isinstance(above, Unsupported) and above.outcome == "envelope_deposition"
    below = MODEL.evaluate(giant_hit_by_rock(0.49))
    assert isinstance(below, Unsupported) and "neither body is envelope-dominated" in below.reasons[0]


def test_two_gas_giants_get_the_labelled_unsupported_merge_approximation():
    spec = MODEL.evaluate(make_input(m_t=1.9e27, m_p=5.7e26, r_t=7.0e7, r_p=6.0e7, v=3.0e4, target=gas_profile(1.0), projectile=gas_profile(0.9)))
    assert spec.outcome == "envelope_merge_approximation" and spec.largest_remnant.mass_kg == 1.9e27 + 5.7e26
    assert spec.fidelity["outcome"] == Fidelity.UNSUPPORTED
    assert {"envelope_dynamics_not_resolved", "unsupported_regime", PROVISIONAL_LABEL} <= set(spec.warnings)


def test_unequal_envelope_fractions_use_each_bodys_own_fraction():
    spec = MODEL.evaluate(make_input(m_t=1.9e27, m_p=5.7e26, r_t=7.0e7, r_p=6.0e7, v=3.0e4, target=gas_profile(0.5), projectile=gas_profile(0.95)))
    assert spec.parameters["targetGasMassFraction"].value == pytest.approx(0.5)
    assert spec.parameters["projectileGasMassFraction"].value == pytest.approx(0.95)
    assert spec.outcome == "envelope_merge_approximation"
    # the projectile just below the threshold turns the same pair into a deposition
    deposition = MODEL.evaluate(make_input(m_t=1.9e27, m_p=5.7e26, r_t=7.0e7, r_p=6.0e7, v=3.0e4, target=gas_profile(0.95), projectile=gas_profile(0.49)))
    assert deposition.outcome == "envelope_deposition"


def test_mixed_material_collisions_follow_the_gas_fractions_not_the_label():
    iron_rich = giant_hit_by_rock(0.7, projectile=profile("iron"))
    assert MODEL.evaluate(iron_rich).outcome == "envelope_deposition"
    ice_planet_hit_by_gas = make_input(m_t=1.0e26, m_p=1.0e25, r_t=2.5e7, r_p=1.0e7, v=2.0e4, target=profile("water-ice"), projectile=gas_profile(0.8))
    result = MODEL.evaluate(ice_planet_hit_by_gas)
    assert isinstance(result, Unsupported) and "no model exists" in result.reasons[0]


def test_missing_profile_is_unsupported_for_the_envelope_model():
    assert isinstance(MODEL.evaluate(make_input(m_t=M_GIANT, m_p=M_ROCK, r_t=7.0e7, r_p=5.0e2, v=6.0e4, target=gas_profile(1.0), projectile=None)), Unsupported)
