"""Preset endpoints and preset-created universes (M3)."""
import pytest
from fastapi.testclient import TestClient

from backend.main import app

SOLAR = {"source": {"kind": "preset", "presetId": "solar-system-j2000"}}


@pytest.fixture
def client():
    return TestClient(app)


def test_presets_list_has_no_kepler90(client):
    j = client.get("/api/v1/presets").json()["presets"]
    ids = [p["id"] for p in j]
    assert "solar-system-j2000" in ids
    assert not any("kepler" in i for i in ids)
    solar = next(p for p in j if p["id"] == "solar-system-j2000")
    assert solar["available"] is True and solar["bodyCount"] == 9 and solar["historyMode"] == "grid"
    assert solar["sampleIntervalS"] == 432000.0 and solar["epochLabel"] == "J2000.0"


def test_preset_detail_has_provenance(client):
    j = client.get("/api/v1/presets/solar-system-j2000").json()
    assert j["provenance"]["frame"] and j["provenance"]["sources"] and len(j["provenance"]["bodies"]) == 9
    r = client.get("/api/v1/presets/nope")
    assert r.status_code == 404 and r.json()["code"] == "preset_not_found"


def test_preset_load_creates_new_universe_and_leaves_others(client):
    client.post("/api/v1/universes/uni-default/bodies?activationEpoch=1", json={
        "name": "X", "massKg": 1.0, "radiusM": 1.0, "positionM": {"x": 0, "y": 0, "z": 0},
        "velocityMPerS": {"x": 0, "y": 0, "z": 0}, "colorHex": "#ffffff"})
    before = client.get("/api/v1/universes/uni-default/state").json()
    r = client.post("/api/v1/universes", json=SOLAR)
    assert r.status_code == 201
    u = r.json()
    assert u["role"] == "preset" and u["presetId"] == "solar-system-j2000" and u["bodyCount"] == 9
    assert u["active"] is False and u["historyMode"] == "grid" and u["epochLabel"] == "J2000.0"
    assert u["id"] != "uni-default" and u["simulationTimeS"] == 0.0 and u["revision"] == 1
    assert client.get("/api/v1/universes/uni-default/state").json() == before
    assert len(client.get("/api/v1/universes").json()["universes"]) == 2


def test_two_preset_loads_are_independent_universes(client):
    a = client.post("/api/v1/universes", json={**SOLAR, "activate": True}).json()
    b = client.post("/api/v1/universes", json=SOLAR).json()
    assert a["id"] != b["id"]
    epoch = client.get("/api/v1/universes").json()["activationEpoch"]
    client.post(f"/api/v1/universes/{a['id']}/step?activationEpoch={epoch}", json={"dtS": 86400.0})
    assert client.get(f"/api/v1/universes/{a['id']}/state").json()["simulationTimeS"] == 86400.0
    assert client.get(f"/api/v1/universes/{b['id']}/state").json()["simulationTimeS"] == 0.0


def test_preset_universe_reset_returns_to_loaded_state(client):
    a = client.post("/api/v1/universes", json={**SOLAR, "activate": True}).json()
    epoch = client.get("/api/v1/universes").json()["activationEpoch"]
    q = f"?activationEpoch={epoch}"
    before = client.get(f"/api/v1/universes/{a['id']}/state").json()["bodies"]
    client.post(f"/api/v1/universes/{a['id']}/step{q}", json={"dtS": 1.0e6})
    r = client.post(f"/api/v1/universes/{a['id']}/reset{q}").json()
    assert r["simulationTimeS"] == 0.0 and r["bodies"] == before


def test_provenance_endpoint(client):
    a = client.post("/api/v1/universes", json=SOLAR).json()
    j = client.get(f"/api/v1/universes/{a['id']}/provenance").json()
    assert j["sourceKind"] == "preset" and j["presetId"] == "solar-system-j2000" and len(j["initialStateDigest"]) == 64
    assert j["controlled"] is True and j["audit"] == [] and j["epoch"] == "J2000.0"
    d = client.get("/api/v1/universes/uni-default/provenance").json()
    assert d["sourceKind"] == "sandbox" and d["presetId"] is None


# ---- Solar System with major moons ----------------------------------------------------------------------------
MOONS_PRESET = {"source": {"kind": "preset", "presetId": "solar-system-moons-j2000"}, "activate": True}
MOON_PRIMARY = {"body-moon": "body-earth", "body-io": "body-jupiter", "body-europa": "body-jupiter",
                "body-ganymede": "body-jupiter", "body-callisto": "body-jupiter", "body-titan": "body-saturn",
                "body-rhea": "body-saturn", "body-iapetus": "body-saturn", "body-dione": "body-saturn",
                "body-tethys": "body-saturn", "body-phobos": "body-mars", "body-deimos": "body-mars"}


def test_moons_preset_listed_next_to_the_barycentre_preset(client):
    j = client.get("/api/v1/presets").json()["presets"]
    assert {"solar-system-j2000", "solar-system-moons-j2000"} <= {p["id"] for p in j}
    moons = next(p for p in j if p["id"] == "solar-system-moons-j2000")
    assert moons["available"] is True and moons["bodyCount"] == 21 and moons["sampleIntervalS"] == 432000.0
    detail = client.get("/api/v1/presets/solar-system-moons-j2000").json()
    assert len(detail["provenance"]["bodies"]) == 21


def test_moons_universe_serves_moons_as_real_bodies_with_primaries_and_steps_them(client):
    made = client.post("/api/v1/universes", json=MOONS_PRESET)
    assert made.status_code == 201, made.text
    uid = made.json()["id"]
    base = f"/api/v1/universes/{uid}"
    state = client.get(f"{base}/state").json()
    by = {b["id"]: b for b in state["bodies"]}
    assert len(by) == 21
    for moon, primary in MOON_PRIMARY.items():
        assert by[moon]["bodyType"] == "moon" and by[moon]["primaryId"] == primary and by[moon]["assetKey"]
        assert by[moon]["kind"] == "planet"
    assert by["body-earth"]["primaryId"] is None and by["body-sun"]["primaryId"] is None
    q = f"?activationEpoch={client.get('/api/v1/universes').json()['activationEpoch']}"
    out = client.post(f"{base}/step{q}", json={"dtS": 86400.0}).json()
    moved = {b["id"]: b for b in out["bodies"]}
    assert moved["body-io"]["positionM"] != by["body-io"]["positionM"]
    assert all(moved[m]["primaryId"] == p for m, p in MOON_PRIMARY.items())
    hist = client.get(f"{base}/history").json()
    assert hist["bodies"]["body-titan"]["bodyType"] == "moon" and hist["bodies"]["body-titan"]["primaryId"] == "body-saturn"


def test_moon_body_type_is_accepted_on_create(client):
    r = client.post("/api/v1/bodies", json={"name": "M", "massKg": 1e22, "radiusM": 1e6, "positionM": {"x": 0, "y": 0, "z": 0},
                                            "velocityMPerS": {"x": 0, "y": 0, "z": 0}, "colorHex": "#aaaaaa", "bodyType": "moon"})
    assert r.status_code == 201 and r.json()["bodyType"] == "moon" and r.json()["primaryId"] is None
