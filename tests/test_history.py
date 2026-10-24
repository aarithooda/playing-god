"""Backend-recorded history (UI-2, plan section 11B): recording, bounds, rollback, partitioning."""
import pytest
from fastapi.testclient import TestClient

from backend.history import HistoryBuffer
from backend.main import app
from backend.simulation import SimulationService
from tests.helpers import DAY, loaded_engine, make, sun_earth, two_bodies


def times(engine):
    page = engine.history.page(None, 0, None, 5000)
    return [s["simulationTimeS"] for s in page["samples"]]


def test_grid_history_exact_times():
    s = loaded_engine()
    s.step(10.5 * DAY)
    assert times(s) == [k * DAY for k in range(11)]  # sample 0 at load, then every exact k * interval
    assert s.snapshot().simulationTimeS == 10.5 * DAY
    s.step(0.5 * DAY)
    assert times(s)[-1] == 11 * DAY


def test_grid_samples_hold_the_state_at_that_time():
    s = loaded_engine()
    s.step(3 * DAY)
    ref = loaded_engine()
    ref.step(2 * DAY)  # a different chunking path, same physics: positions agree to far below a metre
    got = s.history.page(s.history.generation, 2, None, 1)["samples"][0]["positionsM"]["body-earth"]
    want = ref.snapshot().bodies[1].positionM
    assert got == pytest.approx([want.x, want.y, want.z], abs=1.0)


def test_step_history_one_sample_per_commit():
    s = SimulationService()
    assert s.history.page(None, 0, None, 10)["samples"][0]["positionsM"] == {}  # sample 0: the empty start
    two_bodies(s)  # two committed adds
    s.step(10.0)
    s.step(10.0)
    page = s.history.page(None, 0, None, 100)
    assert [x["index"] for x in page["samples"]] == [0, 1, 2, 3, 4]
    assert [len(x["positionsM"]) for x in page["samples"]] == [0, 1, 2, 2, 2]
    assert page["samples"][-1]["simulationTimeS"] == 20.0 and page["mode"] == "step"


def test_history_rolled_back_on_failed_step(monkeypatch):
    s = loaded_engine()
    s.step(2 * DAY)
    before = s.history.page(None, 0, None, 5000)
    monkeypatch.setattr(s, "_verify_finite", lambda: (_ for _ in ()).throw(ArithmeticError("boom")))
    with pytest.raises(Exception, match="rolled back"):
        s.step(3 * DAY)  # records grid samples 3, 4, 5 before failing
    assert s.history.page(None, 0, None, 5000) == before
    assert s._history.next_index == 3  # the working buffer was rolled back too
    monkeypatch.undo()
    s.step(3 * DAY)
    assert times(s) == [k * DAY for k in range(6)]  # the grid resumes with no duplicates and no gap


def test_readers_never_see_uncommitted_samples(monkeypatch):
    s = loaded_engine()
    seen = {}
    real = s._verify_finite

    def peek():
        seen["next"] = s.history.page(None, 0, None, 5000)["nextIndex"]
        real()

    monkeypatch.setattr(s, "_verify_finite", peek)
    s.step(3 * DAY)
    assert seen["next"] == 1  # mid-step the published history was still just sample 0
    assert s.history.page(None, 0, None, 5000)["nextIndex"] == 4


def test_history_in_snapshot_and_restored():
    s = loaded_engine()
    s.step(2 * DAY)
    snap = s.capture_snapshot()
    s.step(3 * DAY)
    assert len(times(s)) == 6
    s.restore_snapshot(snap)
    assert times(s) == [0.0, DAY, 2 * DAY]
    s.step(DAY)
    assert times(s)[-1] == 3 * DAY and len(times(s)) == 4


def test_history_generation_changes_on_reset_and_restore():
    s = loaded_engine()
    g0 = s.history.generation
    snap = s.capture_snapshot()
    assert s.history.generation == g0  # taking a snapshot does not touch live history
    s.step(DAY)
    s.restore_snapshot(snap)
    g1 = s.history.generation
    assert g1 != g0
    s.reset()
    g2 = s.history.generation
    assert g2 not in (g0, g1) and times(s) == [0.0]


def test_history_grid_truncates_at_cap():
    h = HistoryBuffer("grid", DAY, max_points=6)
    meta = {"a": {"name": "a", "colorHex": "#ffffff", "radiusM": 1.0, "kind": "planet"}}
    pos = [("a", 0.0, 0.0, 0.0), ("b", 1.0, 0.0, 0.0)]
    results = [h.record(k * DAY, pos, meta) for k in range(5)]
    h.commit()
    assert results == [True, True, True, False, False] and h.truncated and h.next_index == 3
    assert h.next_grid_time() is None
    page = h.page(None, 0, None, 100)
    assert page["truncated"] is True and len(page["samples"]) == 3 and page["droppedBefore"] == 0


