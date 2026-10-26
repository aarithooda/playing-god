"""Stage 4b (CP-4b, D-045): the collision mode a universe gets at creation, per role.

sandbox (startup `uni-default` and every new sandbox) -> outcome-v1; preset and Orbit Lab (baseline, modified) -> legacy-merge until Stage 11.
The mode is fixed for the life of the universe: step, reset, snapshot restore and derivation never change it. A body without a material
profile still resolves with the exact legacy merge in a sandbox (DQ-2), so a plain sandbox keeps producing legacy `merger` events.
"""
import pytest
from fastapi.testclient import TestClient

from backend import orbit_lab, universes
from backend.api_universes import create_preset_universe
from backend.impact.config import DEFAULT_SANDBOX_MODE, CollisionConfig
from backend.main import app
from backend.models import BodyCreate
from backend.simulation import LEGACY_MERGE_CONFIG, SimulationService

EXPERIMENT = "exp01-sun-emb-j2000"
PRESET = "solar-system-j2000"


def mode(universe) -> str:
    return universe.engine.collision_config.mode


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def lab(registry):
    return orbit_lab.OrbitLab(registry)


def body(name, x, vx, material=None):
    data = {"name": name, "massKg": 1.0e22, "radiusM": 1.0e5, "positionM": {"x": x, "y": 0.0, "z": 0.0},
            "velocityMPerS": {"x": vx, "y": 0.0, "z": 0.0}, "colorHex": "#aaaaaa"}
    if material:
        data["material"] = {"profileId": material}
    return BodyCreate(**data)


# ---------------------------------------------------------------------------------------------------------------
# The constant and the engine default
# ---------------------------------------------------------------------------------------------------------------
def test_the_default_is_outcome_v1_and_the_legacy_config_is_explicit():
    assert DEFAULT_SANDBOX_MODE == "outcome-v1"
    assert CollisionConfig().mode == "outcome-v1" and SimulationService().collision_config.mode == "outcome-v1"
    assert LEGACY_MERGE_CONFIG.mode == "legacy-merge" and SimulationService(LEGACY_MERGE_CONFIG).collision_config.mode == "legacy-merge"


# ---------------------------------------------------------------------------------------------------------------
# Sandbox
# ---------------------------------------------------------------------------------------------------------------
def test_the_startup_uni_default_is_outcome_v1(registry):
    assert registry.active_id == universes.DEFAULT_UNIVERSE_ID
    default = registry.get(universes.DEFAULT_UNIVERSE_ID)
    assert default.role == "sandbox" and mode(default) == "outcome-v1" and default.engine._deferred


def test_a_new_sandbox_through_the_registry_and_the_api_is_outcome_v1(registry, client):
    assert mode(registry.create("direct")) == "outcome-v1"
    r = client.post("/api/v1/universes", json={"name": "via api", "source": {"kind": "empty"}})
    assert r.status_code == 201 and r.json()["role"] == "sandbox"
    assert mode(registry.get(r.json()["id"])) == "outcome-v1"


def test_a_plain_sandbox_still_merges_with_a_legacy_merger_event(registry):
    """DQ-2: no material -> the exact legacy merge, whatever the mode; so existing sandbox behaviour is unchanged for plain bodies."""
    engine = registry.get(universes.DEFAULT_UNIVERSE_ID).engine
    engine.add_body(body("a", 0.0, 0.0))
    engine.add_body(body("b", 1.0e6, -1.0e4))
    engine.step(150.0)
    events = engine.events()
    assert [e.type for e in events] == ["merger"]
    record = engine.collision_records()[0]
    assert record.outcome_spec.outcome == "legacy_merge" and "material_unspecified" in record.warnings and record.result is None


def test_a_sandbox_with_materials_uses_the_new_engine(registry):
    engine = registry.get(universes.DEFAULT_UNIVERSE_ID).engine
    engine.add_body(body("a", 0.0, 0.0, "silicate-rock"))
    engine.add_body(body("b", 1.0e6, -1.0e4, "silicate-rock"))
    engine.step(150.0)
    assert [e.type for e in engine.events()] == ["collision"]


