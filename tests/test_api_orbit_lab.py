"""Orbit Lab over HTTP (M8): the whole journey, protections, and refusals that change nothing."""
import pytest
from fastapi.testclient import TestClient

from backend.main import app

SYSTEM = "exp01-sun-emb-j2000"
DAY = 86400.0


@pytest.fixture
def client():
    return TestClient(app)


def start(client):
    return client.post("/api/v1/orbit-lab/experiments", json={"systemId": SYSTEM}).json()


def epoch(client):
    return client.get("/api/v1/universes").json()["activationEpoch"]


def step(client, uid, days=1):
    for _ in range(days):
        r = client.post(f"/api/v1/universes/{uid}/step?activationEpoch={epoch(client)}", json={"dtS": DAY})
        assert r.status_code == 200, r.text


def test_systems_endpoint(client):
    j = client.get("/api/v1/orbit-lab/systems").json()
    (s,) = j["systems"]
    assert s["speedFactors"] == [0.9, 0.95, 1.05, 1.1] and s["selectableBodyIds"] == ["body-earth"]


def test_create_experiment_creates_and_activates_the_baseline(client):
    r = client.post("/api/v1/orbit-lab/experiments", json={"systemId": SYSTEM})
    assert r.status_code == 201
    exp = r.json()
    assert exp["baseline"]["role"] == "baseline" and exp["baseline"]["active"] is True and exp["modified"] is None
    assert exp["activeUniverseId"] == exp["baselineUniverseId"]
    ini = exp["initialState"]
    assert ini["epoch"] == "J2000.0" and ini["units"].startswith("SI") and len(ini["digest"]) == 64
    earth = next(b for b in ini["bodies"] if b["id"] == "body-earth")
    assert earth["speedMPerS"] == pytest.approx(29785.0, rel=0.01) or earth["speedMPerS"] > 29000  # about 30 km/s about the barycentre
    assert "Two-body model" in ini["modelNote"]
    unis = client.get("/api/v1/universes").json()
    assert unis["activeUniverseId"] == exp["baselineUniverseId"] and len(unis["universes"]) == 2


@pytest.mark.parametrize("payload", [{}, {"systemId": ""}, {"systemId": SYSTEM, "extra": 1}])
def test_create_experiment_validation(client, payload):
    assert client.post("/api/v1/orbit-lab/experiments", json=payload).status_code == 422


def test_unknown_system_is_404(client):
    r = client.post("/api/v1/orbit-lab/experiments", json={"systemId": "nope"})
    assert r.status_code == 404 and r.json()["code"] == "system_not_found"
    assert len(client.get("/api/v1/universes").json()["universes"]) == 1


