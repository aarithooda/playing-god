"""Snapshots, initial-state reset, derived engines, controlled flag (plan sections 8, 11.3; M2)."""
import pytest
from fastapi.testclient import TestClient

from backend.errors import CodedError
from backend.main import app
from backend.models import BodyUpdate
from backend.simulation import ConflictError, SimulationService
from tests.helpers import DAY, dump, loaded_engine, make, sun_earth, two_bodies


def full_dump(engine):
    """State, revision and the complete committed history, exactly."""
    return dump(engine) + "|" + repr(engine.history.page(None, 0, None, 5000)["samples"])


def test_snapshot_restore_physical_state_exact():
    s = loaded_engine()
    s.step(3 * DAY)
    snap = s.capture_snapshot()
    state_at = s.snapshot().model_dump_json()
    s.step(40 * DAY)
    s.update_body("body-earth", BodyUpdate(massKg=1.0, name="Changed"))
    s.restore_snapshot(snap)
    assert s.snapshot().model_dump_json() == state_at  # bodies, ids, order, names, kinds, time, diagnostics


def test_snapshot_restore_bitwise_continuation():
    steps = [0.37 * DAY, 1.0 * DAY, 2.5 * DAY, 0.11 * DAY, 4.0 * DAY]
    s = loaded_engine()
    s.step(5.3 * DAY)
    snap = s.capture_snapshot()
    for dt in steps:
        s.step(dt)
    first = s.snapshot().model_dump_json(), s.history.page(None, 0, None, 5000)["samples"][-3:]
    s.restore_snapshot(snap)
    for dt in steps:
        s.step(dt)
    second = s.snapshot().model_dump_json(), s.history.page(None, 0, None, 5000)["samples"][-3:]
    assert first == second  # exact equality: positions, velocities, time, diagnostics, recorded samples


def test_taking_a_snapshot_does_not_perturb_the_run():
    a, b = loaded_engine(), loaded_engine()
    a.step(2 * DAY)
    b.step(2 * DAY)
    a.capture_snapshot()
    a.step(7 * DAY)
    b.step(7 * DAY)
    assert a.snapshot().model_dump_json() == b.snapshot().model_dump_json()


def test_restore_preserves_engine_configuration():
    s = loaded_engine()
    snap = s.capture_snapshot()
    s.step(DAY)
    s.restore_snapshot(snap)
    sim = s._sim
    assert sim.G == 6.67430e-11 and str(sim.integrator) == "ias15" and sim.integrator.adaptive_mode.lower() == "global"
    assert sim.collision == "line" and sim.rand_seed == 12345
    c = SimulationService()  # the merger layer still works after a restore (callbacks were re-registered)
    c.add_body(make("P", m=2e12, r=100.0))
    c.add_body(make("Q", m=1e12, r=100.0, x=(1000.0, 0, 0), v=(-5.0, 0, 0)))
    snap2 = c.capture_snapshot()
    c.restore_snapshot(snap2)
    r = c.step(300.0)
    assert [e.type for e in r.events] == ["merger"] and len(r.bodies) == 1


def test_event_ids_not_reused_after_restore():
    c = SimulationService()
    c.add_body(make("P", m=2e12, r=100.0))
    c.add_body(make("Q", m=1e12, r=100.0, x=(1000.0, 0, 0), v=(-5.0, 0, 0)))
    snap = c.capture_snapshot()
    first = c.step(300.0).events[0].id
    c.restore_snapshot(snap)
    assert c.events() == []
    second = c.step(300.0).events[0].id
    assert first != second


def test_failed_restore_leaves_state(monkeypatch):
    s = loaded_engine()
    snap = s.capture_snapshot()
    s.step(2 * DAY)
    before = full_dump(s)
    monkeypatch.setattr(SimulationService, "_adopt_history", lambda self, *a, **k: (_ for _ in ()).throw(
        RuntimeError("disk on fire")))
    with pytest.raises(CodedError) as e:
        s.restore_snapshot(snap)
    assert e.value.status == 500 and e.value.code == "restore_failed"
    assert full_dump(s).split("|rev=")[0] == before.split("|rev=")[0]
    assert s.last_failure["kind"] == "restore_failed"
    monkeypatch.undo()
    s.step(DAY)  # still usable


def test_snapshot_of_one_universe_cannot_restore_another():
    a, b = loaded_engine(), loaded_engine()
    snap = a.capture_snapshot()
    before = full_dump(b)
    with pytest.raises(ConflictError, match="another universe"):
        b.restore_snapshot(snap)
    assert full_dump(b) == before


