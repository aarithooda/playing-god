"""Universe isolation, lifecycle and epoch-guarded mutation at the registry/engine level (no HTTP)."""
import pytest

from backend.errors import CodedError, StepCancelled
from backend.models import BodyUpdate
from backend.simulation import ConflictError, SimulationService
from backend.universes import DEFAULT_UNIVERSE_ID, MAX_UNIVERSES, get_legacy_guard
from tests.helpers import dump, make, two_bodies


def new_universe(reg, name="U", activate=False):
    u = reg.create(name, activate=activate)
    two_bodies(u.engine)
    return u


def test_default_universe_is_active_with_epoch_one(registry):
    assert registry.active_id == DEFAULT_UNIVERSE_ID and registry.epoch == 1
    u = registry.get(DEFAULT_UNIVERSE_ID)
    assert u.role == "sandbox" and u.engine.snapshot().bodies == []


def test_two_universes_hold_different_states(registry):
    a = new_universe(registry, "A")
    b = registry.create("B")
    b.engine.add_body(make("only-b", m=5.0, x=(3.0, 0, 0)))
    assert a.engine is not b.engine
    assert a.engine._sim is not b.engine._sim
    assert a.engine._resolver is not b.engine._resolver
    assert a.engine._meta is not b.engine._meta
    assert a.engine._events is not b.engine._events
    assert [x.name for x in a.engine.snapshot().bodies] == ["A", "B"]
    assert [x.name for x in b.engine.snapshot().bodies] == ["only-b"]
    assert {x.id for x in a.engine.snapshot().bodies}.isdisjoint({x.id for x in b.engine.snapshot().bodies})


def test_step_active_leaves_other_bitwise_unchanged(registry):
    a = new_universe(registry, "A", activate=True)
    b = new_universe(registry, "B")
    before_b = dump(b.engine)
    for _ in range(3):
        a.engine.step(500.0, guard=registry.guard_for(a.id, registry.epoch))
    assert a.engine.snapshot().simulationTimeS == pytest.approx(1500.0)
    assert dump(b.engine) == before_b


def test_return_resumes_exact_instant(registry):
    a = new_universe(registry, "A", activate=True)
    a.engine.step(777.0, guard=registry.guard_for(a.id, registry.epoch))
    left = dump(a.engine)
    registry.activate(DEFAULT_UNIVERSE_ID)
    registry.activate(a.id)
    assert dump(a.engine) == left


def test_activation_does_no_integration(registry):
    a = new_universe(registry, "A", activate=True)
    a.engine.step(100.0, guard=registry.guard_for(a.id, registry.epoch))
    snap = dump(a.engine)
    registry.activate(DEFAULT_UNIVERSE_ID)
    assert dump(a.engine) == snap and a.engine.snapshot().simulationTimeS == 100.0


@pytest.mark.parametrize("op", ["add", "update", "delete", "step", "reset"])
def test_mutation_on_inactive_universe_rejected(registry, op):
    a = new_universe(registry, "A", activate=True)
    epoch = registry.epoch
    guard = registry.guard_for(a.id, epoch)  # valid while A is active ...
    registry.activate(DEFAULT_UNIVERSE_ID)  # ... and invalid once it is not
    before = dump(a.engine)
    body_id = a.engine.snapshot().bodies[0].id
    with pytest.raises(CodedError) as e:
        {"add": lambda: a.engine.add_body(make("x", x=(9e6, 0, 0)), guard=guard),
         "update": lambda: a.engine.update_body(body_id, BodyUpdate(massKg=3.0), guard=guard),
         "delete": lambda: a.engine.delete_body(body_id, guard=guard),
         "step": lambda: a.engine.step(10.0, guard=guard),
         "reset": lambda: a.engine.reset(guard=guard)}[op]()
    assert e.value.status == 409 and e.value.code in ("universe_not_active", "stale_activation")
    assert dump(a.engine) == before
    with pytest.raises(CodedError):  # a new guard for the inactive universe is refused at once
        registry.guard_for(a.id, epoch)


