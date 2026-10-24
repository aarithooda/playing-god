"""Stage 0: the collision-engine contracts (round trip, validation, canonical digest, policy constants).

Scope: data only. No simulation, no physics. Expected digests are computed independently with hashlib on a literal
canonical string, not with the helper under test."""
import dataclasses
import hashlib
import json
import math
import subprocess
from pathlib import Path

import pytest

from backend.impact import config, contracts as c
from backend.impact.serialization import Contract, ContractError, canonical_digest, canonical_json
from tests.impact import factories as f

ROOT = Path(__file__).resolve().parents[2]


def all_contract_classes() -> list[type]:
    return [obj for obj in vars(c).values()
            if isinstance(obj, type) and issubclass(obj, Contract) and obj is not Contract]


# ---------------------------------------------------------------------------------------------------------------
# Round trip
# ---------------------------------------------------------------------------------------------------------------
def test_every_contract_has_a_factory():
    assert set(all_contract_classes()) == set(f.FACTORIES), "add a factory for every new contract"


@pytest.mark.parametrize("cls", sorted(f.FACTORIES, key=lambda k: k.__name__), ids=lambda k: k.__name__)
def test_json_round_trip_is_identical(cls):
    original = f.FACTORIES[cls]()
    text = original.to_json()
    parsed = cls.from_json(text)
    assert parsed == original
    assert parsed.to_json() == text  # JSON -> object -> JSON identical
    assert json.loads(text) == original.to_dict()  # canonical text is plain JSON of to_dict()


