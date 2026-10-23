"""HTTP-level tests for the simulation operations (PATCH/DELETE bodies, step, reset, events)."""
import math

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.simulation import SimulationService, get_service

BODY = {
    "name": "Probe",
    "massKg": 1000.0,
    "radiusM": 1.0,
    "positionM": {"x": 0.0, "y": 0.0, "z": 0.0},
    "velocityMPerS": {"x": 3.0, "y": 0.0, "z": 0.0},
    "colorHex": "#ff0000",
}


@pytest.fixture
def client():
    fresh = SimulationService()
    app.dependency_overrides[get_service] = lambda: fresh
    yield TestClient(app)
    app.dependency_overrides.clear()


def make(client, **overrides):
    r = client.post("/api/v1/bodies", json={**BODY, **overrides})
    assert r.status_code == 201, r.text
    return r.json()


def at(x, **kw):
    return {"positionM": {"x": x, "y": 0.0, "z": 0.0}, **kw}


def state(client):
    return client.get("/api/v1/simulation/state").json()


# ---------- PATCH ----------
def test_patch_updates_only_given_fields(client):
    b = make(client)
    r = client.patch(f"/api/v1/bodies/{b['id']}", json={"massKg": 2000.0, "colorHex": "#00ff00"})
    assert r.status_code == 200
    assert r.json() == {**b, "massKg": 2000.0, "colorHex": "#00ff00"}
    assert state(client)["bodies"] == [r.json()]


@pytest.mark.parametrize("payload", [
    {}, {"massKg": None}, {"massKg": 0}, {"massKg": -1}, {"radiusM": 0}, {"id": "x"}, {"mass": 1},
    {"colorHex": "red"}, {"name": ""}, {"positionM": {"x": 1.0, "y": 0.0}}, {"massKg": 1e46},
    {"velocityMPerS": {"x": 3e8, "y": 3e8, "z": 0.0}},
])
def test_patch_validation_errors_leave_state_unchanged(client, payload):
    b = make(client)
    r = client.patch(f"/api/v1/bodies/{b['id']}", json=payload)
    assert r.status_code == 422
    assert state(client)["bodies"] == [b]


def test_patch_non_finite_rejected(client):
    b = make(client)
    r = client.patch(f"/api/v1/bodies/{b['id']}", content='{"massKg": NaN}', headers={"content-type": "application/json"})
    assert r.status_code == 422 and state(client)["bodies"] == [b]


def test_patch_unknown_id_is_404(client):
    r = client.patch("/api/v1/bodies/body-missing", json={"massKg": 1.0})
    assert r.status_code == 404 and "body-missing" in r.json()["detail"]


def test_patch_overlap_is_409_and_unchanged(client):
    make(client)
    b = make(client, **at(100.0))
    r = client.patch(f"/api/v1/bodies/{b['id']}", json={"positionM": {"x": 0.5, "y": 0.0, "z": 0.0}})
    assert r.status_code == 409
    assert state(client)["bodies"][1] == b


# ---------- DELETE ----------
def test_delete_then_gone(client):
    a, b = make(client), make(client, **at(100.0))
    r = client.delete(f"/api/v1/bodies/{a['id']}")
    assert r.status_code == 204 and r.content == b""
    assert state(client)["bodies"] == [b]
    assert client.delete(f"/api/v1/bodies/{a['id']}").status_code == 404
    assert client.patch(f"/api/v1/bodies/{a['id']}", json={"massKg": 1.0}).status_code == 404


# ---------- create (new behaviour) ----------
def test_create_overlapping_body_is_409(client):
    make(client)
    r = client.post("/api/v1/bodies", json={**BODY, **at(1.5)})
    assert r.status_code == 409
    assert len(state(client)["bodies"]) == 1


@pytest.mark.parametrize("override", [
    {"massKg": 1e46}, {"radiusM": 1e16}, {"positionM": {"x": 2e18, "y": 0, "z": 0}},
    {"velocityMPerS": {"x": 3e8, "y": 0, "z": 0}},
])
def test_create_bounds(client, override):
    assert client.post("/api/v1/bodies", json={**BODY, **override}).status_code == 422