def test_full_journey(client):
    exp = start(client)
    eid, bid = exp["id"], exp["baselineUniverseId"]
    run = client.post(f"/api/v1/orbit-lab/experiments/{eid}/modified-run", json={"bodyId": "body-earth", "speedFactor": 1.10})
    assert run.status_code == 201
    mid = run.json()["modifiedUniverseId"]
    assert run.json()["modified"]["role"] == "modified" and run.json()["modified"]["active"] is False
    assert client.get("/api/v1/universes").json()["activeUniverseId"] == bid  # creating a run does not switch
    diff = client.get(f"/api/v1/orbit-lab/experiments/{eid}/initial-differences").json()
    assert len(diff["differences"]) == 1 and diff["configEqual"] is True
    step(client, bid, 20)
    client.post(f"/api/v1/universes/{mid}/activate")
    step(client, mid, 20)
    cmp_ = client.get(f"/api/v1/orbit-lab/experiments/{eid}/comparison?bodyId=body-earth").json()
    assert cmp_["commonSampleCount"] == 21 and cmp_["timesDiffer"] is False
    assert cmp_["separationM"][-1] > 1e9 and cmp_["separationM"][0] < 1e-6
    # states are independent
    sb = client.get(f"/api/v1/universes/{bid}/state").json()
    sm = client.get(f"/api/v1/universes/{mid}/state").json()
    assert sb["simulationTimeS"] == sm["simulationTimeS"] == 20 * DAY and sb["bodies"] != sm["bodies"]
    # a physical edit marks the modified run uncontrolled; resetting makes it controlled again; the audit stays
    q = f"?activationEpoch={epoch(client)}"
    patch = client.patch(f"/api/v1/universes/{mid}/bodies/body-earth{q}", json={"massKg": 6.0e24})
    assert patch.status_code == 200
    prov = client.get(f"/api/v1/universes/{mid}/provenance").json()
    assert prov["controlled"] is False and prov["firstUncontrolledAtS"] == 20 * DAY and prov["audit"][0]["bodyId"] == "body-earth"
    assert prov["derivedFrom"]["baselineUniverseId"] == bid and prov["modification"]["speedFactor"] == 1.1
    assert any("uncontrolled" in i for i in client.get(f"/api/v1/orbit-lab/experiments/{eid}/comparison?bodyId=body-earth").json()["issues"])
    client.post(f"/api/v1/universes/{mid}/reset{q}")
    prov = client.get(f"/api/v1/universes/{mid}/provenance").json()
    assert prov["controlled"] is True and len(prov["audit"]) == 1
    # the baseline was never touched by any of that
    assert client.get(f"/api/v1/universes/{bid}/state").json() == sb


def test_baseline_rejects_edits_and_snapshots(client):
    exp = start(client)
    bid = exp["baselineUniverseId"]
    q = f"?activationEpoch={epoch(client)}"
    body = {"name": "x", "massKg": 1.0, "radiusM": 1.0, "positionM": {"x": 1e12, "y": 0, "z": 0}, "velocityMPerS": {"x": 0, "y": 0, "z": 0}, "colorHex": "#ffffff"}
    state = client.get(f"/api/v1/universes/{bid}/state").json()
    attempts = [
        client.post(f"/api/v1/universes/{bid}/bodies{q}", json=body),
        client.patch(f"/api/v1/universes/{bid}/bodies/body-earth{q}", json={"massKg": 1.0}),
        client.delete(f"/api/v1/universes/{bid}/bodies/body-earth{q}"),
        client.post(f"/api/v1/universes/{bid}/snapshots{q}", json={}),
    ]
    for r in attempts:
        assert r.status_code == 409 and r.json()["code"] == "baseline_protected", r.text
    assert client.get(f"/api/v1/universes/{bid}/state").json() == state
    # it can still be advanced and reset to its documented initial state
    step(client, bid, 3)
    r = client.post(f"/api/v1/universes/{bid}/reset{q}")
    assert r.status_code == 200 and r.json()["simulationTimeS"] == 0.0
    assert r.json()["bodies"] == state["bodies"]
    # a restore needs a snapshot, which the baseline can never have: asking for one is refused too
    assert client.post(f"/api/v1/universes/{bid}/snapshots/snap-x/restore{q}").status_code == 409


def test_experiment_runs_cannot_be_deleted_through_the_universe_api(client):
    exp = start(client)
    client.post(f"/api/v1/orbit-lab/experiments/{exp['id']}/modified-run", json={"bodyId": "body-earth", "speedFactor": 0.95})
    client.post("/api/v1/universes/uni-default/activate")
    for uid in (exp["baselineUniverseId"], client.get(f"/api/v1/orbit-lab/experiments/{exp['id']}").json()["modifiedUniverseId"]):
        r = client.delete(f"/api/v1/universes/{uid}")
        assert r.status_code == 409 and r.json()["code"] == "baseline_protected"
    assert client.delete(f"/api/v1/orbit-lab/experiments/{exp['id']}").status_code == 204
    assert [u["id"] for u in client.get("/api/v1/universes").json()["universes"]] == ["uni-default"]


