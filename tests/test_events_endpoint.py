"""Direct tests of GET /api/v1/events: schema, ordering, persistence, reset, rollback, retention cap.

Everything goes through the HTTP layer (TestClient) against a fresh SimulationService per test.
"""
import math

import pytest
from fastapi.testclient import TestClient

from backend import simulation
from backend.main import app
from backend.simulation import SimulationService, get_service

EVENT_KEYS = {"id", "type", "simulationTimeS", "estimatedContactTimeS", "bodyIds", "resultBodyId", "resultMassKg",
              "relativeSpeedMPerS", "kineticEnergyLostJ", "spinAddedKgM2PerS"}


@pytest.fixture
def service():
    return SimulationService()


@pytest.fixture
def client(service):
    app.dependency_overrides[get_service] = lambda: service
    yield TestClient(app)
    app.dependency_overrides.clear()


def body(name, m, r, x, y=0.0, vx=0.0, vy=0.0):
    return {"name": name, "massKg": m, "radiusM": r, "positionM": {"x": x, "y": y, "z": 0.0},
            "velocityMPerS": {"x": vx, "y": vy, "z": 0.0}, "colorHex": "#abcdef"}


def create(client, **kw):
    r = client.post("/api/v1/bodies", json=body(**kw))
    assert r.status_code == 201, r.text
    return r.json()


def step(client, dt):
    r = client.post("/api/v1/simulation/step", json={"dtS": dt})
    assert r.status_code == 200, r.text
    return r.json()


def events(client):
    r = client.get("/api/v1/events")
    assert r.status_code == 200
    return r.json()["events"]


def head_on(client, y=0.0, tag=""):
    """A (2000 kg, r 1 m) and B (1000 kg, r 0.8 m) closing at 2 m/s from 200 m apart: contact at ~99 s."""
    a = create(client, name=f"A{tag}", m=2000.0, r=1.0, x=-100.0, y=y, vx=1.0)
    b = create(client, name=f"B{tag}", m=1000.0, r=0.8, x=100.0, y=y, vx=-1.0)
    return a, b


def test_empty_log_has_the_documented_shape(client):
    r = client.get("/api/v1/events")
    assert r.status_code == 200 and r.headers["content-type"] == "application/json"
    assert r.json() == {"events": []}


def test_events_endpoint_rejects_other_methods(client):
    for method in ("post", "put", "patch", "delete"):
        assert getattr(client, method)("/api/v1/events").status_code == 405


def test_merger_event_fields_values_and_agreement_with_the_step_response(client):
    a, b = head_on(client)
    out = step(client, 130.0)
    log = events(client)
    assert log == out["events"] and len(log) == 1
    ev = log[0]
    assert set(ev) == EVENT_KEYS and set(ev["spinAddedKgM2PerS"]) == {"x", "y", "z"}
    assert ev["id"] == "evt-1" and ev["type"] == "merger"
    assert ev["bodyIds"] == [a["id"], b["id"]] and ev["resultBodyId"] == a["id"]  # heavier body survives
    assert ev["resultMassKg"] == 3000.0
    assert ev["relativeSpeedMPerS"] == pytest.approx(2.0, rel=1e-6)  # gravity adds ~1e-9 m/s
    mu = 2000.0 * 1000.0 / 3000.0
    assert ev["kineticEnergyLostJ"] == pytest.approx(0.5 * mu * 4.0, rel=1e-6)
    assert ev["spinAddedKgM2PerS"] == {"x": 0.0, "y": 0.0, "z": 0.0}  # head-on: no orbital angular momentum
    # first contact: centres 1.8 m apart after closing 200 - 1.8 m at 2 m/s
    assert ev["estimatedContactTimeS"] == pytest.approx((200.0 - 1.8) / 2.0, rel=1e-6)
    assert ev["estimatedContactTimeS"] <= ev["simulationTimeS"] <= 130.0
    assert all(math.isfinite(v) for v in (ev["simulationTimeS"], ev["resultMassKg"], ev["kineticEnergyLostJ"]))
    # the survivor exists, the absorbed id does not
    ids = {x["id"] for x in out["bodies"]}
    assert a["id"] in ids and b["id"] not in ids


def test_grazing_merger_reports_orbital_angular_momentum_as_spin(client):
    """Impact parameter 0.5 m (< 1.8 m): spin = mu * (r_rel x v_rel) = mu * b * v_rel about +/-z."""
    create(client, name="A", m=2000.0, r=1.0, x=-100.0, y=0.25, vx=1.0)
    create(client, name="B", m=1000.0, r=0.8, x=100.0, y=-0.25, vx=-1.0)
    ev = step(client, 130.0)["events"][0]
    mu = 2000.0 * 1000.0 / 3000.0
    assert abs(ev["spinAddedKgM2PerS"]["z"]) == pytest.approx(mu * 0.5 * 2.0, rel=1e-6)
    assert ev["spinAddedKgM2PerS"]["x"] == 0.0 and ev["spinAddedKgM2PerS"]["y"] == 0.0


