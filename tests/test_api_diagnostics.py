"""Serialization / HTTP shape of `diagnostics` (physical correctness: test_diagnostics_physics.py, service behaviour:
test_diagnostics_service.py). These tests check keys, types, JSON strictness and error-path compatibility only."""
import json

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.simulation import SimulationService, get_service

KEYS = {"version", "totalMassKg", "totalMomentumKgMPerS", "kineticEnergyJ", "potentialEnergyJ",
        "angularMomentumAboutOriginKgM2PerS", "bookedSpinKgM2PerS"}
VECTORS = {"totalMomentumKgMPerS", "angularMomentumAboutOriginKgM2PerS", "bookedSpinKgM2PerS"}
SCALARS = {"totalMassKg", "kineticEnergyJ", "potentialEnergyJ"}


def body(name, x, vy, m=1000.0):
    return {"name": name, "massKg": m, "radiusM": 1.0, "positionM": {"x": x, "y": 0.0, "z": 0.0},
            "velocityMPerS": {"x": 0.0, "y": vy, "z": 0.0}, "colorHex": "#ff0000"}


@pytest.fixture
def client():
    fresh = SimulationService()
    app.dependency_overrides[get_service] = lambda: fresh
    yield TestClient(app)
    app.dependency_overrides.clear()


def strict(response):
    """Parse a response refusing NaN/Infinity tokens, as a strict JSON consumer would."""
    def refuse(token):
        raise ValueError(f"non-finite JSON constant {token}")
    return json.loads(response.text, parse_constant=refuse)


def check_shape(d):
    assert set(d) == KEYS and d["version"] == 1 and isinstance(d["version"], int)
    for k in SCALARS:
        assert d[k] is None or (isinstance(d[k], (int, float)) and not isinstance(d[k], bool))
    for k in VECTORS:
        assert d[k] is None or (set(d[k]) == {"x", "y", "z"} and all(isinstance(c, (int, float)) for c in d[k].values()))


def two_bodies(client):
    client.post("/api/v1/bodies", json=body("a", 0.0, 1.0))
    client.post("/api/v1/bodies", json=body("b", 100.0, -1.0))


def test_state_step_and_reset_all_carry_the_same_diagnostics_schema(client):
    two_bodies(client)
    responses = [client.get("/api/v1/simulation/state"), client.post("/api/v1/simulation/step", json={"dtS": 5.0}),
                 client.post("/api/v1/simulation/reset")]
    for r in responses:
        assert r.status_code == 200
        check_shape(strict(r)["diagnostics"])


def test_state_equals_the_diagnostics_of_the_step_that_produced_it(client):
    two_bodies(client)
    stepped = client.post("/api/v1/simulation/step", json={"dtS": 5.0}).json()
    assert client.get("/api/v1/simulation/state").json()["diagnostics"] == stepped["diagnostics"]


def test_values_over_http_match_the_sent_bodies(client):
    two_bodies(client)
    d = client.get("/api/v1/simulation/state").json()["diagnostics"]
    assert d["totalMassKg"] == 2000.0 and d["totalMomentumKgMPerS"] == {"x": 0.0, "y": 0.0, "z": 0.0}
    assert d["kineticEnergyJ"] == 1000.0 and d["potentialEnergyJ"] < 0.0
    assert d["bookedSpinKgM2PerS"] == {"x": 0.0, "y": 0.0, "z": 0.0}


def test_undefined_quantities_serialize_as_json_null_never_nan(client):
    from backend.diagnostics import compute_diagnostics
    from backend.models import SimulationState
    d = compute_diagnostics([(1.0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)), (2.0, (0.0, 0.0, 0.0), (1.0, 0.0, 0.0))],
                            [], 6.6743e-11)  # coincident centres: only U is undefined (the API cannot create this)
    text = SimulationState(status="paused", simulationTimeS=0.0, bodies=[], diagnostics=d).model_dump_json()
    parsed = json.loads(text, parse_constant=lambda t: pytest.fail(f"non-finite token {t}"))
    assert parsed["diagnostics"]["potentialEnergyJ"] is None and '"potentialEnergyJ":null' in text
    assert parsed["diagnostics"]["totalMassKg"] == 3.0


def test_existing_fields_are_unchanged_and_diagnostics_is_purely_additive(client):
    two_bodies(client)
    out = client.post("/api/v1/simulation/step", json={"dtS": 5.0}).json()
    assert set(out) == {"status", "simulationTimeS", "bodies", "advancedS", "events", "diagnostics"}
    assert set(out["bodies"][0]) == {"id", "name", "massKg", "radiusM", "positionM", "velocityMPerS", "colorHex"}


def test_body_endpoints_do_not_carry_diagnostics(client):
    r = client.post("/api/v1/bodies", json=body("a", 0.0, 1.0))
    assert r.status_code == 201 and "diagnostics" not in r.json()
    assert "diagnostics" not in client.patch(f"/api/v1/bodies/{r.json()['id']}", json={"name": "x"}).json()
    assert "diagnostics" not in client.get("/api/v1/events").json()


def test_error_responses_keep_their_shape_without_diagnostics(client):
    two_bodies(client)
    assert client.post("/api/v1/simulation/step", json={"dtS": 0}).status_code == 422
    r = client.delete("/api/v1/bodies/body-nope")
    assert r.status_code == 404 and r.json() == {"detail": "unknown body id: body-nope"}
    svc = app.dependency_overrides[get_service]()
    svc.step_time_limit_s = -1.0
    r = client.post("/api/v1/simulation/step", json={"dtS": 5.0})
    assert r.status_code == 503 and set(r.json()) == {"detail"}
    svc.step_time_limit_s = 10.0
    assert client.get("/api/v1/simulation/state").json()["simulationTimeS"] == 0.0  # untouched by the 503


def test_diagnostics_version_is_pinned_to_the_supported_semantics_version():
    """`Diagnostics.version` is Literal[1]: an unsupported version can neither be emitted nor accepted."""
    from pydantic import ValidationError

    from backend.diagnostics import DIAGNOSTICS_VERSION, compute_diagnostics
    from backend.models import Diagnostics, SimulationState

    good = compute_diagnostics([], [], 6.6743e-11)
    assert DIAGNOSTICS_VERSION == 1 and Diagnostics(**good).version == 1
    assert type(Diagnostics(**{**good, "version": True}).version) is int
    for bad in (0, 2, "1", 1.5, None):  # (pydantic lets True through Literal[1], but it is normalized to the int 1)
        with pytest.raises(ValidationError):
            Diagnostics(**{**good, "version": bad})
        with pytest.raises(ValidationError):  # the response model refuses to serialize it either
            SimulationState(status="paused", simulationTimeS=0.0, bodies=[], diagnostics={**good, "version": bad})
    schema = app.openapi()["components"]["schemas"]["Diagnostics"]["properties"]["version"]
    assert schema.get("const") == 1 or schema.get("enum") == [1]  # published in the OpenAPI document


def test_live_responses_carry_version_1(client):
    assert client.get("/api/v1/simulation/state").json()["diagnostics"]["version"] == 1

