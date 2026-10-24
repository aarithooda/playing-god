"""HTTP contract of /api/v1/universes (milestone M1)."""
import pytest
from fastapi.testclient import TestClient

from backend.main import app

BODY = {"name": "Probe", "massKg": 1000.0, "radiusM": 1.0, "positionM": {"x": 0.0, "y": 0.0, "z": 0.0},
        "velocityMPerS": {"x": 3.0, "y": 0.0, "z": 0.0}, "colorHex": "#ff0000"}
EMPTY = {"source": {"kind": "empty"}}


@pytest.fixture
def client():
    return TestClient(app)


def listing(client):
    return client.get("/api/v1/universes").json()


def test_list_has_default_active_universe(client):
    j = listing(client)
    assert j["activeUniverseId"] == "uni-default" and j["activationEpoch"] == 1
    (u,) = j["universes"]
    assert u["id"] == "uni-default" and u["role"] == "sandbox" and u["active"] is True
    assert u["bodyCount"] == 0 and u["revision"] == 0 and u["status"] == "idle" and u["lastFailure"] is None
    assert u["historyMode"] == "step"


def test_create_empty_universe_not_activated(client):
    r = client.post("/api/v1/universes", json={"name": "Second", **EMPTY})
    assert r.status_code == 201 and r.json()["name"] == "Second" and r.json()["active"] is False
    assert listing(client)["activeUniverseId"] == "uni-default"


def test_create_with_activate(client):
    r = client.post("/api/v1/universes", json={**EMPTY, "activate": True})
    assert r.status_code == 201 and r.json()["active"] is True
    assert listing(client)["activationEpoch"] == 2


@pytest.mark.parametrize("payload", [{"name": "", **EMPTY}, {"source": {"kind": "bogus"}}, {}, {**EMPTY, "extra": 1}])
def test_create_validation(client, payload):
    assert client.post("/api/v1/universes", json=payload).status_code == 422


def test_activate_returns_epoch_and_previous(client):
    uid = client.post("/api/v1/universes", json=EMPTY).json()["id"]
    r = client.post(f"/api/v1/universes/{uid}/activate")
    j = r.json()
    assert r.status_code == 200 and j["activeUniverseId"] == uid and j["activationEpoch"] == 2
    assert j["previous"]["universeId"] == "uni-default"


def test_activate_unknown_is_404(client):
    r = client.post("/api/v1/universes/uni-x/activate")
    assert r.status_code == 404 and r.json()["code"] == "universe_not_found"


def test_mutation_requires_epoch(client):
    assert client.post("/api/v1/universes/uni-default/step", json={"dtS": 1.0}).status_code == 422


def test_scoped_flow_and_isolation(client):
    other = client.post("/api/v1/universes", json=EMPTY).json()["id"]
    q = "?activationEpoch=1"
    created = client.post(f"/api/v1/universes/uni-default/bodies{q}", json=BODY)
    assert created.status_code == 201 and created.json()["kind"] == "planet"
    step = client.post(f"/api/v1/universes/uni-default/step{q}", json={"dtS": 10.0})
    assert step.status_code == 200 and step.json()["universeId"] == "uni-default" and step.json()["revision"] == 2
    st = client.get("/api/v1/universes/uni-default/state").json()
    assert st["simulationTimeS"] == 10.0 and st["revision"] == 2 and len(st["bodies"]) == 1
    assert client.get(f"/api/v1/universes/{other}/state").json()["simulationTimeS"] == 0.0
    assert client.get(f"/api/v1/universes/{other}/state").json()["bodies"] == []


def test_inactive_mutation_is_409_with_code_and_unchanged(client):
    other = client.post("/api/v1/universes", json=EMPTY).json()["id"]
    r = client.post(f"/api/v1/universes/{other}/bodies?activationEpoch=1", json=BODY)
    assert r.status_code == 409 and r.json()["code"] in ("universe_not_active", "stale_activation")
    assert client.get(f"/api/v1/universes/{other}/state").json()["bodies"] == []


def test_stale_epoch_after_switch_is_409(client):
    other = client.post("/api/v1/universes", json=EMPTY).json()["id"]
    client.post(f"/api/v1/universes/{other}/activate")
    client.post("/api/v1/universes/uni-default/activate")  # epoch 3
    r = client.post("/api/v1/universes/uni-default/step?activationEpoch=1", json={"dtS": 1.0})
    assert r.status_code == 409 and r.json()["code"] == "stale_activation"
    assert client.post("/api/v1/universes/uni-default/step?activationEpoch=3", json={"dtS": 1.0}).status_code == 200


def test_expected_revision_over_http(client):
    q = "?activationEpoch=1&expectedRevision=0"
    assert client.post(f"/api/v1/universes/uni-default/step{q}", json={"dtS": 1.0}).status_code == 200
    r = client.post(f"/api/v1/universes/uni-default/step{q}", json={"dtS": 1.0})
    assert r.status_code == 409 and r.json()["code"] == "stale_revision"


def test_patch_delete_reset_events_scoped(client):
    q = "?activationEpoch=1"
    b = client.post(f"/api/v1/universes/uni-default/bodies{q}", json=BODY).json()
    client.post(f"/api/v1/universes/uni-default/bodies{q}", json={**BODY, "positionM": {"x": 100.0, "y": 0.0, "z": 0.0}})
    p = client.patch(f"/api/v1/universes/uni-default/bodies/{b['id']}{q}", json={"kind": "star"})
    assert p.status_code == 200 and p.json()["kind"] == "star"
    assert client.get("/api/v1/universes/uni-default/events").json() == {"events": []}
    assert client.delete(f"/api/v1/universes/uni-default/bodies/{b['id']}{q}").status_code == 204
    client.post(f"/api/v1/universes/uni-default/step{q}", json={"dtS": 5.0})
    r = client.post(f"/api/v1/universes/uni-default/reset{q}")
    assert r.status_code == 200 and r.json()["simulationTimeS"] == 0.0 and r.json()["revision"] == 6


def test_delete_flow(client):
    uid = client.post("/api/v1/universes", json=EMPTY).json()["id"]
    assert client.delete("/api/v1/universes/uni-default").json()["code"] == "active_universe_delete"
    assert client.delete(f"/api/v1/universes/{uid}").status_code == 204
    r = client.get(f"/api/v1/universes/{uid}")
    assert r.status_code == 404 and "deleted" in r.json()["detail"]


def test_universe_limit_over_http(client):
    for _ in range(7):
        assert client.post("/api/v1/universes", json=EMPTY).status_code == 201
    r = client.post("/api/v1/universes", json=EMPTY)
    assert r.status_code == 409 and r.json()["code"] == "universe_limit"


def test_preset_source_unknown_is_404(client):
    r = client.post("/api/v1/universes", json={"source": {"kind": "preset", "presetId": "nope"}})
    assert r.status_code == 404 and r.json()["code"] == "preset_not_found"


def test_legacy_routes_target_default_and_refuse_when_inactive(client):
    assert client.post("/api/v1/bodies", json=BODY).status_code == 201
    other = client.post("/api/v1/universes", json={**EMPTY, "activate": True}).json()["id"]
    r = client.post("/api/v1/simulation/step", json={"dtS": 1.0})
    assert r.status_code == 409 and r.json()["code"] == "universe_not_active"
    assert client.get("/api/v1/simulation/state").status_code == 200  # reads stay available
    assert client.get(f"/api/v1/universes/{other}/state").json()["simulationTimeS"] == 0.0
    assert client.get("/api/v1/universes/uni-default/state").json()["simulationTimeS"] == 0.0
