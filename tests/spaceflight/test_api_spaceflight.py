"""The spaceflight routes over HTTP (FastAPI TestClient): shapes, error codes, guards, and that other universes are unchanged."""
import pytest
from fastapi.testclient import TestClient

from backend.main import app

EARTH = {"name": "Earth", "massKg": 5.9722e24, "radiusM": 6.3710084e6, "positionM": {"x": 0, "y": 0, "z": 0},
         "velocityMPerS": {"x": 0, "y": 0, "z": 0}, "colorHex": "#3b82f6", "bodyType": "rocky-planet"}


@pytest.fixture
def client():
    return TestClient(app)


def mission_universe(client):
    r = client.post("/api/v1/universes", json={"source": {"kind": "preset", "presetId": "earth-moon-j2000"}, "activate": True})
    assert r.status_code == 201
    return r.json()["id"], client.get("/api/v1/universes").json()["activationEpoch"]


def craft_body(**orbit):
    orbit = {"centralBodyId": "body-earth", "periapsisAltitudeM": 300.0e3, "matchPlaneOfBodyId": "body-moon", **orbit}
    return {"name": "Probe", "dryMassKg": 3000, "propellantKg": 12000, "thrustN": 50000, "ispS": 450, "orbit": orbit}


def test_the_mission_preset_is_listed_and_creates_a_stop_on_contact_universe(client):
    presets = client.get("/api/v1/presets").json()["presets"]
    assert [p["id"] for p in presets][:2] == ["solar-system-moons-j2000", "solar-system-j2000"]  # the default is unchanged
    entry = next(p for p in presets if p["id"] == "earth-moon-j2000")
    assert entry["available"] and entry["bodyCount"] == 2 and entry["sampleIntervalS"] == 180.0
    uid, _ = mission_universe(client)
    summary = client.get(f"/api/v1/universes/{uid}").json()
    assert summary["role"] == "preset" and summary["collisionMode"] == "stop-on-contact" and summary["bodyCount"] == 2
    state = client.get(f"/api/v1/universes/{uid}/state").json()
    assert [b["id"] for b in state["bodies"]] == ["body-earth", "body-moon"] and "spaceflight" not in state and "halt" not in state
    # Earth and Moon about their barycentre: zero total momentum
    p = state["diagnostics"]["totalMomentumKgMPerS"]
    assert max(abs(p[k]) for k in "xyz") < 1e-6 * 7.3e22 * 1000.0


def test_every_universe_reports_stop_on_contact_and_no_other_mode_can_be_asked_for(client):
    """D-071: the startup universe, a new sandbox and a preset all stop on contact; `collisionMode` accepts only that value."""
    listed = client.get("/api/v1/universes").json()["universes"]
    assert listed[0]["collisionMode"] == "stop-on-contact"
    r = client.post("/api/v1/universes", json={"source": {"kind": "empty"}, "collisionMode": "stop-on-contact"})
    assert r.status_code == 201 and r.json()["collisionMode"] == "stop-on-contact" and r.json()["role"] == "sandbox"
    assert client.post("/api/v1/universes", json={"source": {"kind": "empty"}}).json()["collisionMode"] == "stop-on-contact"
    for dormant in ("legacy-merge", "outcome-v1"):
        assert client.post("/api/v1/universes", json={"source": {"kind": "empty"}, "collisionMode": dormant}).status_code == 422
    solar = client.post("/api/v1/universes", json={"source": {"kind": "preset", "presetId": "solar-system-j2000"}}).json()
    assert solar["collisionMode"] == "stop-on-contact"


