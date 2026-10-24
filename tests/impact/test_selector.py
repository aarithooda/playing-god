"""Stage 3: outcome-model selector (backend/impact/selector.py; D-039 DQ-7, D-040 DQ-8, D-041 DQ-9, DQ-2). Every branch of the decision
order has a test; an unsupported verdict always yields the labelled fallback, never a plausible-looking outcome."""
import dataclasses

import pytest

from backend.impact.contracts import CollisionInput, Fidelity, Ls12Params, OutcomeSpec
from backend.impact.models.base import OutcomeModel, Unsupported
from backend.impact.models.perfect_merge import PerfectMergeModel
from backend.impact.models.provisional import PROVISIONAL_LABEL
from backend.impact.selector import Selector
from tests.impact.scenarios import G, gas_profile, make_input, profile

SEL = Selector(G)


def test_a_body_without_a_material_gets_the_exact_legacy_merge_labelled_material_unspecified():
    for target, projectile in ((None, "rock"), ("rock", None), (None, None)):
        sel = SEL.select(make_input(v_over_esc=3.0, target=target, projectile=projectile))
        assert sel.route == "perfect_merge" and not sel.fallback
        assert sel.spec.outcome == "legacy_merge" and "material_unspecified" in sel.spec.warnings
        assert sel.spec.largest_remnant.mass_kg == 2.0e22 and sel.spec.debris_mass_kg == 0.0
        assert PROVISIONAL_LABEL not in sel.spec.warnings  # no provisional relation was used


def test_two_rock_bodies_go_to_ls12_with_explicit_provisional_labels():
    sel = SEL.select(make_input(v_over_esc=2.5))
    assert sel.route == "ls12" and not sel.fallback and PROVISIONAL_LABEL in sel.spec.warnings
    assert sel.spec.model_id == "ls12" and sel.spec.parameters["structureClass"].unit == "strong"


def test_structure_class_comes_from_the_profile_never_from_size():
    """DQ-7: the same dimensionless impact on a tiny and on a planet-sized rubble body uses the same profile constants."""
    small = SEL.select(make_input(m_t=1.0e22, m_p=1.0e22, r_t=1.0e6, v_over_esc=2.0, target=profile("rubble-silicate"), projectile=profile("rubble-silicate")))
    big = SEL.select(make_input(m_t=1.0e26, m_p=1.0e26, r_t=1.0e7, v_over_esc=2.0, target=profile("rubble-silicate"), projectile=profile("rubble-silicate")))
    for sel in (small, big):
        assert sel.spec.parameters["cStar"].value == 5.5 and sel.spec.parameters["muBar"].value == 0.365
        assert sel.spec.parameters["structureClass"].unit == "rubble"
    rock = SEL.select(make_input(v_over_esc=2.0))
    assert rock.spec.parameters["cStar"].value == 5.0 and rock.spec.parameters["structureClass"].unit == "strong"


def test_missing_ls12_parameters_or_unsupported_class_fall_back_explicitly():
    for p in (profile("iron"), profile("water-ice")):
        sel = SEL.select(make_input(v_over_esc=2.0, target=p, projectile=p))
        assert sel.fallback and sel.spec.outcome == "perfect_merge" and "unsupported_regime" in sel.spec.warnings
        assert sel.spec.fidelity["outcome"] == Fidelity.UNSUPPORTED and sel.unsupported_reasons
        assert any("no LS12 parameters" in r for r in sel.spec.regime_reasons)
        assert sel.spec.largest_remnant.mass_kg == 2.0e22  # mass is still conserved by the fallback


def test_a_strengthless_planet_profile_with_sourced_constants_is_supported():
    planet = profile(structure_class="strengthless-planet", ls12=Ls12Params(1.9, 0.3, 0.36, "LS12 (hydrodynamic planets), test copy"))
    sel = SEL.select(make_input(v_over_esc=2.5, target=planet, projectile=planet))
    assert sel.route == "ls12" and sel.spec.parameters["cStar"].value == 1.9 and sel.spec.parameters["structureClass"].unit == "strengthless-planet"


def test_mixed_structure_classes_use_the_targets_and_say_so():
    sel = SEL.select(make_input(v_over_esc=2.5, target=profile("silicate-rock"), projectile=profile("rubble-silicate")))
    assert sel.spec.parameters["structureClass"].unit == "strong" and "structure_class_mixed" in sel.spec.warnings
    same = SEL.select(make_input(v_over_esc=2.5))
    assert "structure_class_mixed" not in same.spec.warnings


def test_mixed_materials_rock_and_ice_follow_the_target_profile_and_never_guess():
    # rock target, ice projectile: the target's LS12 block applies (ice has none of its own); structure classes both 'strong'
    sel = SEL.select(make_input(v_over_esc=2.5, target=profile("silicate-rock"), projectile=profile("water-ice")))
    assert sel.route == "ls12" and not sel.fallback
    # ice target (no LS12 block): unsupported -> fallback
    assert SEL.select(make_input(v_over_esc=2.5, target=profile("water-ice"), projectile=profile("silicate-rock"))).fallback


