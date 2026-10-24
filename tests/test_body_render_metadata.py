"""Renderer metadata contract: `bodyType` (always present) and `assetKey` (nullable) on every returned body.

Covers the five response paths (state, step, reset, create, update), request validation, omission semantics of
partial updates, snapshot restore, history metadata and the merger-result rule. See context/BODY_RENDER_METADATA.md.
"""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.models import BodyUpdate
from backend.simulation import SimulationService, get_service
from tests.helpers import make

BODY_TYPES = ["star", "rocky-planet", "gas-giant", "ice-giant", "asteroid", "default"]


@pytest.fixture
def service():
    return SimulationService()


@pytest.fixture
def client(service):
    app.dependency_overrides[get_service] = lambda: service
    yield TestClient(app)
    app.dependency_overrides.clear()


def payload(name="b", m=1.0e20, r=1.0, x=0.0, vx=0.0, **extra):
    return {"name": name, "massKg": m, "radiusM": r, "positionM": {"x": x, "y": 0.0, "z": 0.0},
            "velocityMPerS": {"x": vx, "y": 0.0, "z": 0.0}, "colorHex": "#abcdef", **extra}


def create(client, **kw):
    r = client.post("/api/v1/bodies", json=payload(**kw))
    assert r.status_code == 201, r.text
    return r.json()


def meta(b):
    return b["bodyType"], b["assetKey"]


# ---- the five response paths ------------------------------------------------------------------------------------
def test_all_five_response_paths_carry_both_fields(client):
    created = create(client, name="Earth", x=1000.0, kind="planet", bodyType="rocky-planet", assetKey="earth")
    assert meta(created) == ("rocky-planet", "earth")
    state = client.get("/api/v1/simulation/state").json()
    assert meta(state["bodies"][0]) == ("rocky-planet", "earth")
    patched = client.patch(f"/api/v1/bodies/{created['id']}", json={"name": "Terra"}).json()
    assert meta(patched) == ("rocky-planet", "earth")
    stepped = client.post("/api/v1/simulation/step", json={"dtS": 1.0}).json()
    assert meta(stepped["bodies"][0]) == ("rocky-planet", "earth")
    assert client.post("/api/v1/simulation/reset").json()["bodies"] == []  # legacy reset empties the sandbox


def test_universe_scoped_paths_carry_both_fields(client):
    q = "?activationEpoch=1"
    base = "/api/v1/universes/uni-default"
    c = client.post(f"{base}/bodies{q}", json=payload(x=1000.0, bodyType="gas-giant", assetKey="jupiter"))
    assert c.status_code == 201 and meta(c.json()) == ("gas-giant", "jupiter")
    bid = c.json()["id"]
    assert meta(client.get(f"{base}/state").json()["bodies"][0]) == ("gas-giant", "jupiter")
    assert meta(client.patch(f"{base}/bodies/{bid}{q}", json={"name": "J"}).json()) == ("gas-giant", "jupiter")
    assert meta(client.post(f"{base}/step{q}", json={"dtS": 1.0}).json()["bodies"][0]) == ("gas-giant", "jupiter")


def test_universe_reset_returns_initial_bodies_with_their_metadata(client):
    """Reset of a universe that has bodies in its initial state (a preset) carries the fields for every body."""
    base = "/api/v1/universes"
    made = client.post(base, json={"source": {"kind": "preset", "presetId": "solar-system-j2000"}, "activate": True})
    assert made.status_code == 201, made.text
    uid = made.json()["id"]
    q = f"?activationEpoch={client.get(base).json()['activationEpoch']}"
    client.post(f"{base}/{uid}/step{q}", json={"dtS": 86400.0})
    out = client.post(f"{base}/{uid}/reset{q}").json()
    assert len(out["bodies"]) == 9
    for b in out["bodies"]:
        assert b["bodyType"] in BODY_TYPES and "assetKey" in b


# ---- defaults, validation ---------------------------------------------------------------------------------------
def test_defaults_derive_from_kind_only_never_from_the_name(client):
    assert meta(create(client, name="Earth", x=0.0)) == ("default", None)  # the name "Earth" implies nothing
    assert meta(create(client, name="Sun", x=100.0, kind="star")) == ("star", None)
    assert meta(create(client, name="p", x=200.0, bodyType=None, assetKey=None)) == ("default", None)  # null = omitted


@pytest.mark.parametrize("body_type", BODY_TYPES)
def test_every_allowed_body_type_is_accepted(client, body_type):
    kind = "star" if body_type == "star" else "planet"
    assert create(client, kind=kind, bodyType=body_type)["bodyType"] == body_type


@pytest.mark.parametrize("bad", ["Star", "rocky_planet", "planet", "comet", "", 5, ["star"]])
def test_invalid_body_type_is_rejected_on_create_and_update(client, bad):
    assert client.post("/api/v1/bodies", json=payload(bodyType=bad)).status_code == 422
    b = create(client, x=5000.0)
    assert client.patch(f"/api/v1/bodies/{b['id']}", json={"bodyType": bad}).status_code == 422