def test_create_inspect_and_delete_a_spacecraft(client):
    uid, epoch = mission_universe(client)
    preview = client.post(f"/api/v1/universes/{uid}/spacecraft/orbit-preview", json={"orbit": craft_body()["orbit"], "massKg": 15000})
    assert preview.status_code == 200 and preview.json()["orbit"]["regime"] == "bound" and preview.json()["warnings"] == []
    assert 5400 < preview.json()["orbit"]["periodS"] < 5450 and 7700 < preview.json()["orbit"]["speedMPerS"] < 7760
    r = client.post(f"/api/v1/universes/{uid}/spacecraft?activationEpoch={epoch}", json=craft_body())
    assert r.status_code == 201 and r.json()["warnings"] == []
    body = r.json()["body"]
    assert body["kind"] == "spacecraft" and body["bodyType"] == "spacecraft" and body["massKg"] == 15000
    assert body["spacecraft"]["orbit"]["referenceBodyId"] == "body-earth" and body["spacecraft"]["orbit"]["referenceBodyName"] == "Earth"
    assert body["spacecraft"]["orbit"]["periodS"] == pytest.approx(preview.json()["orbit"]["periodS"])
    assert body["spacecraft"]["orbit"]["sphereOfInfluenceM"] is None  # Earth is the top-level body here
    state = client.get(f"/api/v1/universes/{uid}/state").json()
    assert [b["kind"] for b in state["bodies"]] == ["planet", "planet", "spacecraft"] and "spacecraft" not in state["bodies"][0]
    assert client.get(f"/api/v1/universes/{uid}").json()["bodyCount"] == 3
    patched = client.patch(f"/api/v1/universes/{uid}/spacecraft/{body['id']}?activationEpoch={epoch}", json={"propellantKg": 9000})
    assert patched.status_code == 200 and patched.json()["massKg"] == 12000
    assert client.delete(f"/api/v1/universes/{uid}/bodies/{body['id']}?activationEpoch={epoch}").status_code == 204
    assert len(client.get(f"/api/v1/universes/{uid}/state").json()["bodies"]) == 2


def test_spacecraft_requests_are_validated_with_codes(client):
    uid, epoch = mission_universe(client)
    url = f"/api/v1/universes/{uid}/spacecraft?activationEpoch={epoch}"
    assert client.post(url, json={**craft_body(), "dryMassKg": 0}).status_code == 422
    assert client.post(url, json={**craft_body(), "state": {"positionM": {"x": 1e8, "y": 0, "z": 0}, "velocityMPerS": {"x": 0, "y": 0, "z": 0}}}).status_code == 422
    assert client.post(url, json={k: v for k, v in craft_body().items() if k != "orbit"}).status_code == 422
    assert client.post(url, json=craft_body(periapsisAltitudeM=None)).status_code == 422
    r = client.post(url, json=craft_body(eccentricity=1.0))
    assert r.status_code == 422 and r.json()["code"] == "orbit_invalid"
    r = client.post(url, json=craft_body(centralBodyId="body-mars"))
    assert r.status_code == 404 and r.json()["code"] == "body_not_found"
    r = client.post(f"/api/v1/universes/{uid}/spacecraft?activationEpoch={epoch + 5}", json=craft_body())
    assert r.status_code == 409 and r.json()["code"] == "stale_activation"
    assert client.post("/api/v1/universes/uni-nope/spacecraft?activationEpoch=1", json=craft_body()).status_code == 404
    assert client.post(f"/api/v1/universes/{uid}/spacecraft", json=craft_body()).status_code == 422  # the epoch is required
    assert len(client.get(f"/api/v1/universes/{uid}/state").json()["bodies"]) == 2
    assert client.get("/api/v1/universes").json()["universes"][-1]["lastFailure"] is None  # refusals are not failures of the universe
    # the body route does not make spacecraft
    r = client.post(f"/api/v1/universes/{uid}/bodies?activationEpoch={epoch}", json={**EARTH, "kind": "spacecraft"})
    assert r.status_code == 422


