"""Stage 1: contact detection and deferred resolution inside the service (backend/impact/detection.py, engine.py,
backend/simulation.py).

Covers: the recorder callback, resolution order, stale pairs, mode defaults, one contact -> one record, pause/resume and
time-scale equivalence, transactional rollback (state byte-identical after an injected failure), records in every state path
(rollback, snapshot restore, reset, derive) and the degraded-detection flag.
"""
import math
from types import SimpleNamespace

import pytest

import backend.simulation as simulation
from backend.impact.config import CollisionConfig
from backend.impact.detection import ContactCandidate, ContactRecorder, order_key
from backend.impact.records import MAX_COLLISION_RECORDS, record_id, trim
from backend.simulation import SimulationFailure, SimulationService
from tests.helpers import dump
from tests.impact import legacy_scenarios as ls


def deferred() -> SimulationService:
    return SimulationService(CollisionConfig(mode="outcome-v1"))


def loaded(name, factory=deferred):
    bodies, steps = ls.SCENARIOS[name]()
    svc = factory()
    svc.load_bodies(bodies, history_mode="step")
    return svc, steps


# ---------------------------------------------------------------------------------------------------------------
# The recorder (the REBOUND callback of mode "outcome-v1")
# ---------------------------------------------------------------------------------------------------------------
class FakeSim:
    def __init__(self, names, t=3.0, dt_last=0.25, dt=0.5):
        self.N = len(names)
        self.particles = [SimpleNamespace(name=n) for n in names]
        self.t, self.dt_last_done, self.dt = t, dt_last, dt
        self.stopped = 0

    def stop(self):
        self.stopped += 1


def call(recorder, sim, p1, p2):
    return recorder.resolve(SimpleNamespace(contents=sim), SimpleNamespace(p1=p1, p2=p2))


def test_recorder_records_the_pair_stops_integration_and_keeps_both_bodies():
    rec, sim = ContactRecorder(), FakeSim(["a", "b", "c"])
    assert call(rec, sim, 0, 2) == 0  # 0 = remove nothing: the callback never changes particles
    assert sim.stopped == 1
    assert rec.pending == [ContactCandidate("a", "c", 3.0, 0.25, 0.5)]
    assert rec.callbacks == 1 and rec.stale == 0 and rec.errors == []


def test_recorder_counts_stale_indices_and_self_pairs_without_stopping():
    rec, sim = ContactRecorder(), FakeSim(["a", "b"])
    assert call(rec, sim, 0, 5) == 0 and call(rec, sim, 1, 1) == 0
    assert rec.stale == 2 and rec.pending == [] and sim.stopped == 0


def test_recorder_surfaces_exceptions_instead_of_letting_ctypes_swallow_them():
    rec = ContactRecorder()
    assert rec.resolve(SimpleNamespace(contents=None), SimpleNamespace(p1=0, p2=1)) == 0
    assert len(rec.errors) == 1 and "AttributeError" in rec.errors[0]


def test_take_returns_each_pair_once_in_report_order_and_drains():
    rec, sim = ContactRecorder(), FakeSim(["a", "b", "c", "d"])
    for p1, p2 in [(2, 3), (0, 1), (3, 2), (0, 1)]:
        call(rec, sim, p1, p2)
    assert [(c.first_id, c.second_id) for c in rec.take()] == [("c", "d"), ("a", "b")]
    assert rec.take() == []


def test_order_key_is_contact_time_then_sorted_ids():
    c = lambda a, b, t=5.0: ContactCandidate(a, b, t, 0.1, 0.1)  # noqa: E731
    assert order_key(c("z", "a"), 4.0) == (4.0, "a", "z")
    assert order_key(c("z", "a"), None) == (5.0, "a", "z")  # no estimate: the detection time
    keys = sorted([order_key(c("b", "c"), 4.0), order_key(c("a", "d"), 4.0), order_key(c("e", "f"), 3.0)])
    assert [k[1:] for k in keys] == [("e", "f"), ("a", "d"), ("b", "c")]


