"""The collision policy of every universe (owner decision D-071): stop on contact.

When two bodies touch, the simulation stops at the instant of first contact, reports it, and keeps one consistent state. Nothing is
merged, nothing breaks, no debris or collision aftermath is produced. This holds for every universe the application creates: the
startup `uni-default`, every new sandbox, every preset, the Orbit Lab baseline and modified runs, and every engine derived from one.

History: until D-071 a sandbox was `outcome-v1` (D-045) and presets and Orbit Lab were `legacy-merge`; this file pinned that. Those two
modes are now DORMANT: their code is kept and can be constructed explicitly (LEGACY_MERGE_CONFIG / OUTCOME_V1_CONFIG) by the tests that
keep the paused collision engine from rotting (marker `dormant_collisions`), but no route, preset or Orbit Lab run can select them.
"""
import pytest
from fastapi.testclient import TestClient

from backend import orbit_lab, universes
from backend.api_universes import create_preset_universe
from backend.impact.config import DEFAULT_MODE, DEFAULT_SANDBOX_MODE, CollisionConfig
from backend.main import app
from backend.models import BodyCreate
from backend.presets.loader import PRESET_FILES
from backend.simulation import LEGACY_MERGE_CONFIG, OUTCOME_V1_CONFIG, STOP_ON_CONTACT_CONFIG, SimulationService

EXPERIMENT = "exp01-sun-emb-j2000"
PRESET = "solar-system-j2000"
STOP = "stop-on-contact"


def mode(universe) -> str:
    return universe.engine.collision_config.mode


def stops(engine) -> bool:
    """The engine is on the stop-on-contact path: neither the in-callback merge nor the deferred outcome engine is active."""
    return engine.collision_config.mode == STOP and engine._stop_mode and not engine._deferred


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
def test_the_default_is_stop_on_contact_and_the_dormant_configs_are_explicit():
    assert DEFAULT_MODE == STOP and DEFAULT_SANDBOX_MODE == STOP
    assert CollisionConfig().mode == STOP and SimulationService().collision_config.mode == STOP
    assert SimulationService.DEFAULT_CONFIG is STOP_ON_CONTACT_CONFIG and stops(SimulationService())
    # the dormant modes exist only when named
    assert LEGACY_MERGE_CONFIG.mode == "legacy-merge" and SimulationService(LEGACY_MERGE_CONFIG).collision_config.mode == "legacy-merge"
    assert OUTCOME_V1_CONFIG.mode == "outcome-v1" and SimulationService(OUTCOME_V1_CONFIG)._deferred


# ---------------------------------------------------------------------------------------------------------------
# Sandbox
# ---------------------------------------------------------------------------------------------------------------
def test_the_startup_uni_default_stops_on_contact(registry):
    assert registry.active_id == universes.DEFAULT_UNIVERSE_ID
    default = registry.get(universes.DEFAULT_UNIVERSE_ID)
    assert default.role == "sandbox" and stops(default.engine)


def test_a_new_sandbox_through_the_registry_and_the_api_stops_on_contact(registry, client):
    assert stops(registry.create("direct").engine)
    r = client.post("/api/v1/universes", json={"name": "via api", "source": {"kind": "empty"}})
    assert r.status_code == 201 and r.json()["role"] == "sandbox" and r.json()["collisionMode"] == STOP
    assert stops(registry.get(r.json()["id"]).engine)


@pytest.mark.parametrize("dormant", ["outcome-v1", "legacy-merge", "merge"])
def test_no_request_can_select_a_dormant_mode(registry, client, dormant):
    before = len(registry.list())
    r = client.post("/api/v1/universes", json={"name": "x", "source": {"kind": "empty"}, "collisionMode": dormant})
    assert r.status_code == 422 and len(registry.list()) == before
    r = client.post("/api/v1/universes", json={"name": "x", "source": {"kind": "preset", "presetId": PRESET}, "collisionMode": dormant})
    assert r.status_code == 422 and len(registry.list()) == before


@pytest.mark.parametrize("material", [None, "silicate-rock"])
def test_a_sandbox_pair_stops_at_the_contact_with_or_without_materials(registry, material):
    """Before D-071 this pair merged (no material: a legacy `merger` event) or went through the outcome models (with a material: a
    `collision` event, fragments and debris parcels). Now, either way: one `contact` event, the simulation halted, both bodies
    still there with their masses and materials, and nothing created."""
    engine = registry.get(universes.DEFAULT_UNIVERSE_ID).engine
    a = engine.add_body(body("a", 0.0, 0.0, material))
    b = engine.add_body(body("b", 1.0e6, -1.0e4, material))
    state = engine.step(150.0)
    assert [e.type for e in engine.events()] == ["contact"] and state.warnings == ["collision_stopped"]
    assert state.halt is not None and set(state.halt.bodyIds) == {a.id, b.id}
    assert 0.0 < state.advancedS < 150.0 and state.simulationTimeS == pytest.approx(79.0, abs=0.5)  # 8e5 m of gap at 1e4 m/s, a second sooner under their own gravity
    assert [x.id for x in state.bodies] == [a.id, b.id]
    assert [x.massKg for x in state.bodies] == [1.0e22, 1.0e22]
    assert all(x.representation is None and x.originEventId is None and x.debris is None for x in state.bodies)
    assert [(x.material.profileId if x.material else None) for x in state.bodies] == [material, material]
    assert engine.collision_records() == []  # the outcome engine was never asked
    with pytest.raises(Exception) as refused:  # and nothing advances until the contact is resolved
        engine.step(10.0)
    assert getattr(refused.value, "code", None) == "simulation_halted"


