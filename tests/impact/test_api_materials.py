"""Stage 2: HTTP contract of materials, spin and orientation (GET /api/v1/materials; optional body fields)."""
import math

import pytest
from fastapi.testclient import TestClient

from backend.main import app

BODY = {"name": "Earth", "massKg": 5.97e24, "radiusM": 6.371e6, "positionM": {"x": 0.0, "y": 0.0, "z": 0.0},
        "velocityMPerS": {"x": 0.0, "y": 0.0, "z": 0.0}, "colorHex": "#3366ff"}
ROCK = {"profileId": "silicate-rock"}
SPIN = {"x": 0.0, "y": 0.0, "z": 7.2921e-5}


@pytest.fixture
def client():
    return TestClient(app)


def bodies(client):
    return client.get("/api/v1/simulation/state").json()["bodies"]


def test_materials_route_lists_the_registry_with_provenance_and_incomplete_markers(client):
    r = client.get("/api/v1/materials")
    assert r.status_code == 200
    j = r.json()
    assert j["schemaVersion"] == 1
    by_id = {p["id"]: p for p in j["profiles"]}
    assert sorted(by_id) == ["gas-envelope-hhe", "iron", "rubble-silicate", "silicate-rock", "water-ice"]
    rock = by_id["silicate-rock"]
    assert rock["ls12"]["cStar"] == 5.0 and rock["ls12"]["cStarUncertainty"] == 2.0 and rock["ls12"]["muBar"] == 0.37
    assert {p["quantity"] for p in rock["provenance"]} >= {"momentOfInertiaFactor", "ls12.cStar", "ls12.muBar"}
    assert by_id["gas-envelope-hhe"]["momentOfInertiaFactor"] is None and "ls12" in by_id["gas-envelope-hhe"]["incomplete"]
    assert by_id["gas-envelope-hhe"]["category"] == "gas"


def test_a_plain_body_has_exactly_the_old_response_shape(client):
    r = client.post("/api/v1/bodies", json=BODY)
    assert r.status_code == 201
    assert set(r.json()) == {"id", "name", "massKg", "radiusM", "positionM", "velocityMPerS", "colorHex", "kind",
                             "catalogueEntryId", "bodyType", "assetKey", "primaryId"}
    state = client.get("/api/v1/simulation/state").json()
    assert "spinAngularMomentumKgM2PerS" not in state["diagnostics"] and state["diagnostics"]["version"] == 1


def test_create_with_material_and_spin_round_trips_and_publishes_orientation(client):
    r = client.post("/api/v1/bodies", json={**BODY, "material": ROCK, "spinRadPerS": SPIN})
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["material"] == {"profileId": "silicate-rock", "layers": None}
    assert created["spinRadPerS"] == {"x": 0.0, "y": 0.0, "z": 7.2921e-5}
    assert created["orientation"] == {"quaternion": [1.0, 0.0, 0.0, 0.0], "epochS": 0.0}
    assert bodies(client) == [created]  # GET returns what POST returned
    out = client.post("/api/v1/simulation/step", json={"dtS": 1.0e4}).json()
    q = out["bodies"][0]["orientation"]
    half = 0.5 * 7.2921e-5 * 1.0e4
    assert q["epochS"] == 1.0e4 and q["quaternion"] == pytest.approx([math.cos(half), 0, 0, math.sin(half)], abs=1e-12)
    assert math.sqrt(sum(c * c for c in q["quaternion"])) == pytest.approx(1.0, abs=1e-12)
    inertia = 0.4 * 5.97e24 * 6.371e6 ** 2
    assert out["diagnostics"]["spinAngularMomentumKgM2PerS"]["z"] == pytest.approx(inertia * 7.2921e-5, rel=1e-14)
    assert out["diagnostics"]["version"] == 1


def test_invalid_material_is_422_material_invalid_and_creates_nothing(client):
    for material in ({"profileId": "no-such-profile"},
                     {"profileId": "silicate-rock", "layers": [{"materialId": "x", "massFraction": 0.5, "phase": "solid"}]}):
        r = client.post("/api/v1/bodies", json={**BODY, "material": material})
        assert r.status_code == 422 and r.json()["code"] == "material_invalid", r.text
    assert bodies(client) == []


def test_spin_without_a_usable_material_is_422_rotation_requires_material(client):
    for extra in ({"spinRadPerS": SPIN}, {"material": {"profileId": "gas-envelope-hhe"}, "spinRadPerS": SPIN},
                  {"orientation": {"quaternion": [1, 0, 0, 0], "epochS": 0.0}}):
        r = client.post("/api/v1/bodies", json={**BODY, **extra})
        assert r.status_code == 422 and r.json()["code"] == "rotation_requires_material", r.text
    assert bodies(client) == []


def test_non_unit_orientation_is_422_rotation_invalid(client):
    r = client.post("/api/v1/bodies", json={**BODY, "material": ROCK, "orientation": {"quaternion": [2, 0, 0, 0], "epochS": 0.0}})
    assert r.status_code == 422 and r.json()["code"] == "rotation_invalid"


@pytest.mark.parametrize("extra", [
    {"material": {"profileId": "silicate-rock", "colour": "red"}},       # unknown key
    {"material": {"profileId": ""}},
    {"material": ROCK, "spinRadPerS": {"x": 0, "y": 0, "z": 1e9}},       # beyond the sanity bound
    {"material": ROCK, "spinRadPerS": {"x": 0, "y": 0}},                 # incomplete vector
    {"material": ROCK, "orientation": {"quaternion": [1, 0, 0], "epochS": 0.0}},
    {"material": "silicate-rock"},
])
def test_malformed_input_is_rejected_by_request_validation(client, extra):
    r = client.post("/api/v1/bodies", json={**BODY, **extra})
    assert r.status_code == 422
    assert bodies(client) == []


def test_patch_material_and_spin(client):
    body = client.post("/api/v1/bodies", json=BODY).json()
    r = client.patch(f"/api/v1/bodies/{body['id']}", json={"material": ROCK})
    assert r.status_code == 200 and r.json()["material"]["profileId"] == "silicate-rock" and "spinRadPerS" not in r.json()
    r = client.patch(f"/api/v1/bodies/{body['id']}", json={"spinRadPerS": SPIN})
    assert r.status_code == 200 and r.json()["spinRadPerS"]["z"] == 7.2921e-5
    r = client.patch(f"/api/v1/bodies/{body['id']}", json={"material": None})
    assert r.status_code == 422 and r.json()["code"] == "rotation_requires_material"
    r = client.patch(f"/api/v1/bodies/{body['id']}", json={"material": None, "spinRadPerS": None})
    assert r.status_code == 200 and set(r.json()) == set(body)
    r = client.patch(f"/api/v1/bodies/{body['id']}", json={"massKg": None})
    assert r.status_code == 422  # other fields still reject an explicit null