def test_reset_restores_initial_snapshot_only_target(registry):
    a = registry.create("A", activate=True)
    a.engine.load_bodies(sun_earth(), history_mode="grid", sample_interval_s=DAY)
    b = registry.create("B")
    b.engine.load_bodies(sun_earth(), history_mode="grid", sample_interval_s=DAY)
    initial_a = a.engine.snapshot().model_dump_json()
    a.engine.step(5 * DAY)
    b.engine.step(5 * DAY)
    b_before = full_dump(b.engine)
    a.engine.reset(guard=registry.guard_for(a.id, registry.epoch))
    assert a.engine.snapshot().model_dump_json() == initial_a
    assert a.engine.history.page(None, 0, None, 100)["nextIndex"] == 1
    assert full_dump(b.engine) == b_before


def test_reset_default_sandbox_is_empty_like_before():
    s = SimulationService()
    two_bodies(s)
    s.step(10.0)
    state = s.reset()
    assert state.bodies == [] and state.simulationTimeS == 0.0 and s.events() == []


def test_load_bodies_sets_revision_and_initial_state():
    s = loaded_engine()
    assert s.revision == 1 and [b.id for b in s.snapshot().bodies] == ["body-sun", "body-earth"]
    assert s.snapshot().bodies[1].kind == "planet" and s.snapshot().bodies[0].kind == "star"
    with pytest.raises(ConflictError):
        s.load_bodies(sun_earth(), history_mode="grid", sample_interval_s=DAY)  # only into an empty, unstarted engine


def test_derived_engine_shares_no_mutable_objects():
    src = loaded_engine()
    src.step(DAY)
    snap = src.capture_snapshot()
    before = full_dump(src)
    derived = SimulationService.from_snapshot(snap, history_mode="step")
    for attr in ("_sim", "_resolver", "_meta", "_events", "_history", "_initial"):
        assert getattr(derived, attr) is not getattr(src, attr)
    assert derived._sim is not snap.sim and derived._history is not snap.history
    derived.step(20 * DAY)
    derived.update_body("body-earth", BodyUpdate(massKg=5.0))
    assert full_dump(src) == before
    src.step(DAY)
    assert derived.snapshot().bodies[1].massKg == 5.0  # and the other way round


def test_from_snapshot_transform_changes_only_what_it_touches():
    src = loaded_engine()
    base = src.initial_snapshot

    def scale(sim):
        for p in sim.particles:
            if p.name == "body-earth":
                p.vx, p.vy, p.vz = 1.1 * p.vx, 1.1 * p.vy, 1.1 * p.vz

    d = SimulationService.from_snapshot(base, transform=scale, history_mode="grid", sample_interval_s=DAY)
    a, b = src.snapshot().bodies, d.snapshot().bodies
    assert a[0] == b[0] and a[1].positionM == b[1].positionM
    assert b[1].velocityMPerS.y == 1.1 * a[1].velocityMPerS.y
    assert d.initial_state_digest != src.initial_state_digest
    assert d.history.page(None, 0, None, 10)["nextIndex"] == 1  # its own sample 0


def test_initial_state_digest_is_stable_and_ignores_colour():
    a, b = loaded_engine(), loaded_engine()
    assert a.initial_state_digest == b.initial_state_digest and len(a.initial_state_digest) == 64
    a.step(DAY)
    assert a.initial_state_digest == b.initial_state_digest  # about the initial state, not the current one
    recolour = sun_earth()
    recolour[1].colorHex = "#000000"
    assert loaded_engine(bodies=recolour).initial_state_digest == a.initial_state_digest
    heavier = sun_earth(earth_mass=6.0e24)
    assert loaded_engine(bodies=heavier).initial_state_digest != a.initial_state_digest
    assert loaded_engine(interval=2 * DAY).initial_state_digest != a.initial_state_digest


# ---------- controlled flag and audit (used by Orbit Lab's modified run) ----------
def modified_engine():
    s = loaded_engine()
    s.audit_edits = True
    return s