def test_update_body_type_cannot_be_null(client):
    b = create(client)
    assert client.patch(f"/api/v1/bodies/{b['id']}", json={"bodyType": None}).status_code == 422


@pytest.mark.parametrize("kind,body_type", [("planet", "star"), ("star", "rocky-planet"), ("star", "asteroid")])
def test_kind_and_body_type_must_agree_on_create(client, kind, body_type):
    assert client.post("/api/v1/bodies", json=payload(kind=kind, bodyType=body_type)).status_code == 422


def test_default_body_type_fits_either_kind(client):
    assert create(client, kind="star", bodyType="default", x=0.0)["bodyType"] == "default"
    assert create(client, kind="planet", bodyType="default", x=100.0)["bodyType"] == "default"


def test_update_enforces_kind_body_type_agreement_on_merged_values(client):
    earth = create(client, bodyType="rocky-planet")
    r = client.patch(f"/api/v1/bodies/{earth['id']}", json={"kind": "star"})  # would leave a "rocky-planet" star
    assert r.status_code == 409
    assert client.get("/api/v1/simulation/state").json()["bodies"][0]["kind"] == "planet"  # nothing changed
    ok = client.patch(f"/api/v1/bodies/{earth['id']}", json={"kind": "star", "bodyType": "star"})
    assert ok.status_code == 200 and ok.json()["bodyType"] == "star"
    assert client.patch(f"/api/v1/bodies/{earth['id']}", json={"bodyType": "gas-giant"}).status_code == 409


@pytest.mark.parametrize("good", ["earth", "proxima-centauri", "trappist-1", "a", "x" * 64])
def test_well_formed_asset_keys_are_accepted_even_if_unknown(client, good):
    assert create(client, assetKey=good)["assetKey"] == good  # the backend does not own the asset registry


@pytest.mark.parametrize("bad", ["", "Earth", "earth texture", "earth_", "-earth", "earth-", "a--b", "x" * 65, 7])
def test_malformed_asset_keys_are_rejected(client, bad):
    assert client.post("/api/v1/bodies", json=payload(assetKey=bad)).status_code == 422
    b = create(client, x=9000.0)
    assert client.patch(f"/api/v1/bodies/{b['id']}", json={"assetKey": bad}).status_code == 422


# ---- omission semantics -----------------------------------------------------------------------------------------
def test_partial_update_preserves_metadata_when_fields_are_omitted(client):
    b = create(client, name="Earth", bodyType="rocky-planet", assetKey="earth")
    for patch in ({"name": "Terra"}, {"colorHex": "#112233"}, {"massKg": 2.0e20}, {"kind": "planet"},
                  {"positionM": {"x": 50.0, "y": 0.0, "z": 0.0}}):
        out = client.patch(f"/api/v1/bodies/{b['id']}", json=patch)
        assert out.status_code == 200 and meta(out.json()) == ("rocky-planet", "earth"), patch
    assert meta(client.get("/api/v1/simulation/state").json()["bodies"][0]) == ("rocky-planet", "earth")


def test_update_sets_changes_and_clears_each_field_independently(client):
    b = create(client, bodyType="rocky-planet", assetKey="earth")
    assert meta(client.patch(f"/api/v1/bodies/{b['id']}", json={"assetKey": "mars"}).json()) == ("rocky-planet", "mars")
    assert meta(client.patch(f"/api/v1/bodies/{b['id']}", json={"bodyType": "asteroid"}).json()) == ("asteroid", "mars")
    cleared = client.patch(f"/api/v1/bodies/{b['id']}", json={"assetKey": None})  # explicit null clears the asset
    assert cleared.status_code == 200 and meta(cleared.json()) == ("asteroid", None)
    assert client.patch(f"/api/v1/bodies/{b['id']}", json={}).status_code == 422  # still needs one field


def test_metadata_edit_is_not_a_physical_edit(service):
    b = service.add_body(make("A"))
    controlled, revision = service.controlled, service.revision
    service.update_body(b.id, BodyUpdate(bodyType="asteroid", assetKey="ceres"))
    assert service.controlled == controlled and service.revision == revision + 1


# ---- snapshots, history -----------------------------------------------------------------------------------------
def test_snapshot_restore_brings_back_metadata(service):
    a = service.add_body(make("A", bodyType="rocky-planet", assetKey="earth"))
    snap = service._take_snapshot()
    service.update_body(a.id, BodyUpdate(bodyType="asteroid", assetKey=None))
    assert (service.snapshot().bodies[0].bodyType, service.snapshot().bodies[0].assetKey) == ("asteroid", None)
    restored = service.restore_snapshot(snap)
    assert (restored.bodies[0].bodyType, restored.bodies[0].assetKey) == ("rocky-planet", "earth")


