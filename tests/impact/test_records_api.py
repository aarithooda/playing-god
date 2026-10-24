"""Stage 8: collision records over the API (list, detail) and deterministic dry-run replay (spec 10.2, 10.5; D-052).

Science PROVISIONAL (CP-SCI-1 unsigned): these tests check that what happened is inspectable and reproducible, not that it is right.
"""
import dataclasses
import itertools
import math

import pytest
from fastapi.testclient import TestClient

from backend import universes
from backend.impact.replay import replay
from backend.main import app
from backend.simulation import G_SI, LEGACY_MERGE_CONFIG, SimulationService
from tests.helpers import dump, make
from tests.impact.test_engine_outcomes import ROCK, deferred, pair_service
from tests.impact.test_lifecycle import secondary_impact_service

UID = universes.DEFAULT_UNIVERSE_ID


@pytest.fixture
def client():
    return TestClient(app)


def engine():
    return universes.get_registry().get(UID).engine


def run_pair(svc, x, b, **kw):
    pair_service(x, b, svc=svc, **kw)
    return svc.step(svc.approach_s)


# ------------------------------------------------------------------------------------------------ the record carries every 10.2 item
SPEC_10_2 = {
    "event identifier and parent": ("eventId", "parentEventId", "rootEventId", "generation"),
    "pre-impact body states": ("input.impact.target", "input.impact.projectile"),
    "impact geometry and relative velocity": ("input.impact.contactNormal", "input.impact.contactPointM", "input.impact.relativeVelocityMPerS",
                                              "input.impact.impactSpeedMPerS", "input.impact.impactAngleDeg"),
    "material profiles and model parameters": ("input.impact.target.materialProfile", "outcomeSpec.parameters", "selectionReasons"),
    "selected outcome and model version": ("outcomeSpec.outcome", "outcomeSpec.modelId", "outcomeSpec.modelVersion"),
    "post-impact remnant states": ("result.transformed", "result.created", "result.removedBodyIds"),
    "fragment and debris accounting": ("result.debrisParcels", "result.massLedger.fragmentsKg", "result.massLedger.parcelsKg",
                                       "result.massLedger.returnedToRemnantKg"),
    "mass and momentum residuals": ("result.conservation.massResidualRel", "result.conservation.momentumResidualRel"),
    "angular-momentum diagnostics": ("result.conservation.angularMomentumBeforeKgM2PerS", "result.conservation.angularMomentumAfterKgM2PerS"),
    "energy diagnostics": ("result.conservation.energy.dissipatedJ", "result.conservation.energy.kineticTranslationalBeforeJ"),
    "warnings, fallbacks and approximations": ("warnings", "fidelity", "result.warnings", "result.fidelity"),
}


def dig(d, path):
    for part in path.split("."):
        assert isinstance(d, dict) and part in d, f"missing {path} at {part}"
        d = d[part]
    return d


def test_the_detail_route_returns_every_item_of_spec_10_2(client):
    run_pair(engine(), 3.0, 0.3)
    j = client.get(f"/api/v1/universes/{UID}/collisions/col-1").json()
    rec = j["record"]
    for item, paths in SPEC_10_2.items():
        for path in paths:
            dig(rec, path)  # raises with the item's path if absent
    assert rec["eventId"] == "col-1" and rec["parentEventId"] is None and rec["generation"] == 0 and rec["inputDigest"] and rec["resultDigest"]
    assert j["childEventIds"] == [] and "CP-SCI-1" in j["note"]
    kinds = {p["representation"] for p in j["products"]}
    assert "debris-parcel" in kinds and "fragment" in kinds
    assert all(p["exists"] and p["fragmentClass"] for p in j["products"] if p["representation"] != "body")
    assert sum(p["massKgNow"] for p in j["products"]) == pytest.approx(rec["input"]["impact"]["totalMassKg"], rel=1e-12)