def _post_pair(client, material):
    """The original report ("bodies always merge"): a 30 km/s head-on hit created through the API, as the create form sends it."""
    uid = client.post("/api/v1/universes", json={"source": {"kind": "empty"}, "activate": True}).json()["id"]
    epoch = client.get("/api/v1/universes").json()["activationEpoch"]
    for name, m, r, x, vx in (("target", 6.0e24, 6.4e6, 0.0, 0.0), ("impactor", 6.0e23, 3.4e6, -2.0e8, 3.0e4)):
        data = {"name": name, "massKg": m, "radiusM": r, "positionM": {"x": x, "y": 0.0, "z": 0.0},
                "velocityMPerS": {"x": vx, "y": 0.0, "z": 0.0}, "colorHex": "#aaaaaa", "bodyType": "rocky-planet"}
        if material:
            data["material"] = {"profileId": material, "layers": None}
        r = client.post(f"/api/v1/universes/{uid}/bodies?activationEpoch={epoch}", json=data)
        assert r.status_code == 201
        assert r.json().get("material") == ({"profileId": material, "layers": None} if material else None)
    for _ in range(20):
        assert client.post(f"/api/v1/universes/{uid}/step?activationEpoch={epoch}", json={"dtS": 1000.0}).status_code == 200
    return client.get(f"/api/v1/universes/{uid}/events").json()["events"]


def test_a_sandbox_pair_with_an_explicit_material_reaches_the_outcome_models_through_the_api(client):
    events = _post_pair(client, "silicate-rock")
    assert [e["type"] for e in events] == ["collision"] and events[0]["outcome"] not in ("legacy_merge", "perfect_merge")


def test_a_sandbox_pair_without_material_still_merges_and_bodytype_supplies_none(client):
    """DQ-2 and D-029: `bodyType` is display-only, so a typed body without an explicit material keeps the exact legacy merge."""
    assert [e["type"] for e in _post_pair(client, None)] == ["merger"]


# ---------------------------------------------------------------------------------------------------------------
# Preset and Orbit Lab stay legacy-merge until Stage 11
# ---------------------------------------------------------------------------------------------------------------
def test_a_preset_universe_is_legacy_merge_through_both_entry_points(registry, client):
    direct = create_preset_universe(registry, PRESET, None, False)
    assert direct.role == "preset" and mode(direct) == "legacy-merge" and not direct.engine._deferred
    r = client.post("/api/v1/universes", json={"source": {"kind": "preset", "presetId": PRESET}})
    assert r.status_code == 201
    assert mode(registry.get(r.json()["id"])) == "legacy-merge"


def test_orbit_lab_baseline_and_modified_runs_are_legacy_merge(registry, lab):
    experiment = lab.create_experiment(EXPERIMENT)
    baseline = registry.get(experiment["baselineUniverseId"]) if "baselineUniverseId" in experiment else None
    runs = [u for u in registry.list() if u.role in ("baseline", "modified")]
    assert baseline is None or baseline in runs
    modified = lab.create_modified_run(experiment["id"], "body-earth", 1.05, False)
    runs = [u for u in registry.list() if u.role in ("baseline", "modified")]
    assert {u.role for u in runs} == {"baseline", "modified"} and modified
    assert all(mode(u) == "legacy-merge" and not u.engine._deferred for u in runs)


def test_a_preset_and_a_sandbox_coexist_with_their_own_modes(registry):
    preset = create_preset_universe(registry, PRESET, None, False)
    sandbox = registry.create("sandbox next to a preset")
    assert (mode(preset), mode(sandbox)) == ("legacy-merge", "outcome-v1")


# ---------------------------------------------------------------------------------------------------------------
# The mode is fixed for the life of a universe
# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("role", ["sandbox", "preset"])
def test_step_reset_and_snapshot_restore_keep_the_mode(registry, role):
    u = registry.create("s") if role == "sandbox" else create_preset_universe(registry, PRESET, None, False)
    expected = mode(u)
    snap = u.engine.capture_snapshot()
    u.engine.step(3600.0)
    u.engine.restore_snapshot(snap)
    assert mode(u) == expected
    u.engine.reset()
    assert mode(u) == expected and u.engine._deferred == (expected == "outcome-v1")


def test_the_mode_of_a_derived_engine_follows_the_explicit_configuration(registry):
    source = registry.get(universes.DEFAULT_UNIVERSE_ID).engine
    source.add_body(body("a", 0.0, 0.0))
    snap = source.capture_snapshot()
    assert SimulationService.from_snapshot(snap, history_mode="step", collision_config=LEGACY_MERGE_CONFIG).collision_config.mode == "legacy-merge"
    assert SimulationService.from_snapshot(snap, history_mode="step").collision_config.mode == "outcome-v1"