def test_manoeuvre_routes(client):
    uid, epoch = mission_universe(client)
    q = f"?activationEpoch={epoch}"
    cid = client.post(f"/api/v1/universes/{uid}/spacecraft{q}", json=craft_body()).json()["body"]["id"]
    preview = client.post(f"/api/v1/universes/{uid}/spacecraft/{cid}/maneuvers/preview", json={"at": "now", "progradeMPerS": 100})
    assert preview.status_code == 200 and preview.json()["after"]["apoapsisAltitudeM"] > 600.0e3 and preview.json()["burnDurationS"] == 0
    assert "spaceflight" not in client.get(f"/api/v1/universes/{uid}/state").json()
    r = client.post(f"/api/v1/universes/{uid}/spacecraft/{cid}/maneuvers{q}", json={"at": "now", "progradeMPerS": 100, "label": "raise"})
    assert r.status_code == 201 and r.json()["status"] == "executed" and r.json()["deliveredDeltaVMPerS"] == pytest.approx(100)
    events = client.get(f"/api/v1/universes/{uid}/events").json()["events"]
    assert [e["type"] for e in events] == ["maneuver"] and events[0]["label"] == "raise" and events[0]["bodyIds"] == [cid]
    r = client.post(f"/api/v1/universes/{uid}/spacecraft/{cid}/maneuvers{q}", json={"at": "apoapsis", "progradeMPerS": 90, "mode": "finite"})
    assert r.status_code == 201 and r.json()["status"] == "planned" and r.json()["endS"] > r.json()["startS"]
    state = client.get(f"/api/v1/universes/{uid}/state").json()
    assert [m["status"] for m in state["spaceflight"]["maneuvers"]] == ["executed", "planned"] and state["spaceflight"]["missions"] == []
    assert client.delete(f"/api/v1/universes/{uid}/maneuvers/{r.json()['id']}{q}").status_code == 204
    assert client.delete(f"/api/v1/universes/{uid}/maneuvers/{r.json()['id']}{q}").json()["code"] == "maneuver_not_found"
    bad = client.post(f"/api/v1/universes/{uid}/spacecraft/{cid}/maneuvers{q}", json={"at": "epoch", "progradeMPerS": 1})
    assert bad.status_code == 422
    bad = client.post(f"/api/v1/universes/{uid}/spacecraft/{cid}/maneuvers{q}", json={"at": "now", "frame": "inertial", "progradeMPerS": 1})
    assert bad.status_code == 422
    bad = client.post(f"/api/v1/universes/{uid}/spacecraft/{cid}/maneuvers{q}", json={"at": "epoch", "epochS": -10, "progradeMPerS": 1})
    assert bad.status_code == 422 and bad.json()["code"] == "maneuver_in_past"
    assert client.post(f"/api/v1/universes/{uid}/spacecraft/craft-x/maneuvers{q}", json={"at": "now", "progradeMPerS": 1}).status_code == 404


def test_the_whole_mission_through_the_api_and_the_step_response_carries_its_state(client):
    uid, epoch = mission_universe(client)
    q = f"?activationEpoch={epoch}"
    cid = client.post(f"/api/v1/universes/{uid}/spacecraft{q}", json=craft_body()).json()["body"]["id"]
    r = client.post(f"/api/v1/universes/{uid}/missions{q}", json={"name": "To the Moon", "spacecraftId": cid, "destinationBodyId": "body-moon",
                                                                  "objective": {"type": "orbit", "periapsisAltitudeM": 100.0e3}})
    assert r.status_code == 201 and r.json()["status"] == "draft"
    mid = r.json()["id"]
    assert client.get(f"/api/v1/universes/{uid}/missions/{mid}/trajectory").json()["timesS"] == []
    assert client.post(f"/api/v1/universes/{uid}/missions/{mid}/commit{q}").json()["code"] == "mission_not_planned"
    planned = client.post(f"/api/v1/universes/{uid}/missions/{mid}/plan{q}", json={})
    assert planned.status_code == 200 and planned.json()["status"] == "planned" and planned.json()["committed"] is False
    plan = planned.json()["plan"]
    assert 3000 < plan["departure"]["deltaVMPerS"] < 3250 and 600 < plan["insertion"]["deltaVMPerS"] < 1000
    assert plan["arrival"]["periapsisAltitudeM"] == pytest.approx(100.0e3, abs=1.0)
    trajectory = client.get(f"/api/v1/universes/{uid}/missions/{mid}/trajectory").json()
    assert len(trajectory["timesS"]) == len(trajectory["spacecraftM"]) == len(trajectory["originM"]) == len(trajectory["destinationM"]) > 100
    committed = client.post(f"/api/v1/universes/{uid}/missions/{mid}/commit{q}").json()
    assert committed["status"] == "planned" and committed["phase"] == "awaiting departure" and len(committed["maneuverIds"]) == 2
    seen, mission = [], None
    for _ in range(300):
        step = client.post(f"/api/v1/universes/{uid}/step{q}", json={"dtS": 7200})
        assert step.status_code == 200
        mission = step.json()["spaceflight"]["missions"][0]
        seen.extend(e["type"] for e in step.json()["events"])
        if mission["status"] in ("completed", "failed"):
            break
    assert mission["status"] == "completed" and mission["phase"] == "orbit verified" and seen == ["maneuver", "maneuver"]
    assert mission["outcome"]["bound"] and abs(mission["outcome"]["periapsisAltitudeM"] - 100.0e3) < 5000.0
    assert all(c["ok"] for c in mission["checks"]) and all(a["ok"] for a in mission["agreement"])
    craft = next(b for b in client.get(f"/api/v1/universes/{uid}/state").json()["bodies"] if b["id"] == cid)
    assert craft["spacecraft"]["orbit"]["referenceBodyId"] == "body-moon" and craft["spacecraft"]["orbit"]["regime"] == "bound"
    assert craft["spacecraft"]["orbit"]["sphereOfInfluenceM"] == pytest.approx(6.6e7, rel=0.1)
    # recorded history holds the actual path of the spacecraft
    history = client.get(f"/api/v1/universes/{uid}/history?bodyIds={cid}&limit=5000").json()
    assert history["mode"] == "grid" and len(history["samples"]) > 1000 and history["bodies"][cid]["kind"] == "spacecraft"
    assert client.post(f"/api/v1/universes/{uid}/missions/{mid}/abort{q}").json()["code"] == "mission_over"
    assert client.delete(f"/api/v1/universes/{uid}/missions/{mid}{q}").status_code == 204
    assert client.get(f"/api/v1/universes/{uid}/missions/{mid}/trajectory").status_code == 404