def test_engine_keeps_integrating_after_grid_truncation():
    s = loaded_engine()
    s._history.max_points = 6
    s.step(10 * DAY)
    assert s.snapshot().simulationTimeS == 10 * DAY
    assert s.history.page(None, 0, None, 100)["truncated"] is True and len(times(s)) == 3


def test_history_step_ring_drops_oldest():
    h = HistoryBuffer("step", None, max_points=6)
    meta = {}
    for k in range(8):
        h.record(float(k), [("a", float(k), 0.0, 0.0), ("b", 0.0, float(k), 0.0)], meta)
        h.commit()
    page = h.page(None, 0, None, 100)
    assert page["droppedBefore"] == 5 and page["firstIndex"] == 5 and page["nextIndex"] == 8
    assert [s["index"] for s in page["samples"]] == [5, 6, 7]
    assert [s["simulationTimeS"] for s in page["samples"]] == [5.0, 6.0, 7.0]
    assert page["samples"][0]["positionsM"]["a"] == [5.0, 0.0, 0.0]


def test_history_segments_increment_on_edit_and_merger():
    s = SimulationService()
    a = s.add_body(make("A", m=1e10, r=1.0))
    s.add_body(make("B", m=1.0, r=1.0, x=(1e6, 0, 0)))
    s.step(1.0)
    seg = lambda: [x["segment"] for x in s.history.page(None, 0, None, 100)["samples"]]
    s.step(1.0)
    assert seg()[-1] == seg()[-2]  # a plain step keeps the segment
    from backend.models import BodyUpdate
    s.update_body(a.id, BodyUpdate(massKg=2e10))
    assert seg()[-1] == seg()[-2] + 1  # a physical edit starts a new segment
    s.update_body(a.id, BodyUpdate(name="renamed"))
    assert seg()[-1] == seg()[-2]  # a cosmetic edit does not
    c = SimulationService()
    c.add_body(make("P", m=1e12, r=100.0))
    c.add_body(make("Q", m=1e12, r=100.0, x=(1000.0, 0, 0), v=(-5.0, 0, 0)))
    c.step(1.0)
    c.step(200.0)  # collides and merges
    segs = [x["segment"] for x in c.history.page(None, 0, None, 100)["samples"]]
    assert segs[-1] > segs[-2]


def test_history_keeps_metadata_of_merged_bodies():
    c = SimulationService()
    p = c.add_body(make("P", m=2e12, r=100.0))
    q = c.add_body(make("Q", m=1e12, r=100.0, x=(1000.0, 0, 0), v=(-5.0, 0, 0)))
    c.step(1.0)
    c.step(200.0)
    assert [b.id for b in c.snapshot().bodies] == [p.id]
    bodies = c.history.page(None, 0, None, 100)["bodies"]
    assert q.id in bodies and bodies[q.id]["name"] == "Q" and bodies[q.id]["kind"] == "planet"
    assert set(bodies[p.id]) == {"name", "colorHex", "radiusM", "kind", "bodyType", "assetKey"}


def test_history_isolated_between_universes(registry):
    a = registry.create("A")
    b = registry.create("B")
    two_bodies(a.engine)
    a.engine.step(5.0)
    assert b.engine.history.page(None, 0, None, 100)["nextIndex"] == 1
    assert a.engine._history is not b.engine._history
    assert a.engine.history.page(None, 0, None, 100)["nextIndex"] == 4


# ---------- HTTP ----------
@pytest.fixture
def client():
    return TestClient(app)


def test_history_endpoint_generation_mismatch_returns_from_start(client, registry):
    engine = registry.get("uni-default").engine
    two_bodies(engine)
    engine.step(1.0)
    engine.step(1.0)
    page = client.get("/api/v1/universes/uni-default/history").json()
    assert page["firstIndex"] == 0 and page["nextIndex"] == 5 and page["mode"] == "step"
    gen = page["generation"]
    tail = client.get(f"/api/v1/universes/uni-default/history?generation={gen}&fromIndex=3").json()
    assert tail["firstIndex"] == 3 and [s["index"] for s in tail["samples"]] == [3, 4]
    wrong = client.get(f"/api/v1/universes/uni-default/history?generation={gen + 999}&fromIndex=3").json()
    assert wrong["firstIndex"] == 0 and wrong["generation"] == gen


def test_history_endpoint_filters_bodies_and_limits(client, registry):
    engine = registry.get("uni-default").engine
    two_bodies(engine)
    engine.step(1.0)
    bid = engine.snapshot().bodies[0].id
    page = client.get(f"/api/v1/universes/uni-default/history?bodyIds={bid}&limit=2").json()
    assert len(page["samples"]) == 2 and page["nextIndex"] == 2
    assert all(set(s["positionsM"]) <= {bid} for s in page["samples"]) and set(page["bodies"]) == {bid}
    assert client.get("/api/v1/universes/uni-default/history?limit=0").status_code == 422
    assert client.get("/api/v1/universes/uni-default/history?limit=5001").status_code == 422
    assert client.get("/api/v1/universes/uni-nope/history").status_code == 404