def test_modified_edit_marks_uncontrolled_and_reset_restores_controlled():
    s = modified_engine()
    s.step(2 * DAY)
    assert s.controlled is True and s.first_uncontrolled_at_s is None
    s.update_body("body-earth", BodyUpdate(massKg=7.0e24))
    assert s.controlled is False and s.first_uncontrolled_at_s == 2 * DAY
    entry = s.audit[-1]
    assert entry["op"] == "update" and entry["bodyId"] == "body-earth" and entry["physical"] is True
    assert entry["changes"]["massKg"] == [5.972e24, 7.0e24] and entry["atSimulationTimeS"] == 2 * DAY
    s.reset()
    assert s.controlled is True and s.first_uncontrolled_at_s is None
    assert len(s.audit) == 1  # the audit record of the earlier change is kept


def test_cosmetic_edit_keeps_controlled():
    s = modified_engine()
    s.update_body("body-earth", BodyUpdate(name="Home", colorHex="#ffffff", kind="star"))
    assert s.controlled is True and s.audit[-1]["physical"] is False


def test_add_and_delete_are_physical_and_audited():
    s = modified_engine()
    s.add_body(make("Probe", x=(3e11, 0, 0)))
    assert s.controlled is False and s.audit[-1]["op"] == "add"
    t = modified_engine()
    t.delete_body("body-earth")
    assert t.controlled is False and t.audit[-1]["op"] == "delete"


def test_untracked_engines_do_not_audit():
    s = loaded_engine()
    s.update_body("body-earth", BodyUpdate(massKg=7.0e24))
    assert s.controlled is True and s.audit == []


def test_snapshot_carries_controlled_flag():
    s = modified_engine()
    good = s.capture_snapshot()
    s.update_body("body-earth", BodyUpdate(massKg=7.0e24))
    bad = s.capture_snapshot()
    assert good.controlled is True and bad.controlled is False
    s.restore_snapshot(good)
    assert s.controlled is True
    s.restore_snapshot(bad)
    assert s.controlled is False and s.first_uncontrolled_at_s == 0.0
    assert len(s.audit) == 1  # restoring never rewrites the audit log


# ---------- HTTP ----------
@pytest.fixture
def client():
    return TestClient(app)


def test_snapshot_endpoints_roundtrip(client, registry):
    engine = registry.get("uni-default").engine
    two_bodies(engine)
    q = "?activationEpoch=1"
    s1 = client.post(f"/api/v1/universes/uni-default/snapshots{q}", json={"name": "before"})
    assert s1.status_code == 201
    j = s1.json()
    assert j["name"] == "before" and j["simulationTimeS"] == 0.0 and j["bodyCount"] == 2 and j["controlled"] is True
    client.post(f"/api/v1/universes/uni-default/step{q}", json={"dtS": 50.0})
    listed = client.get("/api/v1/universes/uni-default/snapshots").json()["snapshots"]
    assert [x["id"] for x in listed] == [j["id"]]
    r = client.post(f"/api/v1/universes/uni-default/snapshots/{j['id']}/restore{q}")
    assert r.status_code == 200 and r.json()["simulationTimeS"] == 0.0 and r.json()["revision"] == 4
    assert client.delete(f"/api/v1/universes/uni-default/snapshots/{j['id']}{q}").status_code == 204
    assert client.get("/api/v1/universes/uni-default/snapshots").json()["snapshots"] == []
    gone = client.post(f"/api/v1/universes/uni-default/snapshots/{j['id']}/restore{q}")
    assert gone.status_code == 404 and gone.json()["code"] == "snapshot_not_found"


def test_snapshot_limit_and_epoch(client):
    q = "?activationEpoch=1"
    for _ in range(10):
        assert client.post(f"/api/v1/universes/uni-default/snapshots{q}", json={}).status_code == 201
    r = client.post(f"/api/v1/universes/uni-default/snapshots{q}", json={})
    assert r.status_code == 409 and r.json()["code"] == "snapshot_limit"
    assert client.post("/api/v1/universes/uni-default/snapshots?activationEpoch=9", json={}).status_code == 409
    assert client.post("/api/v1/universes/uni-default/snapshots", json={}).status_code == 422


def test_restore_in_one_universe_leaves_the_other(client, registry):
    other = registry.create("other")
    two_bodies(other.engine)
    other.engine.step(9.0)
    before = dump(other.engine)
    engine = registry.get("uni-default").engine
    two_bodies(engine)
    q = "?activationEpoch=1"
    sid = client.post(f"/api/v1/universes/uni-default/snapshots{q}", json={}).json()["id"]
    client.post(f"/api/v1/universes/uni-default/step{q}", json={"dtS": 5.0})
    client.post(f"/api/v1/universes/uni-default/snapshots/{sid}/restore{q}")
    assert dump(other.engine) == before