def test_stale_epoch_rejected(registry):
    a = new_universe(registry, "A", activate=True)
    old = registry.epoch
    registry.activate(DEFAULT_UNIVERSE_ID)
    registry.activate(a.id)
    with pytest.raises(CodedError) as e:
        registry.guard_for(a.id, old)
    assert e.value.code == "stale_activation" and e.value.status == 409


def test_unknown_universe_is_404_and_deleted_says_so(registry):
    with pytest.raises(CodedError) as e:
        registry.get("uni-nope")
    assert e.value.status == 404 and e.value.code == "universe_not_found"
    u = registry.create("tmp")
    registry.delete(u.id)
    with pytest.raises(CodedError) as e2:
        registry.get(u.id)
    assert e2.value.status == 404 and "deleted" in e2.value.detail


def test_delete_active_rejected(registry):
    with pytest.raises(CodedError) as e:
        registry.delete(DEFAULT_UNIVERSE_ID)
    assert e.value.status == 409 and e.value.code == "active_universe_delete"


def test_deleted_universe_blocks_straggler_commits(registry):
    a = registry.create("A", activate=True)
    two_bodies(a.engine)
    guard = registry.guard_for(a.id, registry.epoch)
    registry.activate(DEFAULT_UNIVERSE_ID)
    registry.delete(a.id)
    with pytest.raises(CodedError):
        guard()


def test_universe_limit(registry):
    for i in range(MAX_UNIVERSES - 1):
        registry.create(f"u{i}")
    with pytest.raises(CodedError) as e:
        registry.create("one too many")
    assert e.value.status == 409 and e.value.code == "universe_limit"
    assert len(registry.list()) == MAX_UNIVERSES


def test_name_is_validated(registry):
    for bad in ("", "x" * 65):
        with pytest.raises(ConflictError):
            registry.create(bad)


def test_expected_revision_rejects_duplicate(registry):
    a = new_universe(registry, "A", activate=True)
    rev = a.engine.revision
    a.engine.step(10.0, guard=registry.guard_for(a.id, registry.epoch, rev))
    assert a.engine.revision == rev + 1
    with pytest.raises(CodedError) as e:
        registry.guard_for(a.id, registry.epoch, rev)
    assert e.value.status == 409 and e.value.code == "stale_revision"
    assert a.engine.snapshot().simulationTimeS == 10.0


def test_revision_counts_committed_changes_only():
    s = SimulationService()
    assert s.revision == 0
    s.add_body(make("A"))
    s.add_body(make("B", x=(1e6, 0, 0)))
    s.step(1.0)
    with pytest.raises(ConflictError):
        s.add_body(make("C", x=(0.5, 0, 0)))  # overlaps A
    assert s.revision == 3


def test_last_failure_recorded_and_cleared(monkeypatch):
    s = SimulationService()
    two_bodies(s)

    def boom(target):
        raise RuntimeError("engine blew up")

    real = s._advance
    monkeypatch.setattr(s, "_advance", boom)
    with pytest.raises(Exception, match="rolled back"):
        s.step(5.0)
    assert s.last_failure["kind"] == "step_failed" and s.last_failure["atSimulationTimeS"] == 0.0
    monkeypatch.setattr(s, "_advance", real)
    s.step(5.0)
    assert s.last_failure is None


def test_body_kind_defaults_and_roundtrip():
    s = SimulationService()
    b = s.add_body(make("plain"))
    assert b.kind == "planet" and b.catalogueEntryId is None
    star = s.add_body(make("sun", x=(1e6, 0, 0), kind="star", catalogueEntryId="sun"))
    assert star.kind == "star" and star.catalogueEntryId == "sun"
    assert s.update_body(b.id, BodyUpdate(kind="star")).kind == "star"
    assert {x.id: x.kind for x in s.snapshot().bodies} == {b.id: "star", star.id: "star"}


def test_legacy_guard_targets_default_and_refuses_when_inactive(registry):
    get_legacy_guard()()  # default is active: passes
    other = registry.create("other")
    registry.activate(other.id)
    with pytest.raises(CodedError) as e:
        get_legacy_guard()
    assert e.value.code == "universe_not_active"


def test_step_cancelled_error_is_the_coded_409():
    assert StepCancelled.status == 409 and StepCancelled.code == "deactivated_during_step"
