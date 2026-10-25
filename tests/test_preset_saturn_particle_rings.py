"""Ring World preset: a real six-body Saturn system. The ring grains are a frontend visual layer and are NOT bodies."""
import math

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.presets.loader import list_presets, load_preset

PRESET = "saturn-particle-rings"
IDS = ["body-saturn", "body-titan", "body-rhea", "body-iapetus", "body-dione", "body-tethys"]


@pytest.fixture
def client():
    return TestClient(app)


def test_listed_available_and_after_the_existing_presets():
    ids = [p["id"] for p in list_presets()]
    assert ids[:2] == ["solar-system-moons-j2000", "solar-system-j2000"], "the default preset must not change"
    p = next(x for x in list_presets() if x["id"] == PRESET)
    assert p["available"] is True and p["bodyCount"] == 6 and p["historyMode"] == "grid"


def test_bodies_match_the_moons_preset_physics():
    ring = {b.id: b for b in load_preset(PRESET).bodies}
    full = {b.id: b for b in load_preset("solar-system-moons-j2000").bodies}
    assert list(ring) == IDS
    for bid in IDS:
        assert ring[bid].massKg == full[bid].massKg and ring[bid].radiusM == full[bid].radiusM
    assert ring["body-saturn"].assetKey == "saturn" and ring["body-saturn"].bodyType == "gas-giant"
    assert ring["body-titan"].primaryId == "body-saturn"


def test_zero_total_momentum_and_no_grains_in_the_state():
    bodies = load_preset(PRESET).bodies
    total = sum(b.massKg for b in bodies)
    for k in range(3):
        p = sum(b.massKg * b.velocityMPerS[k] for b in bodies)
        assert abs(p) / (total * 1e4) < 1e-9
    assert len(bodies) == 6  # the ring is never a simulated body
    assert math.hypot(*bodies[0].positionM) < 1e7  # Saturn is within 10,000 km of the barycentre


def test_loading_creates_a_new_universe_and_leaves_the_others(client):
    before = client.get("/api/v1/universes/uni-default/state").json()
    r = client.post("/api/v1/universes", json={"source": {"kind": "preset", "presetId": PRESET}})
    assert r.status_code == 201
    u = r.json()
    assert u["role"] == "preset" and u["presetId"] == PRESET and u["bodyCount"] == 6
    assert client.get("/api/v1/universes/uni-default/state").json() == before
    solar = client.post("/api/v1/universes", json={"source": {"kind": "preset", "presetId": "solar-system-j2000"}})
    assert solar.status_code == 201 and solar.json()["bodyCount"] == 9
