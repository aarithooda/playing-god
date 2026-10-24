"""Races between switching universes and in-flight work (plan section 7.2)."""
import threading

import pytest

from backend.errors import CodedError, StepCancelled
from backend.models import BodyUpdate
from backend.simulation import SimulationBusyError
from backend.universes import DEFAULT_UNIVERSE_ID
from tests.helpers import BlockedStep, dump, make, two_bodies


def setup_universe(registry, name="A"):
    u = registry.create(name, activate=True)
    two_bodies(u.engine)
    u.engine.lock_wait_s = 0.2
    return u


def test_switch_during_step_rolls_back_outgoing_step(registry, monkeypatch):
    a = setup_universe(registry)
    before = dump(a.engine)
    step = BlockedStep(a.engine, monkeypatch)
    step.run(100.0, guard=registry.guard_for(a.id, registry.epoch))
    registry.activate(DEFAULT_UNIVERSE_ID)  # returns immediately, never waits for A
    step.finish()
    assert isinstance(step.error, StepCancelled) and step.error.code == "deactivated_during_step"
    assert dump(a.engine) == before
    assert a.engine.last_failure["kind"] == "deactivated_during_step"


def test_aba_switch_rejects_old_epoch(registry, monkeypatch):
    a = setup_universe(registry)
    before = dump(a.engine)
    step = BlockedStep(a.engine, monkeypatch)
    step.run(100.0, guard=registry.guard_for(a.id, registry.epoch))
    registry.activate(DEFAULT_UNIVERSE_ID)
    registry.activate(a.id)  # A is active again, but under a new epoch
    step.finish()
    assert isinstance(step.error, CodedError) and step.error.code == "deactivated_during_step"
    assert dump(a.engine) == before  # the old request never committed


def test_concurrent_steps_serialized(registry):
    a = setup_universe(registry)
    a.engine.lock_wait_s = 30.0
    errors = []

    def go():
        try:
            a.engine.step(10.0, guard=registry.guard_for(a.id, registry.epoch))
        except BaseException as e:  # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in threads]
    [t.join(timeout=60) for t in threads]
    assert not errors
    assert a.engine.snapshot().simulationTimeS == pytest.approx(60.0)
    assert a.engine.revision == 2 + 6


def test_stuck_universe_does_not_block_other_universe(registry, monkeypatch):
    a = setup_universe(registry)
    b = registry.create("B")
    two_bodies(b.engine)
    step = BlockedStep(a.engine, monkeypatch, advance_time=False)
    step.run(100.0, guard=registry.guard_for(a.id, registry.epoch))
    try:
        registry.activate(b.id)
        b.engine.step(25.0, guard=registry.guard_for(b.id, registry.epoch))
        assert b.engine.snapshot().simulationTimeS == 25.0
        registry.activate(DEFAULT_UNIVERSE_ID)
    finally:
        step.finish()
    assert a.engine.snapshot().simulationTimeS == 0.0


def test_reset_waits_or_busy_during_step(registry, monkeypatch):
    a = setup_universe(registry)
    step = BlockedStep(a.engine, monkeypatch)
    step.run(100.0, guard=registry.guard_for(a.id, registry.epoch))
    try:
        with pytest.raises(SimulationBusyError):
            a.engine.reset(guard=registry.guard_for(a.id, registry.epoch))
    finally:
        step.finish()
    assert step.error is None and len(a.engine.snapshot().bodies) == 2


def test_edit_between_steps_is_atomic(registry, monkeypatch):
    a = setup_universe(registry)
    body_id = a.engine.snapshot().bodies[1].id
    step = BlockedStep(a.engine, monkeypatch)
    step.run(100.0, guard=registry.guard_for(a.id, registry.epoch))
    try:
        with pytest.raises(SimulationBusyError):  # never applied halfway through a step
            a.engine.update_body(body_id, BodyUpdate(massKg=9.0), guard=registry.guard_for(a.id, registry.epoch))
    finally:
        step.finish()
    assert a.engine.snapshot().simulationTimeS == pytest.approx(100.0)
    a.engine.update_body(body_id, BodyUpdate(massKg=9.0), guard=registry.guard_for(a.id, registry.epoch))
    assert a.engine.snapshot().bodies[1].massKg == 9.0
    assert a.engine.snapshot().simulationTimeS == pytest.approx(100.0)  # the edit moved no time


def test_crud_rolled_back_when_deactivated_before_commit(registry):
    a = setup_universe(registry)
    before = dump(a.engine)
    state = {"calls": 0}
    inner = registry.guard_for(a.id, registry.epoch)

    def guard():  # valid on entry, invalid at commit: the switch happens in between
        state["calls"] += 1
        if state["calls"] >= 2:
            registry.activate(DEFAULT_UNIVERSE_ID)
        inner()

    with pytest.raises(CodedError):
        a.engine.add_body(make("late", x=(9e6, 0, 0)), guard=guard)
    assert dump(a.engine) == before