# ---------------------------------------------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------------------------------------------
def test_every_universe_defaults_to_legacy_merge_and_records_nothing():
    """D-033: the mode default is flipped only by Stage 4 step 4b. Until then no universe uses the new path."""
    from backend import universes

    assert SimulationService().collision_config.mode == "legacy-merge"
    registry = universes.get_registry()
    assert registry.get(universes.DEFAULT_UNIVERSE_ID).engine.collision_config.mode == "legacy-merge"
    svc, steps = loaded("probe_heavy_created_first", factory=SimulationService)
    svc.step(steps[0])
    assert len(svc.events()) == 1 and svc.collision_records() == []  # legacy resolver: no records, same events as before


def test_mode_is_fixed_by_the_constructor_and_survives_derivation_defaults():
    svc = deferred()
    assert svc.collision_config.mode == "outcome-v1" and svc._deferred
    svc.load_bodies([ls.body("a", 1.0, 1.0)], history_mode="step")
    derived = SimulationService.from_snapshot(svc.capture_snapshot(), history_mode="step")
    assert derived.collision_config.mode == "legacy-merge"  # Orbit Lab runs stay legacy until Stage 11 (D-033)
    explicit = SimulationService.from_snapshot(svc.capture_snapshot(), history_mode="step", collision_config=CollisionConfig(mode="outcome-v1"))
    assert explicit.collision_config.mode == "outcome-v1"


def test_the_callback_is_registered_per_mode_and_again_after_a_rolled_back_step():
    legacy = SimulationService()
    assert legacy._collision_callback() == legacy._resolver.resolve
    svc, steps = loaded("probe_heavy_created_first")
    assert svc._collision_callback() == svc._recorder.resolve
    original = svc._collision_engine.resolve_batch

    def boom(*a, **k):
        raise RuntimeError("injected")

    svc._collision_engine.resolve_batch = boom
    with pytest.raises(SimulationFailure):
        svc.step(steps[0])
    svc._collision_engine.resolve_batch = original
    assert len(svc.step(steps[0]).events) == 1  # the rebuilt engine records and resolves again


# ---------------------------------------------------------------------------------------------------------------
# One contact -> one record; identity
# ---------------------------------------------------------------------------------------------------------------
# scenario -> number of physical contacts: n - 1 for a body collapsing into one remnant, 5 for five independent pairs
CONTACTS = {"ring4": 3, "ring6": 5, "ring12": 11, "homologous10": 9, "five_pairs": 5, "four_chain": 3}


@pytest.mark.parametrize("name", list(CONTACTS))
def test_each_contact_gives_exactly_one_event_and_one_linked_record(name):
    svc, steps = loaded(name)
    for dt in steps:
        svc.step(dt)
    events, records = svc.events(), svc.collision_records()
    assert len(events) == len(records) == CONTACTS[name]
    assert [r.event_id for r in records] == [record_id(int(e.id.split("-")[1])) for e in events]
    assert [r.legacy_event_id for r in records] == [e.id for e in events]
    assert len({r.event_id for r in records}) == len(records)
    absorbed = [e.bodyIds[1] for e in events]
    assert len(set(absorbed)) == len(absorbed)  # a body is absorbed once, never twice
    assert svc.step(50.0).events == []  # no pending contact is left behind


def test_event_ids_continue_after_a_rolled_back_step_and_are_never_reused():
    svc, steps = loaded("ring4")
    boom_after = {"n": 0}
    real = svc._record_merge

    def flaky(ev):
        boom_after["n"] += 1
        if boom_after["n"] == 2:
            raise RuntimeError("injected after the first merge was applied")
        real(ev)

    svc._record_merge = flaky  # the service hands `self._record_merge` to the engine at every batch
    before = dump(svc)
    with pytest.raises(SimulationFailure):
        svc.step(steps[0])
    assert dump(svc) == before and svc.collision_records() == [] and svc.events() == []
    svc._record_merge = real
    svc.step(steps[0])
    assert [e.id for e in svc.events()] == ["evt-1", "evt-2", "evt-3"]  # numbers given back by the rolled-back step
    assert [r.event_id for r in svc.collision_records()] == ["col-1", "col-2", "col-3"]


# ---------------------------------------------------------------------------------------------------------------
# Pause / resume / time scale
# ---------------------------------------------------------------------------------------------------------------
def run_in_steps(factory, name, dts):
    svc, _ = loaded(name, factory)
    for dt in dts:
        svc.step(dt)
    return svc