def test_tangent_contact_serialises_a_null_contact_time(client):
    """Independent review finding: at exact tangency the contact-time quadratic is a double root, so the estimate
    is None. The response model must carry that as JSON null, not fail or invent a number."""
    create(client, name="A", m=1e6, r=1.0, x=-1000.0, y=1.0, vx=1e6)
    create(client, name="B", m=1e6, r=1.0, x=1000.0, y=-1.0, vx=-1e6)  # b = 2 m = R_A + R_B exactly, swept in 2 ms
    out = step(client, 0.002)
    assert len(out["events"]) == 1 and out["events"][0]["estimatedContactTimeS"] is None
    assert events(client)[0]["estimatedContactTimeS"] is None


def test_events_survive_quiet_steps_edits_and_deletes_in_order(client):
    a, b = head_on(client, tag="1")
    c, d = head_on(client, y=1000.0, tag="2")
    step(client, 130.0)
    first = events(client)
    assert [e["id"] for e in first] == ["evt-1", "evt-2"]
    assert {e["resultBodyId"] for e in first} == {a["id"], c["id"]}
    times = [e["simulationTimeS"] for e in first]
    assert times == sorted(times)
    assert step(client, 10.0)["events"] == []  # a quiet step reports nothing...
    assert events(client) == first  # ...and does not touch the log
    assert client.patch(f"/api/v1/bodies/{a['id']}", json={"name": "renamed", "massKg": 5e3}).status_code == 200
    assert client.delete(f"/api/v1/bodies/{c['id']}").status_code == 204
    assert events(client) == first  # editing or deleting the survivors does not rewrite history


def test_log_accumulates_across_requests_with_increasing_ids(client):
    head_on(client, tag="1")
    step(client, 130.0)
    head_on(client, y=500.0, tag="2")
    step(client, 130.0)
    assert [e["id"] for e in events(client)] == ["evt-1", "evt-2"]


def test_reset_clears_the_log_but_ids_are_never_reused(client):
    head_on(client, tag="1")
    step(client, 130.0)
    assert [e["id"] for e in events(client)] == ["evt-1"]
    assert client.post("/api/v1/simulation/reset").status_code == 200
    assert events(client) == []
    head_on(client, tag="2")
    step(client, 130.0)
    assert [e["id"] for e in events(client)] == ["evt-2"]
    # reset twice in a row is fine and still empty
    client.post("/api/v1/simulation/reset")
    client.post("/api/v1/simulation/reset")
    assert events(client) == []


def test_failed_step_records_no_event_and_does_not_burn_an_id(client, service, monkeypatch):
    head_on(client)
    monkeypatch.setattr(service, "_verify_finite", lambda: (_ for _ in ()).throw(ArithmeticError("injected")))
    r = client.post("/api/v1/simulation/step", json={"dtS": 130.0})
    assert r.status_code == 500 and "rolled back" in r.json()["detail"]
    assert events(client) == []
    monkeypatch.undo()
    out = step(client, 130.0)
    assert [e["id"] for e in out["events"]] == ["evt-1"] and events(client) == out["events"]


def test_timed_out_step_records_no_event(client, service):
    head_on(client)
    service.step_time_limit_s = -1.0
    assert client.post("/api/v1/simulation/step", json={"dtS": 130.0}).status_code == 503
    assert events(client) == []


def test_log_is_capped_to_the_newest_events(client, monkeypatch):
    """MAX_EVENTS_KEPT bounds memory and payload size; the oldest events go first, ids stay unique."""
    monkeypatch.setattr(simulation, "MAX_EVENTS_KEPT", 3)
    for k in range(5):
        head_on(client, y=1000.0 * k, tag=str(k))
    step(client, 130.0)
    assert [e["id"] for e in events(client)] == ["evt-3", "evt-4", "evt-5"]


def test_chain_of_mergers_logs_one_event_per_merge(client):
    for i, (x, vx, m) in enumerate([(-40.0, 8.0, 3e6), (0.0, 0.0, 1e6), (12.0, 0.0, 2e6), (24.0, -6.0, 4e6)]):
        create(client, name=f"c{i}", m=m, r=5.0, x=x, vx=vx)
    step(client, 4.0)
    step(client, 20.0)
    log = events(client)
    assert len(log) == 3 and [e["id"] for e in log] == ["evt-1", "evt-2", "evt-3"]
    assert log[-1]["resultMassKg"] == 1e7
    absorbed = [e["bodyIds"][1] for e in log]
    assert len(set(absorbed)) == 3  # nobody is absorbed twice
    assert len(client.get("/api/v1/simulation/state").json()["bodies"]) == 1
