"""Body catalogue (M5): sourced, immutable, honest about estimates, and independent of every universe."""
import copy
import math

import pytest
from fastapi.testclient import TestClient

from backend import catalogue
from backend.main import app

G = 6.67430e-11
# Independent unit table: the test must not reuse the builder's factors.
FACTOR = {"Msun": 1.3271244e20 / G, "Rsun": 6.957e8, "GM_m3s2": 1.0 / G, "GM_km3s2": 1.0e9 / G, "1e24kg": 1.0e24, "km": 1.0e3, "m": 1.0}

EXPECTED = {
    "stars": ["sun", "proxima-centauri", "trappist-1", "sirius-a", "betelgeuse"],
    "planets": [
        "mercury", "venus", "earth", "moon", "mars", "phobos", "deimos", "jupiter", "io", "europa",
        "ganymede", "callisto", "saturn", "titan", "rhea", "iapetus", "dione", "tethys", "uranus", "neptune",
    ],
}


@pytest.fixture
def client():
    return TestClient(app)


def entries():
    return catalogue.get_catalogue()["entries"]


def test_catalogue_entries_and_provenance():
    es = entries()
    assert [e["id"] for e in es if e["kind"] == "star"] == EXPECTED["stars"]
    assert [e["id"] for e in es if e["kind"] == "planet"] == EXPECTED["planets"]
    for e in es:
        assert e["name"] and e["visual"]["colorHex"].startswith("#")
        assert "display only" in e["visual"]["note"]
        for key in ("massKg", "radiusM"):
            p = e["properties"][key]
            assert math.isfinite(p["value"]) and p["value"] > 0
            assert p["basis"] in ("measured", "nominal", "estimated", "illustrative")
            assert p["sourceValue"] and p["conversion"]
            assert p["sources"] and all(s["citation"] and s["url"].startswith("http") and s["retrieved"] for s in p["sources"])


def test_values_are_rederived_from_the_recorded_source_numbers():
    for e in entries():
        for key in ("massKg", "radiusM"):
            p = e["properties"][key]
            f = FACTOR[p["sourceUnit"]]
            assert p["value"] == pytest.approx(p["sourceNumber"] * f, rel=1e-14)
            u = p["uncertainty"]
            if u is None:
                continue
            if "range" in u:
                lo, hi = p["sourceRange"]
                assert u["range"] == pytest.approx([lo * f, hi * f], rel=1e-14)
                assert lo <= p["sourceNumber"] <= hi
            else:
                assert u["minus"] == pytest.approx(p["sourceUncertainty"]["minus"] * f, rel=1e-14)
                assert u["plus"] == pytest.approx(p["sourceUncertainty"]["plus"] * f, rel=1e-14)


@pytest.mark.parametrize("eid,mass_kg,radius_m", [
    ("earth", 5.97217e24, 6371.0084e3), ("mars", 0.641691e24, 3389.50e3),
    ("jupiter", 1898.125e24, 69911e3), ("neptune", 102.4092e24, 24622e3),
])
def test_planets_match_the_jpl_table_verbatim(eid, mass_kg, radius_m):
    e = next(x for x in entries() if x["id"] == eid)
    assert e["properties"]["massKg"]["value"] == pytest.approx(mass_kg, rel=1e-14)
    assert e["properties"]["radiusM"]["value"] == pytest.approx(radius_m, rel=1e-14)


def test_sun_mass_reproduces_the_de440_gm():
    sun = next(x for x in entries() if x["id"] == "sun")
    assert sun["properties"]["massKg"]["value"] * G == pytest.approx(1.32712440041279419e20, rel=1e-15)
    assert sun["properties"]["radiusM"]["value"] == 6.957e8
    assert sun["properties"]["radiusM"]["basis"] == "nominal"


def test_betelgeuse_is_disclosed_as_estimated_with_its_range():
    b = next(x for x in entries() if x["id"] == "betelgeuse")
    mass, radius = b["properties"]["massKg"], b["properties"]["radiusM"]
    assert mass["basis"] == radius["basis"] == "estimated"
    assert mass["sourceRange"] == [16.5, 19.0] and mass["sourceNumber"] == pytest.approx(17.75)
    assert "midpoint" in mass["note"] and "model-dependent" in radius["note"]
    assert radius["sourceUncertainty"] == {"minus": 62.0, "plus": 116.0}