def assert_same_physical_event(a, b, tolerance_s):
    assert a.bodyIds == b.bodyIds and a.resultMassKg == b.resultMassKg
    assert abs(a.estimatedContactTimeS - b.estimatedContactTimeS) <= tolerance_s
    assert a.relativeSpeedMPerS == pytest.approx(b.relativeSpeedMPerS, rel=1e-3)


@pytest.mark.parametrize("factory", [deferred, SimulationService], ids=["outcome-v1", "legacy-merge"])
def test_pause_and_resume_do_not_change_the_event(factory):
    """Detection happens only inside `step`: a pause is no step, a resume is the next step. Two halves = one whole, within
    the documented contact-time tolerance 0.02 R / v (the straight-line estimate inside one internal step)."""
    whole = run_in_steps(factory, "probe_heavy_created_first", [2.0])
    halves = run_in_steps(factory, "probe_heavy_created_first", [0.3, 0.5, 1.2])  # the contact (t ~ 0.63 s) is in the 2nd part
    assert len(whole.events()) == len(halves.events()) == 1
    assert_same_physical_event(whole.events()[0], halves.events()[0], 0.02 * 10.5 / 300.0)
    # paused: nothing happens without a step
    state = halves.snapshot()
    assert halves.snapshot() == state and len(halves.events()) == 1


@pytest.mark.parametrize("factory", [deferred, SimulationService], ids=["outcome-v1", "legacy-merge"])
def test_time_scale_does_not_change_the_event(factory):
    """The same total time as 2 requests of 1e5 s or 2000 of 1e2 s (a far, slow approach): same event within tolerance."""
    big, speed, gap = 1.0e22, 1.0e4, 1.0e8
    bodies = [ls.body("heavy", big, 1.0e5), ls.body("light", 1.0e9, 1.0e4, (gap, 0.0, 0.0), (-speed, 0.0, 0.0))]

    def run(dt, count):
        svc = factory()
        svc.load_bodies(bodies, history_mode="step")
        for _ in range(count):
            svc.step(dt)
        return svc

    coarse, fine = run(1.0e5, 2), run(1.0e2, 2000)
    assert len(coarse.events()) == len(fine.events()) == 1
    assert_same_physical_event(coarse.events()[0], fine.events()[0], 2 * 0.02 * 1.1e5 / speed)


# ---------------------------------------------------------------------------------------------------------------
# Transactions: a failure anywhere in resolution leaves the state byte-identical
# ---------------------------------------------------------------------------------------------------------------
def test_failure_inside_the_resolver_rolls_the_whole_step_back():
    svc, steps = loaded("five_pairs")
    before = dump(svc)
    calls = {"n": 0}
    real = svc._collision_engine.resolve_batch

    def partial_then_fail(*args, **kwargs):
        calls["n"] += 1
        real(*args, **kwargs)  # the batch is fully applied ...
        raise RuntimeError("injected after the merges were applied")  # ... and then the step fails

    svc._collision_engine.resolve_batch = partial_then_fail
    with pytest.raises(SimulationFailure):
        svc.step(steps[0])
    assert calls["n"] == 1
    assert dump(svc) == before and svc.events() == [] and svc.collision_records() == []
    assert svc.last_failure is not None and svc.last_failure["kind"] == "step_failed"
    svc._collision_engine.resolve_batch = real
    out = svc.step(steps[0])
    assert len(out.events) == 5 and len(svc.collision_records()) == 5


def test_a_recorder_error_fails_the_step_instead_of_being_ignored():
    svc, steps = loaded("probe_heavy_created_first")
    before = dump(svc)
    real = svc._recorder.resolve

    def broken(sim_ptr, col):
        svc._recorder.errors.append("injected callback error")
        sim_ptr.contents.stop()
        return 0

    svc._sim.collision_resolve = broken
    with pytest.raises(SimulationFailure, match="contact detection failed"):
        svc.step(steps[0])
    assert dump(svc) == before
    svc._sim.collision_resolve = real


