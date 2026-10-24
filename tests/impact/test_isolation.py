"""Stage 10: universes share nothing (ISO-1..3, Scenario G). Each universe has its own engine, tables, records, event counter, ledger and
seed; an event in one leaves the other byte-identical; a snapshot belongs to the universe that made it."""
import pytest
from fastapi.testclient import TestClient

from backend import universes
from backend.main import app
from backend.simulation import ConflictError, SimulationService
from tests.helpers import dump, make
from tests.impact.test_engine_outcomes import ROCK, deferred, pair_service
from tests.impact.test_lifecycle import escape_service

TABLES = ("_materials", "_rotations", "_products", "_sites", "_escaped", "_collision_records", "_events", "_meta")


def test_two_universes_share_no_table_object():
    a, b = deferred(), deferred()
    for name in TABLES:
        assert getattr(a, name) is not getattr(b, name), name
    assert a._collision_engine is not b._collision_engine and a._resolver is not b._resolver and a._recorder is not b._recorder


def test_an_event_in_one_universe_leaves_the_other_untouched():
    a, b = deferred(), deferred()
    b.add_body(make("watcher", m=1.0e20, r=1.0e3, x=(1.0e12, 0.0, 0.0), material=ROCK))
    before = dump(b)
    state_before = b.collision_state()
    pair_service(3.0, 0.3, svc=a, spin={"x": 0.0, "y": 0.0, "z": 2.0e-4})
    a.step(a.approach_s)
    assert a.collision_records() and a._products and a._sites
    assert dump(b) == before and b.collision_state() == state_before
    assert b.collision_records() == [] and b._event_seq == 0 and b._products == {} and b._sites == {} and b._escaped == {}
    assert a._event_seq > 0


def test_escapes_and_ledgers_do_not_leak():
    a, frag, _ = escape_service()
    b = deferred()
    b.add_body(make("x", m=1.0e20, r=1.0e3))
    a.step(1.0)
    assert a._escaped and b._escaped == {} and b.snapshot().diagnostics.escaped is None
    assert b._resolver.heat_J == 0.0 and b._resolver.spin == {}


def test_the_seed_belongs_to_the_universe():
    """Universes derived from the SAME snapshot (same body ids) differ only by their seed: the same seed gives the same numbers, another
    seed gives other debris with the same totals. (Body ids are random per run, so fresh universes would differ for that reason alone.)"""
    from backend.impact.config import CollisionConfig

    base = deferred()
    pair_service(3.0, 0.3, svc=base)
    snap = base.capture_snapshot()

    def run(seed):
        svc = SimulationService.from_snapshot(snap, history_mode="step", collision_config=CollisionConfig(mode="outcome-v1", seed=seed))
        out = svc.step(base.approach_s)
        rec = svc.collision_records()[0]
        return out, rec, sorted((b.massKg, b.velocityMPerS.x, b.velocityMPerS.y) for b in out.bodies)

    out1, rec1, n1 = run(12345)
    out2, rec2, n2 = run(12345)
    out3, rec3, n3 = run(777)
    assert rec1.input.config.seed == rec2.input.config.seed == 12345 and rec3.input.config.seed == 777
    assert rec1.input.seed == rec2.input.seed != rec3.input.seed
    assert n1 == n2
    assert n1 != n3
    assert out1.diagnostics.totalMassKg == pytest.approx(out3.diagnostics.totalMassKg, rel=1e-14)


def test_a_snapshot_belongs_to_the_universe_that_made_it():
    a, b = deferred(), deferred()
    a.add_body(make("x", m=1.0e20, r=1.0e3))
    snap = a.capture_snapshot()
    with pytest.raises(ConflictError, match="another universe"):
        b.restore_snapshot(snap)
    assert b.collision_records() == [] and b._materials == {}


def test_registry_universes_list_only_their_own_collisions():
    client = TestClient(app)
    registry = universes.get_registry()
    other = registry.create("second")
    first = registry.get(universes.DEFAULT_UNIVERSE_ID).engine
    pair_service(3.0, 0.3, svc=first)
    first.step(first.approach_s)
    mine = client.get(f"/api/v1/universes/{universes.DEFAULT_UNIVERSE_ID}/collisions").json()
    theirs = client.get(f"/api/v1/universes/{other.id}/collisions").json()
    assert mine["total"] >= 1 and theirs["total"] == 0 and theirs["records"] == []
    assert client.get(f"/api/v1/universes/{other.id}/collisions/col-1").status_code == 404  # an id of another universe is not found here
    assert registry.get(other.id).engine.snapshot().bodies == []


def test_resetting_one_universe_does_not_reset_another():
    a, b = deferred(), deferred()
    for svc in (a, b):
        pair_service(3.0, 0.3, svc=svc)
        svc.step(svc.approach_s)
    n_before = len(b.collision_records())
    a.reset()
    assert a.collision_records() == [] and a._products == {}
    assert len(b.collision_records()) == n_before and b._products
