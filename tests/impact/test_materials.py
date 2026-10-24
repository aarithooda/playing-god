"""Stage 2: material profile registry and validation (backend/impact/materials.py, material_profiles.json).

Expected values are the ones recorded with their citation in context/COLLISION_SCIENTIFIC_MODELS.md (4.2 and 5), not values
computed by the code under test. These tests only prove the registry stores and validates them; no outcome model uses them
before Stage 3 (the CP-SCI-1 gate)."""
import dataclasses

import pytest

from backend.errors import CodedError
from backend.impact import contracts as c
from backend.impact import materials as m
from tests.impact import factories as f


def test_registry_contains_exactly_the_sourced_profiles():
    assert [p.id for p in m.list_profiles()] == ["gas-envelope-hhe", "iron", "rubble-silicate", "silicate-rock", "water-ice"]
    # profiles whose numbers are unsourced in the planning documents are NOT shipped (earth-like, icy-rock, gas-giant-core ...)
    assert m.get_profile("earth-like-differentiated") is None and m.get_profile("molten-silicate") is None


def test_ls12_constants_are_the_cited_verbatim_values():
    rock, rubble = m.get_profile("silicate-rock"), m.get_profile("rubble-silicate")
    assert (rock.ls12.c_star, rock.ls12.c_star_uncertainty, rock.ls12.mu_bar) == (5.0, 2.0, 0.37)  # LS12: c* = 5 +/- 2, mu_bar ~ 0.37
    assert (rubble.ls12.c_star, rubble.ls12.mu_bar) == (5.5, 0.365)  # LS12 PKDGRAV rubble fit
    assert "1106.6084" in rock.ls12.source and "745, 79" in rock.ls12.source
    assert rock.structure_class == "strong" and rubble.structure_class == "rubble"


def test_every_number_of_every_profile_has_provenance():
    for profile in m.list_profiles():
        assert m.unsourced_quantities(profile) == [], profile.id
        have = {p.quantity for p in profile.provenance}
        assert m.present_quantities(profile) <= have
        for entry in profile.provenance:
            assert entry.source and entry.basis in ("measured", "literature", "engineering")


def test_a_profile_with_an_unsourced_number_is_rejected():
    rock = m.get_profile("silicate-rock")
    stripped = dataclasses.replace(rock, provenance=tuple(p for p in rock.provenance if p.quantity != "ls12.cStar"))
    with pytest.raises(c.ContractError, match="no provenance"):
        m.validate_profile(stripped)
    with_wave_speed = dataclasses.replace(rock, wave_speed_m_per_s=5000.0)
    assert m.unsourced_quantities(with_wave_speed) == ["waveSpeedMPerS"]
    with pytest.raises(c.ContractError):
        m.validate_profile(with_wave_speed)


def test_missing_quantities_must_be_declared_incomplete_never_guessed():
    iron, ice, gas = m.get_profile("iron"), m.get_profile("water-ice"), m.get_profile("gas-envelope-hhe")
    for profile in (iron, ice, gas):
        assert profile.ls12 is None and "ls12" in profile.incomplete  # LS12 gives no iron/ice/gas c*: nothing assumed
        assert profile.cratering is None and profile.wave_speed_m_per_s is None and profile.strength is None
    assert gas.moment_of_inertia_factor is None and "momentOfInertiaFactor" in gas.incomplete
    assert gas.category == "gas" and gas.structure_class == "envelope-dominated"  # not an ordinary solid (spec 4.2)
    undeclared = dataclasses.replace(iron, incomplete=())
    with pytest.raises(c.ContractError, match="incomplete"):
        m.validate_profile(undeclared)


def test_homogeneous_moment_of_inertia_is_the_analytic_uniform_sphere_value_and_labelled():
    for pid in ("silicate-rock", "rubble-silicate", "iron", "water-ice"):
        profile = m.get_profile(pid)
        assert profile.moment_of_inertia_factor == 0.4  # I = 2/5 M R^2
        prov = next(p for p in profile.provenance if p.quantity == "momentOfInertiaFactor")
        assert prov.basis == "engineering" and "Uniform-density sphere" in prov.source and "approximation" in prov.source


def test_no_profile_is_derived_from_body_type():
    """D-029: bodyType is display metadata. The registry has no profile named after it, and resolve_material never maps it."""
    for display_type in ("rocky-planet", "gas-giant", "ice-giant", "moon", "asteroid", "star", "default"):
        assert m.get_profile(display_type) is None
    assert m.resolve_material(None) is None


def test_resolve_material_accepts_valid_input_and_rejects_the_rest_with_material_invalid():
    ref = m.resolve_material({"profileId": "silicate-rock", "layers": None})
    assert ref == c.MaterialRef("silicate-rock") and m.moment_of_inertia_factor(ref) == 0.4
    override = m.resolve_material({"profileId": "silicate-rock", "layers": [
        {"materialId": "silicate-rock", "massFraction": 0.75, "phase": "solid", "meltFraction": None, "densityKgPerM3": 3000.0},
        {"materialId": "iron", "massFraction": 0.25, "phase": "partial", "meltFraction": 0.5, "densityKgPerM3": None}]})
    assert override.layers[1].melt_fraction == 0.5
    assert m.resolve_material(ref) is ref
    bad_inputs = [
        {"profileId": "no-such-profile"},
        {"profileId": "silicate-rock", "layers": [{"materialId": "a", "massFraction": 0.5, "phase": "solid"}]},  # fractions sum 0.5
        {"profileId": "silicate-rock", "layers": []},
        {"profileId": "silicate-rock", "extra": 1},
        {"profileId": ""},
        "silicate-rock",
    ]
    for bad in bad_inputs:
        with pytest.raises(CodedError) as err:
            m.resolve_material(bad)
        assert err.value.code == "material_invalid" and err.value.status == 422, bad


def test_moment_of_inertia_factor_is_none_without_a_material_or_without_a_sourced_value():
    assert m.moment_of_inertia_factor(None) is None
    assert m.moment_of_inertia_factor(c.MaterialRef("gas-envelope-hhe")) is None
    assert m.moment_of_inertia_factor(c.MaterialRef("iron")) == 0.4


def test_the_registry_is_immutable_and_loaded_profiles_round_trip():
    with pytest.raises(TypeError):
        m.REGISTRY["x"] = m.get_profile("iron")  # type: ignore[index]
    for profile in m.list_profiles():
        assert c.MaterialProfile.from_json(profile.to_json()) == profile


def test_registry_file_rejects_duplicates_and_bad_entries(tmp_path):
    import json
    good = [p.to_dict() for p in m.list_profiles()[:1]]
    path = tmp_path / "dup.json"
    path.write_text(json.dumps(good + good), encoding="utf-8")
    with pytest.raises(c.ContractError, match="duplicate"):
        m.load_registry(path)
    broken = dict(good[0], layers=[])
    path.write_text(json.dumps([broken]), encoding="utf-8")
    with pytest.raises(c.ContractError):
        m.load_registry(path)


def test_contract_accepts_a_null_moment_of_inertia_and_still_bounds_a_present_one():
    base = f.material_profile()
    assert dataclasses.replace(base, moment_of_inertia_factor=None).moment_of_inertia_factor is None
    with pytest.raises(c.ContractError):
        dataclasses.replace(base, moment_of_inertia_factor=0.5)