def test_the_list_route_paginates_filters_and_is_empty_for_a_legacy_universe(client):
    svc, first, target = secondary_impact_service()
    # `secondary_impact_service` builds its own engine: use it through the registry instead
    registry = universes.get_registry()
    u = registry.create("with events")
    u.engine = svc
    svc.step(2.0 * svc.hunter_gap_s)
    j = client.get(f"/api/v1/universes/{u.id}/collisions").json()
    assert j["total"] == len(j["records"]) >= 2 and j["records"][0]["eventId"] == "col-1" and j["records"][0]["generation"] == 0
    child = next(r for r in j["records"] if r["parentEventId"] == "col-1")
    assert child["rootEventId"] == "col-1" and child["generation"] == 1
    assert [r["eventId"] for r in client.get(f"/api/v1/universes/{u.id}/collisions?limit=1&offset=1").json()["records"]] == [j["records"][1]["eventId"]]
    assert {r["parentEventId"] for r in client.get(f"/api/v1/universes/{u.id}/collisions?parentEventId=col-1").json()["records"]} == {"col-1"}
    assert all(r["rootEventId"] == "col-1" for r in client.get(f"/api/v1/universes/{u.id}/collisions?rootEventId=col-1").json()["records"])
    detail = client.get(f"/api/v1/universes/{u.id}/collisions/col-1").json()
    assert child["eventId"] in detail["childEventIds"]
    legacy = registry.create("legacy", engine=SimulationService(LEGACY_MERGE_CONFIG))
    assert client.get(f"/api/v1/universes/{legacy.id}/collisions").json() == {
        "schemaVersion": 1, "universeId": legacy.id, "total": 0, "offset": 0, "limit": 50, "maxRecords": 1000, "records": []}
    assert client.get(f"/api/v1/universes/{u.id}/collisions?limit=0").status_code == 422
    assert client.get("/api/v1/universes/uni-nope/collisions").status_code == 404


def test_unknown_and_dropped_records_are_a_coded_404(client):
    run_pair(engine(), 3.0, 0.0)
    for r in (client.get(f"/api/v1/universes/{UID}/collisions/col-99"), client.post(f"/api/v1/universes/{UID}/collisions/col-99/replay")):
        assert r.status_code == 404
        body = r.json()
        assert "collision_record_not_found" in str(body) and "1000" in str(body)  # the message names the retention bound
    assert client.get(f"/api/v1/universes/{UID}/collisions/evt-9").status_code == 404


def test_a_legacy_merger_event_of_a_material_less_pair_has_a_record_found_by_either_id(client):
    svc = engine()
    svc.add_body(make("a", m=1.0e22, r=1.0e6))
    svc.add_body(make("b", m=1.0e17, r=2.0e4, x=(3.0e6, 0.0, 0.0), v=(-1.5e3, 0.0, 0.0)))
    svc.step(2.5e3)
    (event,) = svc.events()
    assert event.type == "merger"
    by_evt = client.get(f"/api/v1/universes/{UID}/collisions/{event.id}").json()["record"]
    by_col = client.get(f"/api/v1/universes/{UID}/collisions/col-1").json()["record"]
    assert by_evt == by_col and by_evt["legacyEventId"] == event.id and by_evt["result"] is None and by_evt["resultDigest"] == ""
    assert "material_unspecified" in by_evt["warnings"]
    rep = client.post(f"/api/v1/universes/{UID}/collisions/{event.id}/replay").json()
    assert rep["reproduced"] is True and rep["recordedResultDigest"] == "" and [c["ok"] for c in rep["checks"]][:3] == [True, True, True]


# ------------------------------------------------------------------------------------------------ replay
def grid_records():
    """~50 recorded events from a parameter grid (every outcome class the grid reaches, fallbacks included), each in a fresh engine."""
    out = []
    spin = {"x": 0.0, "y": 0.0, "z": 2.0e-4}
    for x, b, gamma in itertools.product((0.95, 1.05, 1.4, 3.0, 9.0), (0.0, 0.5, 0.9, 0.97), (1.0, 0.3, 0.05)):
        svc = deferred()
        pair_service(x, b, m_t=1.0e22, m_p=1.0e22 * gamma, svc=svc, spin=spin)
        svc.step(svc.approach_s)
        out.extend(svc.collision_records())
    return out