def test_a_collision_stops_the_universe_over_http_and_stepping_answers_409(client):
    uid, epoch = mission_universe(client)
    q = f"?activationEpoch={epoch}"
    cid = client.post(f"/api/v1/universes/{uid}/spacecraft{q}", json=craft_body()).json()["body"]["id"]
    client.post(f"/api/v1/universes/{uid}/spacecraft/{cid}/maneuvers{q}", json={"at": "now", "progradeMPerS": -400})
    step = client.post(f"/api/v1/universes/{uid}/step{q}", json={"dtS": 6000}).json()
    assert step["warnings"] == ["collision_stopped"] and step["advancedS"] < 6000 and step["halt"]["bodyIds"] == [cid, "body-earth"]
    assert [e["type"] for e in step["events"]] == ["contact"] and step["events"][0]["involvesSpacecraft"] is True
    refused = client.post(f"/api/v1/universes/{uid}/step{q}", json={"dtS": 10})
    assert refused.status_code == 409 and refused.json()["code"] == "simulation_halted" and "collided" in refused.json()["detail"]
    assert client.get(f"/api/v1/universes/{uid}/state").json()["halt"]["eventId"] == step["halt"]["eventId"]
    assert client.get(f"/api/v1/universes/{uid}").json()["lastFailure"] is None
    reset = client.post(f"/api/v1/universes/{uid}/reset{q}").json()
    assert "halt" not in reset and len(reset["bodies"]) == 2
    assert client.post(f"/api/v1/universes/{uid}/step{q}", json={"dtS": 10}).status_code == 200


def test_spacecraft_work_in_the_default_sandbox_and_through_the_legacy_routes(client):
    earth = client.post("/api/v1/bodies", json=EARTH).json()["id"]
    epoch = client.get("/api/v1/universes").json()["activationEpoch"]
    r = client.post(f"/api/v1/universes/uni-default/spacecraft?activationEpoch={epoch}",
                    json={"name": "Sat", "dryMassKg": 500, "orbit": {"centralBodyId": earth, "periapsisAltitudeM": 700.0e3, "inclinationDeg": 98.2}})
    assert r.status_code == 201
    state = client.post("/api/v1/simulation/step", json={"dtS": 3000}).json()  # the legacy single-simulation route
    craft = next(b for b in state["bodies"] if b["kind"] == "spacecraft")
    assert craft["spacecraft"]["orbit"]["inclinationDeg"] == pytest.approx(98.2, abs=1e-6) and craft["spacecraft"]["deltaVRemainingMPerS"] == 0
    assert abs(craft["spacecraft"]["orbit"]["altitudeM"] - 700.0e3) < 1.0 and "spaceflight" not in state