def test_only_betelgeuse_is_estimated_and_none_is_illustrative():
    bases = {(e["id"], k): e["properties"][k]["basis"] for e in entries() for k in ("massKg", "radiusM")}
    assert {i for (i, _), b in bases.items() if b == "estimated"} == {"betelgeuse"}
    assert "illustrative" not in bases.values()


def test_entries_are_single_bodies_not_systems():
    for e in entries():
        assert set(e["properties"]) == {"massKg", "radiusM"}
        assert not any(k in e for k in ("positionM", "velocityMPerS", "bodies"))
    assert any("not validated systems" in n for n in catalogue.get_catalogue()["notes"])
    assert any("Colour is a display choice" in n for n in catalogue.get_catalogue()["notes"])


def test_catalogue_is_immutable():
    first = catalogue.get_catalogue()
    snapshot = copy.deepcopy(first)
    first["entries"][0]["properties"]["massKg"]["value"] = -1.0  # a caller mangling its copy ...
    first["entries"].clear()
    assert catalogue.get_catalogue() == snapshot  # ... never changes the catalogue


def test_catalogue_endpoint_is_read_only_and_matches(client):
    r = client.get("/api/v1/catalogue")
    assert r.status_code == 200
    j = r.json()
    assert [e["id"] for e in j["entries"]] == EXPECTED["stars"] + EXPECTED["planets"]
    assert j["entries"][4]["properties"]["massKg"]["basis"] == "estimated"
    for method in (client.post, client.put, client.patch, client.delete):
        assert method("/api/v1/catalogue").status_code == 405


def test_creating_from_the_catalogue_leaves_it_and_other_universes_unchanged(client):
    before = client.get("/api/v1/catalogue").json()
    other = client.post("/api/v1/universes", json={"source": {"kind": "empty"}}).json()["id"]
    sun = next(e for e in before["entries"] if e["id"] == "sun")
    body = {"name": "Sun", "massKg": sun["properties"]["massKg"]["value"], "radiusM": sun["properties"]["radiusM"]["value"],
            "positionM": {"x": 0, "y": 0, "z": 0}, "velocityMPerS": {"x": 0, "y": 0, "z": 0}, "colorHex": sun["visual"]["colorHex"],
            "kind": sun["kind"], "catalogueEntryId": "sun"}
    r = client.post("/api/v1/universes/uni-default/bodies?activationEpoch=1", json=body)
    assert r.status_code == 201 and r.json()["kind"] == "star" and r.json()["catalogueEntryId"] == "sun"
    client.patch(f"/api/v1/universes/uni-default/bodies/{r.json()['id']}?activationEpoch=1", json={"massKg": 1.0})
    assert client.get("/api/v1/catalogue").json() == before  # editing the created body did not touch the entry
    assert client.get(f"/api/v1/universes/{other}/state").json()["bodies"] == []


# ---------- custom stars and planets (M5 part 2) ----------
VALID = {"name": "Custom", "massKg": 1e30, "radiusM": 7e8, "positionM": {"x": 0, "y": 0, "z": 0},
         "velocityMPerS": {"x": 0, "y": 0, "z": 0}, "colorHex": "#ffffff"}


@pytest.mark.parametrize("extra", [{"kind": "moon"}, {"kind": ""}, {"kind": None}, {"catalogueEntryId": "no-such-entry"}, {"catalogueEntryId": ""}])
def test_invalid_kind_or_catalogue_id_is_rejected(client, extra):
    r = client.post("/api/v1/universes/uni-default/bodies?activationEpoch=1", json={**VALID, **extra})
    assert r.status_code == 422
    assert client.get("/api/v1/universes/uni-default/state").json()["bodies"] == []


def test_kind_can_be_changed_by_patch_and_must_be_valid(client):
    b = client.post("/api/v1/universes/uni-default/bodies?activationEpoch=1", json=VALID).json()
    assert b["kind"] == "planet"
    url = f"/api/v1/universes/uni-default/bodies/{b['id']}?activationEpoch=1"
    assert client.patch(url, json={"kind": "star"}).json()["kind"] == "star"
    assert client.patch(url, json={"kind": "moon"}).status_code == 422
    assert client.get("/api/v1/universes/uni-default/state").json()["bodies"][0]["kind"] == "star"