def test_replay_reproduces_the_result_digest_of_50_recorded_events():
    records = grid_records()
    assert len(records) >= 50
    outcomes = {r.outcome_spec.outcome for r in records}
    assert len(outcomes) >= 4
    for r in records:
        rep = replay(r, G_SI)
        assert rep["reproduced"], (r.event_id, r.outcome_spec.outcome, rep["checks"], rep["differingFields"])
        assert rep["replayedResultDigest"] == r.result_digest and rep["mutatesState"] is False
    assert any("model_failed_fallback" in r.warnings for r in records)  # the grid includes engine fallbacks, and they replay too


def test_replay_reproduces_a_cascade_limited_child_and_a_budget_limited_event():
    svc, first, target = secondary_impact_service(max_fragmenting_generation=0)
    svc.step(2.0 * svc.hunter_gap_s)
    child = next(r for r in svc.collision_records() if r.generation == 1)
    assert "cascade_limit_reached" in child.warnings
    assert replay(child, G_SI)["reproduced"]
    from backend.impact.config import CollisionConfig  # noqa: F401

    tight = deferred(max_tracked_fragments_per_event=3, max_debris_parcels_per_event=1)
    run_pair(tight, 3.0, 0.2)
    rec = tight.collision_records()[0]
    assert rec.result.fields_extra["replayBudgetFragments"] == 3.0 and replay(rec, G_SI)["reproduced"]


def test_replay_after_a_snapshot_restore_is_identical_and_never_changes_the_universe(client):
    svc = engine()
    run_pair(svc, 3.0, 0.3)
    snap = svc.capture_snapshot()
    before_digest = [replay(r, G_SI)["replayedResultDigest"] for r in svc.collision_records()]
    svc.reset()
    assert svc.collision_records() == []
    svc.restore_snapshot(snap)
    state_before, revision_before = dump(svc), svc.revision
    for r in svc.collision_records():
        rep = client.post(f"/api/v1/universes/{UID}/collisions/{r.event_id}/replay").json()
        assert rep["reproduced"] is True and rep["mutatesState"] is False
    assert [replay(r, G_SI)["replayedResultDigest"] for r in svc.collision_records()] == before_digest
    assert dump(svc) == state_before and svc.revision == revision_before  # a dry run: nothing changed, no revision bump


def test_a_tampered_record_is_reported_not_reproduced():
    svc = deferred()
    run_pair(svc, 3.0, 0.3)
    rec = svc.collision_records()[0]
    bad_input = dataclasses.replace(rec, input_digest="0" * 64)
    rep = replay(bad_input, G_SI)
    assert rep["reproduced"] is False and not next(c for c in rep["checks"] if c["name"] == "inputDigest")["ok"]
    bad_result = dataclasses.replace(rec, result_digest="1" * 64)
    rep = replay(bad_result, G_SI)
    assert rep["reproduced"] is False and not next(c for c in rep["checks"] if c["name"] == "result")["ok"] and rep["recordedResultDigest"] == "1" * 64
    other = dataclasses.replace(rec, outcome_spec=dataclasses.replace(rec.outcome_spec, debris_mass_kg=rec.outcome_spec.debris_mass_kg * 0.5))
    with pytest.raises(ValueError):
        replay(other, G_SI)  # a spec that no longer conserves mass cannot be realised: it is an error, not a silent pass


def test_replay_notes_a_changed_model_in_the_selection_check(monkeypatch):
    svc = deferred()
    run_pair(svc, 3.0, 0.3)
    rec = svc.collision_records()[0]
    import backend.impact.replay as replay_module

    class Other:
        def __init__(self, g):
            pass

        def select(self, data):
            class S:
                spec = dataclasses.replace(rec.outcome_spec, model_version="changed")

            return S

    monkeypatch.setattr(replay_module, "Selector", Other)
    rep = replay_module.replay(rec, G_SI)
    sel = next(c for c in rep["checks"] if c["name"] == "selection")
    assert sel["ok"] is False and rep["reproduced"] is False
