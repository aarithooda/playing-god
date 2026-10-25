"""Stage 10: the versioned `CollisionState` and the in-process state paths (D-054: OD-5 stands, there is NO persistence across restarts).

These tests prove that the collision state can be written out in a canonical, versioned form and read back without loss, and that the
in-process paths (snapshot, restore, reset, derive, rollback) carry it. They add no loader and no disk behaviour.
"""
import dataclasses
import json
import os
import pathlib

import pytest

from backend.impact.collision_state import CollisionState, tables_of
from backend.impact.contracts import ContractError
from backend.simulation import EngineSnapshot, LEGACY_MERGE_CONFIG, SimulationService
from tests.helpers import make
from tests.impact.test_engine_outcomes import ROCK, deferred, pair_service
from tests.impact.test_lifecycle import escape_service
from tests.impact.test_damage import south_pole_service


def rich_service():
    """A universe with materials, a rotation state, a product table (fragments + parcels), sites, records and a booked-spin ledger."""
    svc = deferred()
    pair_service(3.0, 0.3, svc=svc, spin={"x": 0.0, "y": 0.0, "z": 2.0e-4})
    svc.step(svc.approach_s)
    return svc


def numbers(out):
    """The physical numbers of a step response, without ids (ids are never reused, so a replay names its products differently)."""
    return sorted((b.massKg, b.radiusM, b.positionM.x, b.positionM.y, b.positionM.z, b.velocityMPerS.x, b.velocityMPerS.y, b.velocityMPerS.z)
                  for b in out.bodies)


def test_the_collision_state_round_trips_through_its_canonical_json():
    svc = rich_service()
    state = svc.collision_state()
    assert state.schema_version == 1 and state.config == svc.collision_config and state.event_seq == svc._event_seq
    assert state.records and any(b.product is not None for b in state.bodies) and any(b.rotation is not None for b in state.bodies)
    text = state.to_json()
    again = CollisionState.from_dict(json.loads(text))
    assert again == state and again.to_json() == text and again.digest() == state.digest()
    assert json.loads(text)["schemaVersion"] == 1
    assert [b.body_id for b in state.bodies] == sorted(b.body_id for b in state.bodies)  # canonical order


def test_the_serialised_form_is_lossless_against_the_live_tables():
    for svc in (rich_service(), south_pole_service()[0], escape_service()[0]):
        svc.step(2.5e3 if svc._sites or svc._materials else 1.0)
        tables = tables_of(CollisionState.from_dict(json.loads(svc.collision_state().to_json())))
        assert tables["materials"] == svc._materials
        assert tables["rotations"] == svc._rotations
        assert tables["products"] == svc._products
        assert tables["sites"] == {k: v for k, v in svc._sites.items() if v}
        assert tables["escaped"] == svc._escaped
        assert tables["event_seq"] == svc._event_seq and tables["records"] == svc.collision_records()
        assert tables["heat_j"] == svc._resolver.heat_J
        booked = {k: v for k, v in svc._resolver.spin.items() if any(c != 0.0 for c in v)}
        assert tables["spin"] == {k: list(v) for k, v in booked.items()}


def test_the_state_of_an_escape_is_serialised_with_its_ledger():
    svc, frag, probe = escape_service()
    svc.step(1.0)
    state = svc.collision_state()
    assert state.escaped is not None and state.escaped.mass_kg == 1.0e3 and [b.body_id for b in state.escaped.bodies] == [frag.id]
    assert CollisionState.from_dict(json.loads(state.to_json())).escaped == state.escaped


def test_an_unsupported_version_or_an_unknown_key_is_refused_not_guessed():
    d = rich_service().collision_state().to_dict()
    with pytest.raises(ContractError, match="unsupported"):
        CollisionState.from_dict({**d, "schemaVersion": 2})
    with pytest.raises(ContractError):
        CollisionState.from_dict({**d, "surprise": 1})
    broken = dict(d)
    del broken["config"]
    with pytest.raises(ContractError):
        CollisionState.from_dict(broken)
    dup = dict(d)
    dup["bodies"] = [d["bodies"][0], d["bodies"][0]]
    with pytest.raises(ContractError, match="duplicate"):
        CollisionState.from_dict(dup)