@pytest.mark.parametrize("cls", sorted(f.FACTORIES, key=lambda k: k.__name__), ids=lambda k: k.__name__)
def test_canonical_form_is_sorted_compact_and_ascii(cls):
    text = f.FACTORIES[cls]().to_json()
    assert text == json.dumps(json.loads(text), sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    assert "NaN" not in text and "Infinity" not in text


def test_integer_numbers_are_canonicalised_to_floats():
    v = c.Vec3(1, 2, 3)
    assert v.to_json() == '{"x":1.0,"y":2.0,"z":3.0}'
    assert c.Vec3.from_json('{"x":1,"y":2,"z":3}') == v


def test_factories_leave_only_intentional_fields_null():
    """The round-trip fixtures fill every optional field except the ones listed here, so null handling is the only
    path they do not cover (it is covered by the CollisionConfig and RemnantSpec round trips)."""
    nulls = set()

    def collect(node, path=""):
        if isinstance(node, dict):
            for k, v in node.items():
                collect(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                collect(v, f"{path}[{i}]")
        elif node is None:
            nulls.add(path.split(".")[-1])

    collect(f.collision_record().to_dict())
    collect(f.visual_event().to_dict())
    assert nulls == {"trackedFragmentMinMassFraction", "ybar", "endS", "meltFraction", "durationWallS"}


# ---------------------------------------------------------------------------------------------------------------
# Rejection of invalid inputs
# ---------------------------------------------------------------------------------------------------------------
BAD = float("nan"), float("inf"), float("-inf")


@pytest.mark.parametrize("bad", BAD)
def test_non_finite_floats_are_rejected_on_construction(bad):
    with pytest.raises(ContractError):
        c.Vec3(bad, 0.0, 0.0)
    with pytest.raises(ContractError):
        c.BodyImpactState("a", bad, 1.0, f.vec(), f.vec())


@pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_json_constants_are_rejected_on_parse(token):
    with pytest.raises(ContractError):
        c.Vec3.from_json('{"x":%s,"y":0.0,"z":0.0}' % token)


@pytest.mark.parametrize("mass", [0.0, -1.0])
def test_non_positive_masses_are_rejected(mass):
    with pytest.raises(ContractError):
        c.BodyImpactState("a", mass, 1.0, f.vec(), f.vec())
    with pytest.raises(ContractError):
        c.BodyPost("a", mass, 1.0, f.vec(), f.vec())
    with pytest.raises(ContractError):
        c.ParcelPost("a", mass, 1.0, f.vec(), f.vec(), f.debris_descriptor())
    with pytest.raises(ContractError):
        c.DebrisDescriptor(mass, f.size_distribution(), 1.0, None, 0)
    with pytest.raises(ContractError):
        c.RemnantSpec(mass, "target")


def test_non_positive_radius_and_negative_debris_are_rejected():
    with pytest.raises(ContractError):
        c.BodyImpactState("a", 1.0, 0.0, f.vec(), f.vec())
    spec = f.outcome_spec()
    with pytest.raises(ContractError):
        dataclasses.replace(spec, debris_mass_kg=-1.0)


@pytest.mark.parametrize("q", [(1.0, 0.0, 0.0, 0.0), (-1.0, 0.0, 0.0, 0.0), (f.HALF, 0.0, f.HALF, 0.0)])
def test_unit_quaternions_are_accepted(q):
    assert c.Orientation(q, 0.0).quaternion == q
    assert c.RotationState(f.vec(), q, 0.0, 1.0).q0 == q


@pytest.mark.parametrize("q", [(0.0, 0.0, 0.0, 0.0), (2.0, 0.0, 0.0, 0.0), (1.0 + 1.0e-9, 0.0, 0.0, 0.0), (0.5, 0.5, 0.5, 0.4)])
def test_non_unit_quaternions_are_rejected(q):
    with pytest.raises(ContractError):
        c.Orientation(q, 0.0)
    with pytest.raises(ContractError):
        c.RotationState(f.vec(), q, 0.0, 1.0)


def test_quaternion_tolerance_boundary():
    inside = (1.0 + 0.9e-12, 0.0, 0.0, 0.0)
    outside = (1.0 + 2.0e-12, 0.0, 0.0, 0.0)
    assert c.Orientation(inside, 0.0)
    with pytest.raises(ContractError):
        c.Orientation(outside, 0.0)


def test_quaternion_needs_four_components():
    with pytest.raises(ContractError):
        c.Orientation.from_dict({"quaternion": [1.0, 0.0, 0.0], "epochS": 0.0})


def test_layer_fractions_must_sum_to_one():
    good = (c.Layer("a", 0.25, "solid"), c.Layer("b", 0.75, "solid"))
    assert c.MaterialRef("p", good)
    for bad in ((c.Layer("a", 0.25, "solid"), c.Layer("b", 0.7, "solid")), (c.Layer("a", 0.5, "solid"),),
                (c.Layer("a", 1.0, "solid"), c.Layer("b", 1.0e-9, "solid"))):
        with pytest.raises(ContractError, match="sum to 1"):
            c.MaterialRef("p", bad)
    with pytest.raises(ContractError):
        dataclasses.replace(f.material_profile(), layers=())
    with pytest.raises(ContractError):
        c.Layer("a", 1.5, "solid")
    with pytest.raises(ContractError):
        c.Layer("a", 0.5, "solid", melt_fraction=1.5)


def test_composition_fractions_must_sum_to_one_or_be_empty():
    assert c.RemnantSpec(1.0, "target", ())
    with pytest.raises(ContractError):
        c.RemnantSpec(1.0, "target", (c.CompositionLayer("a", 0.5),))


def test_fractions_summing_within_tolerance_are_accepted():
    third = 1.0 / 3.0
    assert c.MaterialRef("p", (c.Layer("a", third, "solid"), c.Layer("b", third, "solid"), c.Layer("c", third, "solid")))


def test_material_profile_requires_provenance_and_valid_moment_of_inertia():
    profile = f.material_profile()
    with pytest.raises(ContractError):
        dataclasses.replace(profile, provenance=())
    for k in (0.0, -0.1, 0.41):
        with pytest.raises(ContractError):
            dataclasses.replace(profile, moment_of_inertia_factor=k)
    assert dataclasses.replace(profile, moment_of_inertia_factor=0.4)
    with pytest.raises(ContractError):
        dataclasses.replace(profile, id="Not Kebab")
    with pytest.raises(ContractError):
        c.Ls12Params(5.0, 2.0, 0.37, "")  # a citation is mandatory
    with pytest.raises(ContractError):
        c.Provenance("q", 1.0, "", None, "literature")


def test_unknown_missing_and_mistyped_fields_are_rejected():
    good = f.vec().to_dict()
    with pytest.raises(ContractError, match="unknown field"):
        c.Vec3.from_dict({**good, "w": 0.0})
    with pytest.raises(ContractError, match="missing required"):
        c.Vec3.from_dict({"x": 1.0, "y": 2.0})
    with pytest.raises(ContractError):
        c.Vec3.from_dict({**good, "x": "1.0"})
    with pytest.raises(ContractError):
        c.Vec3.from_dict({**good, "x": True})
    with pytest.raises(ContractError):
        c.Vec3.from_json("[1, 2, 3]")
    with pytest.raises(ContractError):
        c.Vec3.from_json("{not json")
    bad_enum = f.outcome_spec().to_dict()
    bad_enum["outcome"] = "explosion"
    with pytest.raises(ContractError):
        c.OutcomeSpec.from_dict(bad_enum)
    bad_fid = f.outcome_spec().to_dict()
    bad_fid["fidelity"]["x"] = "guess"
    with pytest.raises(ContractError):
        c.OutcomeSpec.from_dict(bad_fid)


def test_unsupported_schema_version_is_rejected():
    data = f.collision_input().to_dict()
    data["schemaVersion"] = 2
    with pytest.raises(ContractError, match="unsupported version"):
        c.CollisionInput.from_dict(data)
    with pytest.raises(ContractError):
        c.CollisionConfig(schema_version=0)


def test_every_versioned_contract_writes_schema_version_one():
    for cls, make in f.FACTORIES.items():
        names = {fld.name for fld in dataclasses.fields(cls)}
        if "schema_version" in names:
            assert make().to_dict()["schemaVersion"] == c.SCHEMA_VERSION == 1


def test_impact_state_geometry_bounds():
    base = f.impact_state()
    with pytest.raises(ContractError):
        dataclasses.replace(base, impact_parameter=1.2)
    with pytest.raises(ContractError):
        dataclasses.replace(base, mass_ratio=1.5)  # gamma = projectile / target <= 1 by construction
    with pytest.raises(ContractError):
        dataclasses.replace(base, contact_normal=f.vec(2.0, 0.0, 0.0))
    with pytest.raises(ContractError):
        dataclasses.replace(base, total_mass_kg=0.0)


def test_result_rejects_duplicate_product_ids_and_bad_digest():
    result = f.collision_result()
    with pytest.raises(ContractError, match="more than once"):
        dataclasses.replace(result, created=(f.body_post("target"),))
    with pytest.raises(ContractError):
        dataclasses.replace(result, result_digest="xyz")
    with pytest.raises(ContractError):
        dataclasses.replace(f.collision_input(), input_digest="ABC")


def test_site_and_event_bounds():
    with pytest.raises(ContractError):
        dataclasses.replace(f.impact_site(), center_local=f.vec(1.0, 1.0, 1.0))
    with pytest.raises(ContractError):
        dataclasses.replace(f.collision_event(), generation=-1)
    with pytest.raises(ContractError):
        dataclasses.replace(f.collision_event(), largest_remnant_mass_kg=0.0)


# ---------------------------------------------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------------------------------------------
def test_config_defaults_match_the_plan():
    cfg = c.CollisionConfig()
    assert (cfg.mode, cfg.seed) == ("legacy-merge", 12345)
    assert (cfg.max_tracked_fragments_per_event, cfg.max_tracked_fragments_total) == (16, 64)
    assert (cfg.max_debris_parcels_per_event, cfg.max_debris_parcels_total) == (4, 32)
    assert (cfg.max_resolutions_per_step, cfg.max_fragmenting_generation, cfg.reserve_for_user) == (64, 2, 8)
    assert (cfg.escape_removal_radius_factor, cfg.separation_epsilon) == (1000.0, 1.0e-3)
    assert cfg.tracked_fragment_min_mass_fraction is None  # DQ-6 is open: no invented default
    t = cfg.tolerances
    assert (t.mass_rel, t.momentum_rel, t.angular_momentum_rel) == (1e-14, 1e-12, 1e-10)
    assert (t.dissipated_energy_floor_rel, t.contact_distance_rel, t.replay_cross_platform_rel) == (1e-9, 1e-9, 1e-12)


def test_default_sandbox_mode_is_legacy_merge_until_stage_4b():
    """D-033: flipped only by Stage 4 step 4b. A change here must come with tests/impact/test_mode_defaults.py."""
    assert config.DEFAULT_SANDBOX_MODE == "legacy-merge"
    assert c.DEFAULT_SANDBOX_MODE == "legacy-merge"
    assert c.CollisionConfig().mode == "legacy-merge"


def test_config_validation():
    assert c.CollisionConfig(mode="outcome-v1").mode == "outcome-v1"
    for kwargs in ({"mode": "other"}, {"seed": -1}, {"seed": 2**63}, {"max_tracked_fragments_per_event": 100},
                   {"max_debris_parcels_per_event": 99}, {"max_resolutions_per_step": 0},
                   {"max_fragmenting_generation": -1}, {"tracked_fragment_min_mass_fraction": 0.0},
                   {"tracked_fragment_min_mass_fraction": 1.0}, {"escape_removal_radius_factor": 0.0},
                   {"separation_epsilon": 0.0}, {"separation_epsilon": 1.0}):
        with pytest.raises(ContractError):
            c.CollisionConfig(**kwargs)
    assert c.CollisionConfig(seed=2**63 - 1, tracked_fragment_min_mass_fraction=1.0e-3)
    with pytest.raises(ContractError):
        c.CollisionTolerances(mass_rel=0.0)


def test_default_seed_equals_the_service_seed():
    from backend.simulation import RAND_SEED
    assert config.DEFAULT_SEED == RAND_SEED


# ---------------------------------------------------------------------------------------------------------------
# Digest
# ---------------------------------------------------------------------------------------------------------------
def test_digest_of_a_fixed_object_equals_independently_computed_hex():
    literal = '{"x":1.0,"y":2.0,"z":3.0}'
    expected = hashlib.sha256(literal.encode("utf-8")).hexdigest()
    assert expected == "045bb11d10ab31508b09beaa03468e72b2f9335e69c298f0335e84d519bbda69"  # typed from hashlib, not the code
    assert f.vec().to_json() == literal
    assert f.vec().digest() == expected
    assert canonical_digest(f.vec()) == expected
    assert canonical_digest({"z": 3.0, "y": 2.0, "x": 1.0}) == expected  # key order never matters


def test_digest_of_the_default_tolerances_equals_independently_computed_hex():
    literal = ('{"angularMomentumRel":1e-10,"contactDistanceRel":1e-09,"dissipatedEnergyFloorRel":1e-09,'
               '"massRel":1e-14,"momentumRel":1e-12,"replayCrossPlatformRel":1e-12}')
    expected = hashlib.sha256(literal.encode("utf-8")).hexdigest()
    assert expected == "9b2278309fb431e9414fd23c167395f8c2a473a09723b4ba8da3053f18c610dc"
    assert c.CollisionTolerances().to_json() == literal
    assert c.CollisionTolerances().digest() == expected


def test_digest_changes_with_any_value_and_survives_a_round_trip():
    a = f.collision_input()
    b = dataclasses.replace(a, seed=a.seed + 1)
    assert a.compute_digest() != b.compute_digest()
    assert c.CollisionInput.from_json(a.to_json()).compute_digest() == a.compute_digest()
    stamped = dataclasses.replace(a, input_digest=a.compute_digest())
    assert stamped.compute_digest() == a.compute_digest()  # the digest never covers itself
    r = f.collision_result()
    assert dataclasses.replace(r, result_digest=r.compute_digest()).compute_digest() == r.compute_digest()


def test_canonical_json_refuses_non_finite_plain_data():
    with pytest.raises(ValueError):
        canonical_json({"a": float("nan")})


# ---------------------------------------------------------------------------------------------------------------
# Visual-only effects carry no mass (DQ-12)
# ---------------------------------------------------------------------------------------------------------------
def test_visual_only_effect_has_no_mass_field():
    names = [fld.name for fld in dataclasses.fields(c.VisualOnlyEffect)]
    assert sorted(names) == ["intensity", "kind", "lifetime_wall_s"]
    assert not any("mass" in n.lower() for n in names)
    with pytest.raises(ContractError, match="unknown field"):
        c.VisualOnlyEffect.from_dict({"kind": "flash", "intensity": 0.5, "lifetimeWallS": 1.0, "massKg": 1.0})
    with pytest.raises(ContractError):
        c.VisualOnlyEffect("flash", 1.5, 1.0)
    with pytest.raises(ContractError):
        c.VisualOnlyEffect("flash", 0.5, 0.0)
    with pytest.raises(ContractError):
        c.VisualOnlyEffect("debris", 0.5, 1.0)


def test_visual_phases_distinguish_simulation_time_from_wall_clock():
    assert c.VisualPhase("flash", 0.0, None, "visual-wall-clock", 0.5).basis == "visual-wall-clock"
    with pytest.raises(ContractError):
        c.VisualPhase("flash", 5.0, 1.0, "simulation-time")


def test_fidelity_labels_match_the_plan():
    assert [x.value for x in c.Fidelity] == ["computed", "model", "approximation", "statistical", "visual", "unsupported"]


# ---------------------------------------------------------------------------------------------------------------
# Stage 0 scope guard: nothing existing imports the new package, no behaviour change
# ---------------------------------------------------------------------------------------------------------------
# Existing modules that may import backend.impact. Stage 0: none. Stage 1: the legacy resolver shares the merge
# arithmetic (collisions.py) and the service hosts the deferred engine (simulation.py). Add a module here only together
# with the stage that wires it, and say so in DECISIONS.md.
ALLOWED_IMPACT_IMPORTERS = {"collisions.py", "simulation.py"}


def test_only_the_wired_modules_import_backend_impact():
    offenders = []
    for path in (ROOT / "backend").rglob("*.py"):
        rel = path.relative_to(ROOT / "backend")
        if rel.parts[0] == "impact":
            continue
        text = path.read_text(encoding="utf-8")
        if ("backend.impact" in text or "from backend import impact" in text) and str(rel).replace("\\", "/") not in ALLOWED_IMPACT_IMPORTERS:
            offenders.append(str(rel))
    assert offenders == []


def test_impact_package_does_not_depend_on_the_simulation_service():
    for path in (ROOT / "backend" / "impact").glob("*.py"):
        text = path.read_text(encoding="utf-8")
        for forbidden in ("import rebound", "from backend.simulation", "import backend.simulation"):
            assert forbidden not in text, f"{path.name} imports {forbidden}"


def test_git_grep_check_matches_the_stage_acceptance_command():
    out = subprocess.run(["git", "grep", "-l", "backend.impact", "--", "backend/"], cwd=ROOT, capture_output=True, text=True)
    files = sorted(ln for ln in out.stdout.splitlines() if not ln.startswith("backend/impact/"))
    assert files == sorted("backend/" + name for name in ALLOWED_IMPACT_IMPORTERS)