def _post_pair(client, material):
    """The pair of the original report ("bodies always merge"): a 30 km/s head-on hit created through the API, as the create form
    sends it. Stepped until something is reported."""
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
    last = None
    for _ in range(20):
        last = client.post(f"/api/v1/universes/{uid}/step?activationEpoch={epoch}", json={"dtS": 1000.0})
        assert last.status_code == 200
        events = client.get(f"/api/v1/universes/{uid}/events").json()["events"]
        if events:
            return uid, epoch, events, last.json()
    return uid, epoch, [], last.json()


@pytest.mark.parametrize("material", [None, "silicate-rock"])
def test_the_pair_of_the_original_report_stops_through_the_api_and_produces_no_aftermath(client, material):
    uid, epoch, events, state = _post_pair(client, material)
    assert [e["type"] for e in events] == ["contact"] and events[0]["involvesSpacecraft"] is False
    assert state["warnings"] == ["collision_stopped"] and state["halt"]["reason"] == "collision"
    assert [b["name"] for b in state["bodies"]] == ["target", "impactor"]  # no remnant, no fragments, no parcels
    assert [b["massKg"] for b in state["bodies"]] == [6.0e24, 6.0e23]
    assert all("representation" not in b and "originEventId" not in b and "debris" not in b for b in state["bodies"])
    assert client.get(f"/api/v1/universes/{uid}/collisions").json()["total"] == 0
    refused = client.post(f"/api/v1/universes/{uid}/step?activationEpoch={epoch}", json={"dtS": 1000.0})
    assert refused.status_code == 409 and refused.json()["code"] == "simulation_halted"
    # resolving the contact (here: removing one of the two) lets the simulation go on
    impactor = next(b["id"] for b in state["bodies"] if b["name"] == "impactor")
    assert client.delete(f"/api/v1/universes/{uid}/bodies/{impactor}?activationEpoch={epoch}").status_code in (200, 204)
    after = client.post(f"/api/v1/universes/{uid}/step?activationEpoch={epoch}", json={"dtS": 1000.0})
    assert after.status_code == 200 and "halt" not in after.json() and after.json()["advancedS"] == 1000.0


# ---------------------------------------------------------------------------------------------------------------
# Presets and Orbit Lab
# ---------------------------------------------------------------------------------------------------------------
def test_a_preset_universe_stops_on_contact_through_both_entry_points(registry, client):
    direct = create_preset_universe(registry, PRESET, None, False)
    assert direct.role == "preset" and stops(direct.engine)
    r = client.post("/api/v1/universes", json={"source": {"kind": "preset", "presetId": PRESET}})
    assert r.status_code == 201 and r.json()["collisionMode"] == STOP
    assert stops(registry.get(r.json()["id"]).engine)


@pytest.mark.parametrize("preset_id", sorted(PRESET_FILES))
def test_every_offered_preset_stops_on_contact(registry, preset_id):
    assert stops(create_preset_universe(registry, preset_id, None, False).engine)


def test_orbit_lab_baseline_and_modified_runs_stop_on_contact(registry, lab):
    experiment = lab.create_experiment(EXPERIMENT)
    modified = lab.create_modified_run(experiment["id"], "body-earth", 1.05, False)
    runs = [u for u in registry.list() if u.role in ("baseline", "modified")]
    assert {u.role for u in runs} == {"baseline", "modified"} and modified
    assert all(stops(u.engine) for u in runs)


def test_every_universe_of_a_mixed_registry_has_the_same_policy(registry, lab):
    create_preset_universe(registry, PRESET, None, False)
    registry.create("sandbox next to a preset")
    lab.create_experiment(EXPERIMENT)
    assert len(registry.list()) >= 4 and {mode(u) for u in registry.list()} == {STOP}


# ---------------------------------------------------------------------------------------------------------------
# The mode is fixed for the life of a universe
# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("role", ["sandbox", "preset"])
def test_step_reset_and_snapshot_restore_keep_the_mode(registry, role):
    u = registry.create("s") if role == "sandbox" else create_preset_universe(registry, PRESET, None, False)
    snap = u.engine.capture_snapshot()
    u.engine.step(3600.0)
    u.engine.restore_snapshot(snap)
    assert stops(u.engine)
    u.engine.reset()
    assert stops(u.engine)


def test_a_derived_engine_stops_on_contact_unless_a_dormant_configuration_is_named(registry):
    source = registry.get(universes.DEFAULT_UNIVERSE_ID).engine
    source.add_body(body("a", 0.0, 0.0))
    snap = source.capture_snapshot()
    assert stops(SimulationService.from_snapshot(snap, history_mode="step"))
    assert SimulationService.from_snapshot(snap, history_mode="step", collision_config=LEGACY_MERGE_CONFIG).collision_config.mode == "legacy-merge"