def test_history_body_metadata_carries_both_fields(service):
    b = service.add_body(make("Earth", bodyType="rocky-planet", assetKey="earth"))
    service.step(1.0)
    entry = service.history.page(None, 0, None, 100)["bodies"][b.id]
    assert entry["bodyType"] == "rocky-planet" and entry["assetKey"] == "earth"


# ---- merger-result rule -----------------------------------------------------------------------------------------
def merge(client, a_extra, b_extra):
    a = client.post("/api/v1/bodies", json={**payload("A", m=2000.0, r=1.0, x=-100.0, vx=1.0), **a_extra}).json()
    client.post("/api/v1/bodies", json={**payload("B", m=1000.0, r=0.8, x=100.0, vx=-1.0), **b_extra})
    out = client.post("/api/v1/simulation/step", json={"dtS": 130.0}).json()
    assert [e["resultBodyId"] for e in out["events"]] == [a["id"]]  # the heavier body survives
    return a, out


def test_merger_product_has_generic_type_and_no_inherited_asset(client):
    a, out = merge(client, dict(bodyType="rocky-planet", assetKey="earth"), dict(bodyType="asteroid", assetKey="ceres"))
    (product,) = out["bodies"]
    assert product["id"] == a["id"] and meta(product) == ("default", None)
    assert product["name"] == "A" and product["colorHex"] == "#abcdef"  # existing survivor behaviour is untouched
    assert meta(client.get("/api/v1/simulation/state").json()["bodies"][0]) == ("default", None)


def test_star_merger_product_stays_a_star_without_an_asset(client):
    _, out = merge(client, dict(kind="star", bodyType="star", assetKey="sun"), dict(kind="star", bodyType="star"))
    assert meta(out["bodies"][0]) == ("star", None) and out["bodies"][0]["kind"] == "star"


def test_merger_leaves_unrelated_bodies_metadata_alone(client):
    far = create(client, name="Far", m=1.0e20, x=1.0e7, bodyType="gas-giant", assetKey="jupiter")
    merge(client, dict(assetKey="earth"), dict(assetKey="ceres"))
    bodies = {b["id"]: b for b in client.get("/api/v1/simulation/state").json()["bodies"]}
    assert meta(bodies[far["id"]]) == ("gas-giant", "jupiter")


# ---- presets ----------------------------------------------------------------------------------------------------
EXPECTED_SOLAR = {"body-sun": ("star", "sun"), "body-mercury": ("rocky-planet", "mercury"), "body-venus": ("rocky-planet", "venus"),
                  "body-earth": ("rocky-planet", "earth"), "body-mars": ("rocky-planet", "mars"),
                  "body-jupiter": ("gas-giant", "jupiter"), "body-saturn": ("gas-giant", "saturn"),
                  "body-uranus": ("ice-giant", "uranus"), "body-neptune": ("ice-giant", "neptune")}


def test_solar_system_preset_populates_metadata_in_state_and_after_reset(client):
    base = "/api/v1/universes"
    made = client.post(base, json={"source": {"kind": "preset", "presetId": "solar-system-j2000"}, "activate": True})
    uid = made.json()["id"]
    state = client.get(f"{base}/{uid}/state").json()
    assert {b["id"]: meta(b) for b in state["bodies"]} == EXPECTED_SOLAR
    q = f"?activationEpoch={client.get(base).json()['activationEpoch']}"
    client.post(f"{base}/{uid}/step{q}", json={"dtS": 86400.0})
    reset = client.post(f"{base}/{uid}/reset{q}").json()
    assert {b["id"]: meta(b) for b in reset["bodies"]} == EXPECTED_SOLAR


def test_preset_loader_rejects_bad_metadata(tmp_path, monkeypatch):
    import json
    import shutil

    from backend.presets import loader
    shutil.copytree(loader.DATA_DIR, tmp_path / "data")
    shutil.copytree(Path(loader.DATA_DIR).parent / "sources", tmp_path / "sources")
    path = tmp_path / "data" / "solar-system-j2000.json"
    for field, value in (("bodyType", "comet"), ("assetKey", "Not Kebab"), ("bodyType", "rocky-planet")):
        data = json.loads(Path(loader.DATA_DIR, "solar-system-j2000.json").read_text(encoding="utf-8"))
        data["bodies"][0][field] = value  # body 0 is the Sun, a star: "rocky-planet" contradicts its kind
        path.write_text(json.dumps(data), encoding="utf-8")
        monkeypatch.setattr(loader, "DATA_DIR", tmp_path / "data")
        monkeypatch.setattr(loader, "SOURCES_DIR", tmp_path / "sources", raising=False)
        with pytest.raises(loader.PresetDataError):
            loader.load_preset("solar-system-j2000")
