import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.simulation import SimulationService, get_service

VALID = {
    "name": "Earth",
    "massKg": 5.972e24,
    "radiusM": 6.371e6,
    "positionM": {"x": 1.496e11, "y": 0.0, "z": 0.0},
    "velocityMPerS": {"x": 0.0, "y": 29780.0, "z": 0.0},
    "colorHex": "#3b82f6",
}


@pytest.fixture
def client():
    """Fresh in-memory store per test, injected via dependency override (no reset endpoint)."""
    fresh = SimulationService()
    app.dependency_overrides[get_service] = lambda: fresh
    yield TestClient(app)
    app.dependency_overrides.clear()


def post(client, **overrides):
    return client.post("/api/v1/bodies", json={**VALID, **overrides})


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


EMPTY_DIAGNOSTICS = {"version": 1, "totalMassKg": 0.0, "totalMomentumKgMPerS": {"x": 0.0, "y": 0.0, "z": 0.0}, "kineticEnergyJ": 0.0, "potentialEnergyJ": 0.0,
         "angularMomentumAboutOriginKgM2PerS": {"x": 0.0, "y": 0.0, "z": 0.0}, "bookedSpinKgM2PerS": {"x": 0.0, "y": 0.0, "z": 0.0}}


def test_initial_state_is_empty(client):
    r = client.get("/api/v1/simulation/state")
    assert r.status_code == 200
    assert r.json() == {"status": "paused", "simulationTimeS": 0.0, "bodies": [], "diagnostics": EMPTY_DIAGNOSTICS}


def test_create_and_retrieve_body(client):
    r = post(client)
    assert r.status_code == 201
    body = r.json()
    assert body["id"]
    assert {k: v for k, v in body.items() if k != "id"} == VALID | {"colorHex": "#3b82f6", "kind": "planet", "catalogueEntryId": None,
                                                          "bodyType": "default", "assetKey": None}
    assert client.get("/api/v1/simulation/state").json()["bodies"] == [body]


def test_body_id_is_stable_and_unique(client):
    a = post(client).json()
    b = post(client, name="Moon", positionM={"x": 1.496e11 + 3.844e8, "y": 0.0, "z": 0.0}).json()
    assert a["id"] != b["id"]
    first = client.get("/api/v1/simulation/state").json()["bodies"]
    second = client.get("/api/v1/simulation/state").json()["bodies"]
    assert [x["id"] for x in first] == [a["id"], b["id"]] == [x["id"] for x in second]


def test_state_isolated_between_tests(client):
    assert client.get("/api/v1/simulation/state").json()["bodies"] == []


def test_si_field_names_in_response(client):
    body = post(client).json()
    assert set(body) == {"id", "name", "massKg", "radiusM", "positionM", "velocityMPerS", "colorHex", "kind", "catalogueEntryId",
                       "bodyType", "assetKey"}
    assert set(body["positionM"]) == {"x", "y", "z"}
    assert set(body["velocityMPerS"]) == {"x", "y", "z"}
    state = client.get("/api/v1/simulation/state").json()
    assert set(state) == {"status", "simulationTimeS", "bodies", "diagnostics"}


@pytest.mark.parametrize("field", ["massKg", "radiusM"])
@pytest.mark.parametrize("value", [0, -1.0])
def test_rejects_non_positive_mass_and_radius(client, field, value):
    r = post(client, **{field: value})
    assert r.status_code == 422
    assert client.get("/api/v1/simulation/state").json()["bodies"] == []


@pytest.mark.parametrize("field", ["massKg", "radiusM"])
@pytest.mark.parametrize("literal", ["NaN", "Infinity"])
def test_rejects_non_finite_mass_and_radius(client, field, literal):
    raw = '{"name":"x","massKg":1,"radiusM":1,"positionM":{"x":0,"y":0,"z":0},' \
          '"velocityMPerS":{"x":0,"y":0,"z":0},"colorHex":"#ffffff"}'.replace(
              f'"{field}":1', f'"{field}":{literal}')
    r = client.post("/api/v1/bodies", content=raw, headers={"content-type": "application/json"})
    assert r.status_code == 422


@pytest.mark.parametrize("vec", ["positionM", "velocityMPerS"])
@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity", "1e999"])
def test_rejects_non_finite_vector_components(client, vec, literal):
    raw = '{"name":"x","massKg":1,"radiusM":1,"positionM":{"x":0,"y":0,"z":0},' \
          '"velocityMPerS":{"x":0,"y":0,"z":0},"colorHex":"#ffffff"}'
    raw = raw.replace(f'"{vec}":{{"x":0', f'"{vec}":{{"x":{literal}')
    r = client.post("/api/v1/bodies", content=raw, headers={"content-type": "application/json"})
    assert r.status_code == 422
    assert client.get("/api/v1/simulation/state").json()["bodies"] == []


@pytest.mark.parametrize("color", ["red", "#fff", "3b82f6", "#gggggg", "#3b82f6ff", ""])
def test_rejects_invalid_color(client, color):
    assert post(client, colorHex=color).status_code == 422


def test_rejects_client_supplied_id_and_unknown_fields(client):
    assert post(client, id="mine").status_code == 422
    assert post(client, mass=1.0).status_code == 422