def test_stale_pairs_are_dropped_and_counted_without_changing_anything():
    svc, _ = loaded("probe_heavy_created_first")
    stale = [ContactCandidate("ghost", "heavy", 1.0, 0.1, 0.1)]
    before = dump(svc)
    report = svc._collision_engine.resolve_batch(svc._sim, stale, ledger=svc._resolver, on_merge=svc._record_merge,
                                                 event_seq=lambda: svc._event_seq, chunk_criterion_satisfied=True)
    assert report.stale == 1 and report.resolved == 0 and report.records == []
    assert dump(svc) == before


# ---------------------------------------------------------------------------------------------------------------
# Records travel with the state on every path
# ---------------------------------------------------------------------------------------------------------------
def test_records_follow_snapshot_restore_reset_and_checkpoint_rollback():
    svc, steps = loaded("probe_heavy_created_first")
    snap = svc.capture_snapshot()  # before the collision
    svc.step(steps[0])
    assert len(svc.collision_records()) == 1
    after = svc.capture_snapshot()
    svc.restore_snapshot(snap)
    assert svc.collision_records() == [] and svc.events() == []
    svc.restore_snapshot(after)
    assert len(svc.collision_records()) == 1 and svc.collision_records()[0].event_id == "col-1"
    svc.reset()
    assert svc.collision_records() == []
    svc.step(steps[0])  # event counter never resets: ids keep counting
    assert svc.collision_records()[0].event_id == "col-2"
    # a failed mutation rolls records back through the checkpoint path
    svc.restore_snapshot(after)
    with pytest.raises(Exception):
        svc.update_body("nope", simulation.BodyUpdate(name="x"))
    assert len(svc.collision_records()) == 1


def test_records_are_copied_into_a_derived_engine_and_are_independent():
    svc, steps = loaded("probe_heavy_created_first")
    svc.step(steps[0])
    snap = svc.capture_snapshot()
    derived = SimulationService.from_snapshot(snap, history_mode="step", collision_config=CollisionConfig(mode="outcome-v1"))
    assert derived.collision_records() == svc.collision_records()
    assert derived.collision_records() is not svc.collision_records()
    derived._collision_records.clear()
    assert len(svc.collision_records()) == 1


def test_records_are_bounded_like_the_event_list():
    records = list(range(MAX_COLLISION_RECORDS + 5))
    trim(records)
    assert len(records) == MAX_COLLISION_RECORDS and records[0] == 5 and MAX_COLLISION_RECORDS == simulation.MAX_EVENTS_KEPT


# ---------------------------------------------------------------------------------------------------------------
# Detection reliability flag
# ---------------------------------------------------------------------------------------------------------------
def test_detection_is_not_degraded_when_the_curvature_criterion_holds():
    svc, steps = loaded("probe_heavy_created_first")
    svc.step(steps[0])
    assert svc.last_detection == {"degradedChunks": 0, "worstCurvatureRatio": 1.0}
    (record,) = svc.collision_records()
    assert record.input.impact.chunk_criterion_satisfied is True


def test_detection_is_reported_degraded_when_the_chunk_floor_overrides_the_curvature_limit(monkeypatch):
    """With MAX_CHUNKS_PER_STEP = 3 the chunk floor (dt / 3 = 3.3e3 s) is far above the 1 % curvature limit near periapsis of an
    e = 0.9 binary. The step still detects the merger (IAS15 takes its own small internal steps) but says that its guarantee
    was not met: counted in `last_detection` and flagged in the impact state, never silent."""
    monkeypatch.setattr(simulation, "MAX_CHUNKS_PER_STEP", 3)
    bodies, steps = ls.kepler_merge()
    svc = deferred()
    svc.load_bodies(bodies, history_mode="step")
    svc.step(steps[0])
    assert svc.last_detection["degradedChunks"] > 0
    assert 1.0 < svc.last_detection["worstCurvatureRatio"] < math.inf
    (record,) = svc.collision_records()
    assert record.input.impact.chunk_criterion_satisfied is False


def test_the_detection_summary_resets_at_every_step():
    bodies, steps = ls.kepler_merge()
    svc = deferred()
    svc.load_bodies(bodies, history_mode="step")
    svc.step(steps[0])  # one lone remnant afterwards: nothing to integrate against
    svc.step(10.0)
    assert svc.last_detection == {"degradedChunks": 0, "worstCurvatureRatio": 1.0}