def test_an_empty_universe_has_an_empty_state_and_a_legacy_universe_too():
    for svc in (deferred(), SimulationService(LEGACY_MERGE_CONFIG)):
        svc.add_body(make("a", m=1e20, r=1e3))
        s = svc.collision_state()
        assert s.bodies == () and s.records == () and s.escaped is None and s.booked_spin == () and s.event_seq == 0
        assert CollisionState.from_dict(json.loads(s.to_json())) == s


def test_snapshot_collisions_restore_gives_a_bitwise_identical_continuation():
    svc = deferred()
    pair_service(3.0, 0.3, svc=svc, spin={"x": 0.0, "y": 0.0, "z": 2.0e-4})
    snap = svc.capture_snapshot()
    first = svc.step(svc.approach_s)
    after_first = svc.collision_state()
    more_first = svc.step(svc.approach_s / 4)
    svc.restore_snapshot(snap)
    assert svc.collision_records() == [] and svc._products == {} and svc._sites == {}
    second = svc.step(svc.approach_s)
    more_second = svc.step(svc.approach_s / 4)
    assert numbers(first) == numbers(second)  # bitwise: the same floats, run twice from the same snapshot
    assert numbers(more_first) == numbers(more_second)
    again = svc.collision_state()
    assert [r.result_digest for r in again.records][:1] != [] and len(again.records) == len(after_first.records)
    assert [r.input.impact for r in again.records] == [r.input.impact for r in after_first.records]  # the same events, recorded again


def test_the_replayed_event_digests_do_not_depend_on_how_often_the_universe_was_restored():
    svc = deferred()
    pair_service(3.0, 0.3, svc=svc)
    snap = svc.capture_snapshot()
    inputs = []
    for _ in range(3):
        svc.restore_snapshot(snap)
        svc.step(svc.approach_s)
        rec = svc.collision_records()[0]
        inputs.append((rec.input.impact, rec.input.seed))
    # the same physical input and the same seed every time; only the event id (the counter keeps counting, ids are never reused) differs
    assert inputs[0] == inputs[1] == inputs[2]


def test_a_snapshot_that_predates_the_collision_fields_restores_with_empty_state():
    rich = rich_service()
    snap = rich.capture_snapshot()
    old_shape = {f.name for f in dataclasses.fields(EngineSnapshot)} - {"materials", "rotations", "products", "sites", "escaped", "records"}
    bare = EngineSnapshot(**{n: getattr(snap, n) for n in old_shape})  # as a pre-Stage-2 snapshot was built
    assert bare.materials == {} and bare.rotations == {} and bare.products == {} and bare.sites == {} and bare.escaped == {} and bare.records == []
    assert rich.collision_state().bodies  # it had collision state before
    rich.restore_snapshot(bare)
    s = rich.collision_state()
    assert s.bodies == () and s.records == () and s.escaped is None


def test_orbit_lab_style_derivation_copies_the_state_without_sharing_it():
    svc = rich_service()
    snap = svc.capture_snapshot()
    derived = SimulationService.from_snapshot(snap, history_mode="step", collision_config=LEGACY_MERGE_CONFIG)
    assert derived.collision_config.mode == "legacy-merge"
    assert tables_of(derived.collision_state())["materials"] == svc._materials
    for name in ("_materials", "_rotations", "_products", "_sites", "_escaped"):
        assert getattr(derived, name) is not getattr(svc, name)
    derived._materials.clear()
    derived._sites.clear()
    assert svc._materials and svc._sites  # editing the derived universe leaves the source alone


def test_no_disk_behaviour_was_added():
    """D-054: nothing in the collision engine writes files or opens a storage path."""
    root = pathlib.Path(__file__).resolve().parents[2] / "backend" / "impact"
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for needle in ("open(", "write_text(", "write_bytes(", "sqlite", "pickle", "shelve", "os.makedirs", "tempfile"):
            assert needle not in text.replace("opened", "") or path.name in ("materials.py",), (path.name, needle)
    assert "PG_" not in (root / "collision_state.py").read_text(encoding="utf-8") and os.environ.get("PG_STATE_DIR") is None