# ---------- step ----------
def test_step_moves_bodies_and_reports_time(client):
    b = make(client)
    r = client.post("/api/v1/simulation/step", json={"dtS": 10.0})
    assert r.status_code == 200
    out = r.json()
    assert set(out) == {"status", "simulationTimeS", "bodies", "advancedS", "events"}
    assert out["status"] == "paused" and out["simulationTimeS"] == 10.0 and out["events"] == []
    assert out["advancedS"] == pytest.approx(10.0)
    assert out["bodies"][0]["id"] == b["id"]
    assert out["bodies"][0]["positionM"]["x"] == pytest.approx(30.0)
    assert state(client) == {k: out[k] for k in ("status", "simulationTimeS", "bodies")}


@pytest.mark.parametrize("payload", [
    {}, {"dtS": 0}, {"dtS": -1}, {"dtS": 1e-9}, {"dtS": 1.1e8}, {"dtS": "abc"}, {"dtS": None}, {"dtS": 1, "x": 2},
])
def test_step_rejects_bad_dt(client, payload):
    make(client)
    r = client.post("/api/v1/simulation/step", json=payload)
    assert r.status_code == 422
    assert state(client)["simulationTimeS"] == 0.0


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity", "1e999"])
def test_step_rejects_non_finite_dt(client, literal):
    r = client.post("/api/v1/simulation/step", content=f'{{"dtS": {literal}}}', headers={"content-type": "application/json"})
    assert r.status_code == 422


def test_step_with_merger_reports_event_and_events_endpoint_agrees(client):
    a = make(client, name="A", massKg=2000.0, positionM={"x": -100.0, "y": 0.0, "z": 0.0}, velocityMPerS={"x": 1.0, "y": 0, "z": 0})
    b = make(client, name="B", massKg=1000.0, radiusM=0.8, positionM={"x": 100.0, "y": 0.0, "z": 0.0}, velocityMPerS={"x": -1.0, "y": 0, "z": 0})
    assert client.get("/api/v1/events").json() == {"events": []}
    out = client.post("/api/v1/simulation/step", json={"dtS": 120.0}).json()
    assert [x["id"] for x in out["bodies"]] == [a["id"]]
    assert len(out["events"]) == 1
    ev = out["events"][0]
    assert ev["type"] == "merger" and ev["bodyIds"] == [a["id"], b["id"]] and ev["resultBodyId"] == a["id"]
    assert ev["resultMassKg"] == 3000.0 and ev["id"].startswith("evt-")
    assert set(ev) == {"id", "type", "simulationTimeS", "estimatedContactTimeS", "bodyIds", "resultBodyId",
                       "resultMassKg", "relativeSpeedMPerS", "kineticEnergyLostJ", "spinAddedKgM2PerS"}
    assert all(math.isfinite(ev[k]) for k in ("simulationTimeS", "relativeSpeedMPerS", "kineticEnergyLostJ"))
    assert client.get("/api/v1/events").json() == {"events": out["events"]}
    # a later step reports no events again (events are per step), but the log keeps them
    assert client.post("/api/v1/simulation/step", json={"dtS": 10.0}).json()["events"] == []
    assert len(client.get("/api/v1/events").json()["events"]) == 1


# ---------- reset ----------
def test_reset_clears_everything(client):
    make(client)
    client.post("/api/v1/simulation/step", json={"dtS": 5.0})
    r = client.post("/api/v1/simulation/reset")
    assert r.status_code == 200
    assert r.json() == {"status": "paused", "simulationTimeS": 0.0, "bodies": []}
    assert client.get("/api/v1/events").json() == {"events": []}
    make(client)  # usable again
    assert client.post("/api/v1/simulation/step", json={"dtS": 1.0}).status_code == 200


def test_body_limit_is_409(client, monkeypatch):
    from backend import simulation
    monkeypatch.setattr(simulation, "MAX_BODIES", 1)
    make(client)
    assert client.post("/api/v1/bodies", json={**BODY, **at(50.0)}).status_code == 409