def test_gas_bodies_never_reach_the_rigid_body_model():
    gas_target = SEL.select(make_input(m_t=1.9e27, m_p=1.0e15, r_t=7.0e7, r_p=5.0e2, v=6.0e4, target=gas_profile(1.0), projectile="rock"))
    assert gas_target.route == "envelope" and gas_target.spec.outcome == "envelope_deposition"
    both = SEL.select(make_input(m_t=1.9e27, m_p=5.7e26, r_t=7.0e7, r_p=6.0e7, v=3.0e4, target=gas_profile(1.0), projectile=gas_profile(0.6)))
    assert both.spec.outcome == "envelope_merge_approximation" and both.spec.fidelity["outcome"] == Fidelity.UNSUPPORTED
    rocky_target = SEL.select(make_input(m_t=1.0e26, m_p=1.0e25, r_t=2.5e7, r_p=1.0e7, v=2.0e4, projectile=gas_profile(0.8)))
    assert rocky_target.fallback and rocky_target.spec.outcome == "perfect_merge" and "envelope" in rocky_target.spec.regime_reasons[0]
    # envelope threshold at the selector level: 0.49 is NOT envelope-dominated -> rigid LS12 route (it has an LS12 block via the rock layers)
    below = SEL.select(make_input(v_over_esc=2.0, target=gas_profile(0.49), projectile=gas_profile(0.49)))
    assert below.route == "ls12"


def test_a_small_impactor_goes_to_cratering_which_is_unsupported_without_sourced_constants():
    sel = SEL.select(make_input(m_t=5.97e24, m_p=1.0e12, r_t=6.371e6, r_p=60.0, v=2.0e4))
    assert sel.fallback and sel.spec.outcome == "perfect_merge" and any("cratering" in r for r in sel.spec.regime_reasons)
    assert sel.spec.largest_remnant.mass_kg == 5.97e24 + 1.0e12


def test_strength_regime_disruption_of_small_bodies_is_unsupported_and_mergers_are_not():
    disruptive = SEL.select(make_input(m_t=1.0e12, m_p=5.0e11, r_t=4.0e2, v_over_esc=20.0))
    assert disruptive.fallback and any("strength regime" in r for r in disruptive.spec.regime_reasons)
    assert disruptive.spec.outcome == "perfect_merge" and disruptive.spec.fidelity["outcome"] == Fidelity.UNSUPPORTED
    assert disruptive.spec.largest_remnant.mass_kg == 1.5e12 and disruptive.spec.debris_mass_kg == 0.0  # no invented fragments
    merger = SEL.select(make_input(m_t=1.0e12, m_p=5.0e11, r_t=4.0e2, v_over_esc=0.5))
    assert not merger.fallback and merger.spec.outcome == "perfect_merge"


def test_the_fallback_is_always_a_valid_conserving_merge():
    for kwargs in (dict(target=profile("iron"), projectile=profile("iron")), dict(m_t=1.0e12, m_p=5.0e11, r_t=4.0e2)):
        sel = SEL.select(make_input(v_over_esc=10.0, **kwargs))
        assert sel.fallback and sel.spec.second_remnant is None and sel.spec.debris_mass_kg == 0.0
        assert isinstance(sel.spec, OutcomeSpec) and sel.unsupported_reasons


# ------------------------------------------------------------------------------------------------ extension point
class DummyModel:
    model_id = "dummy-external"
    model_version = "0"

    def __init__(self):
        self.calls = 0
        self.spec = None

    def evaluate(self, data: CollisionInput):
        self.calls += 1
        base = PerfectMergeModel().evaluate(data)
        self.spec = dataclasses.replace(base, model_id=self.model_id, model_version=self.model_version, regime_reasons=("dummy external solver",))
        return self.spec


def test_a_registered_model_passes_through_the_selector_unchanged():
    sel = Selector(G)
    dummy = DummyModel()
    assert isinstance(dummy, OutcomeModel)
    sel.register(lambda data: data.impact.target.mass_kg > 1.0e30, dummy)
    ordinary = sel.select(make_input(v_over_esc=2.0))
    assert dummy.calls == 0 and ordinary.route == "ls12"  # predicate false: built-in routing
    heavy = sel.select(make_input(m_t=2.0e30, m_p=1.0e29, r_t=7.0e8, v_over_esc=2.0))
    assert dummy.calls == 1 and heavy.spec is dummy.spec and heavy.route == "dummy-external" and not heavy.fallback


def test_a_registered_model_that_is_unsupported_triggers_the_labelled_fallback():
    class Refuses:
        model_id, model_version = "refuser", "0"

        def evaluate(self, data):
            return Unsupported(("future solver cannot handle this",))

    sel = Selector(G)
    sel.register(lambda d: True, Refuses())
    result = sel.select(make_input(v_over_esc=2.0))
    assert result.fallback and "future solver cannot handle this" in result.spec.regime_reasons