@pytest.mark.parametrize("payload", [
    {"bodyId": "body-earth", "speedFactor": 0.5}, {"bodyId": "body-earth", "speedFactor": 1.0},
    {"bodyId": "body-earth", "speedFactor": 1.1000001}, {"bodyId": "body-earth", "speedFactor": 1e9},
    {"bodyId": "body-sun", "speedFactor": 1.1}, {"bodyId": "body-earth", "speedFactor": "fast"},
    {"bodyId": "body-earth"}, {"speedFactor": 1.1},
    # only one modification kind exists: no component-wise or free-numeric control
    {"bodyId": "body-earth", "speedFactor": 1.1, "velocityMPerS": {"x": 1, "y": 2, "z": 3}},
    {"bodyId": "body-earth", "speedFactor": 1.1, "massKg": 2.0},
])
def test_disallowed_modification_rejected_without_change(client, payload):
    exp = start(client)
    before = client.get("/api/v1/universes").json()
    r = client.post(f"/api/v1/orbit-lab/experiments/{exp['id']}/modified-run", json=payload)
    assert r.status_code == 422
    assert client.get("/api/v1/universes").json() == before
    assert client.get(f"/api/v1/orbit-lab/experiments/{exp['id']}").json()["modifiedUniverseId"] is None


def test_non_finite_factor_in_raw_json_is_rejected(client):
    exp = start(client)
    r = client.post(f"/api/v1/orbit-lab/experiments/{exp['id']}/modified-run", content='{"bodyId": "body-earth", "speedFactor": NaN}',
                    headers={"content-type": "application/json"})
    assert r.status_code == 422
    assert client.get(f"/api/v1/orbit-lab/experiments/{exp['id']}").json()["modifiedUniverseId"] is None


def test_replace_flag_and_codes(client):
    exp = start(client)
    eid = exp["id"]
    url = f"/api/v1/orbit-lab/experiments/{eid}/modified-run"
    first = client.post(url, json={"bodyId": "body-earth", "speedFactor": 1.10}).json()
    dup = client.post(url, json={"bodyId": "body-earth", "speedFactor": 0.90})
    assert dup.status_code == 409 and dup.json()["code"] == "modified_run_exists"
    replaced = client.post(url, json={"bodyId": "body-earth", "speedFactor": 0.90, "replaceExisting": True})
    assert replaced.status_code == 201 and replaced.json()["modification"]["speedFactor"] == 0.9
    assert client.get(f"/api/v1/universes/{first['modifiedUniverseId']}").status_code == 404
    assert len(client.get("/api/v1/universes").json()["universes"]) == 3  # default, baseline, the new modified run


def test_delete_with_active_run_is_409_and_nothing_is_deleted(client):
    exp = start(client)
    r = client.delete(f"/api/v1/orbit-lab/experiments/{exp['id']}")
    assert r.status_code == 409 and r.json()["code"] == "experiment_has_active_run"
    assert len(client.get("/api/v1/universes").json()["universes"]) == 2
    assert client.get("/api/v1/orbit-lab/experiments/exp-nope").status_code == 404


def test_comparison_and_differences_without_a_modified_run(client):
    exp = start(client)
    c = client.get(f"/api/v1/orbit-lab/experiments/{exp['id']}/comparison?bodyId=body-earth")
    assert c.status_code == 200 and c.json()["complete"] is False and c.json()["issues"]
    d = client.get(f"/api/v1/orbit-lab/experiments/{exp['id']}/initial-differences")
    assert d.status_code == 409 and d.json()["code"] == "no_modified_run"
    assert client.get(f"/api/v1/orbit-lab/experiments/{exp['id']}/comparison").status_code == 422  # bodyId is required
    assert client.get(f"/api/v1/orbit-lab/experiments/{exp['id']}/comparison?bodyId=body-venus").status_code == 422


def test_listing_experiments(client):
    assert client.get("/api/v1/orbit-lab/experiments").json() == {"experiments": []}
    exp = start(client)
    assert [e["id"] for e in client.get("/api/v1/orbit-lab/experiments").json()["experiments"]] == [exp["id"]]
