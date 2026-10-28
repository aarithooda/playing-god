"""M3 (repair 2026-10-28): degraded detection is visible to API clients (plan 3.4: "a new diagnostic, not a silent miss").

A step whose INTERNAL integrator steps exceeded the curvature criterion that `line` detection relies on reports it in its response:
warning `collision_detection_degraded` and a `detection` summary (degradedChunks, worstCurvatureRatio, chunksAboveLimit). A step that
kept the criterion carries neither key, so ordinary responses are byte-identical to before. The remainder of a chunk that is integrated
after a collision was resolved inside it is judged too, against the curvature limit of the CHANGED system."""
import json

from backend import simulation
from tests.impact import legacy_scenarios as ls
from tests.impact.test_engine_outcomes import deferred, pair_service
from backend.simulation import LEGACY_MERGE_CONFIG, SimulationService


def test_a_degraded_step_says_so_in_its_response(monkeypatch):
    monkeypatch.setattr(simulation, "MAX_CHUNKS_PER_STEP", 3)
    monkeypatch.setattr(simulation.SimulationService, "_chunk_limit", lambda self: 1.0e-6)
    bodies, steps = ls.kepler_merge()
    svc = deferred()
    svc.load_bodies(bodies, history_mode="step")
    out = svc.step(steps[0])
    assert "collision_detection_degraded" in out.warnings
    body = json.loads(out.model_dump_json())
    assert body["detection"]["degradedChunks"] == svc.last_detection["degradedChunks"] > 0
    assert body["detection"]["worstCurvatureRatio"] > 1.0


def test_the_legacy_mode_reports_it_too(monkeypatch):
    monkeypatch.setattr(simulation, "MAX_CHUNKS_PER_STEP", 3)
    monkeypatch.setattr(simulation.SimulationService, "_chunk_limit", lambda self: 1.0e-6)
    bodies, steps = ls.kepler_merge()
    svc = SimulationService(LEGACY_MERGE_CONFIG)
    svc.load_bodies(bodies, history_mode="step")
    out = svc.step(steps[0])
    assert "collision_detection_degraded" in out.warnings and out.detection is not None


def test_a_step_that_keeps_the_criterion_has_no_detection_key():
    svc, *_ = pair_service(3.0)
    body = json.loads(svc.step(svc.approach_s).model_dump_json())
    assert "detection" not in body and "warnings" not in body


def test_the_rest_of_a_chunk_after_a_resolution_is_judged_against_the_changed_system(monkeypatch):
    """The first chunk-limit evaluation allows the whole step (one chunk, integration stops at the contact); after the resolution the
    limit of the changed system is far shorter than the internal steps that finish the chunk. Before the repair that remainder was never
    judged, so the step looked clean."""
    calls = {"n": 0}

    def limit(self):
        calls["n"] += 1
        return float("inf") if calls["n"] == 1 else 1.0e-6

    svc, *_ = pair_service(3.0)
    monkeypatch.setattr(simulation.SimulationService, "_chunk_limit", limit)
    out = svc.step(svc.approach_s)
    assert [e.type for e in out.events] == ["collision"]
    assert svc.last_detection["degradedChunks"] >= 1
    assert "collision_detection_degraded" in out.warnings
