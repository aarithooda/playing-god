"""H1 (repair 2026-10-28): the merge-only retry of a failed collision-engine step (D-065, product rule of `c779415`) applies to THAT step
only. Afterwards the universe resolves contacts in the mode its configuration reports, also after a reset; a failure that does not come
from the collision engine is not retried as one (it rolls back as before)."""
import pytest

import backend.impact.engine as engine_module
from backend.simulation import SimulationFailure, SimulationService
from tests.helpers import dump, make
from tests.impact.test_engine_outcomes import ROCK, pair_service


def far_pair(svc, offset=1.0e12):
    """The same head-on rock pair as `pair_service(8.0)`, built far from the first one (no interaction within the test)."""
    probe, t, p, _ = pair_service(8.0)
    tb, pb = probe.snapshot().bodies
    for b, name in ((tb, "far-target"), (pb, "far-projectile")):
        svc.add_body(make(name, m=b.massKg, r=b.radiusM, x=(b.positionM.x + offset, b.positionM.y, b.positionM.z),
                          v=(b.velocityMPerS.x, b.velocityMPerS.y, b.velocityMPerS.z), material=ROCK))
    svc.approach_s = probe.approach_s


@pytest.fixture
def fallback_on(monkeypatch):
    monkeypatch.setattr(SimulationService, "FALLBACK_TO_MERGE", True)


def _inject_engine_failure(monkeypatch):
    monkeypatch.setattr(engine_module, "realise", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("injected engine failure")))


def test_after_a_merged_fallback_the_next_collision_uses_the_configured_engine_again(fallback_on, monkeypatch):
    svc, *_ = pair_service(8.0)
    real = engine_module.realise
    _inject_engine_failure(monkeypatch)
    first = svc.step(svc.approach_s)
    assert "collisions_merged_fallback" in first.warnings and [e.type for e in first.events] == ["merger"]
    monkeypatch.setattr(engine_module, "realise", real)
    # an independent pair far away: the engine is healthy again, so the configured mode must resolve it
    far_pair(svc)
    second = svc.step(svc.approach_s)
    assert svc.collision_config.mode == "outcome-v1"
    assert [e.type for e in second.events] == ["collision"] and "collisions_merged_fallback" not in second.warnings
    assert svc.collision_records(), "the configured engine wrote a record"


def test_reset_after_a_merged_fallback_keeps_the_configured_engine(fallback_on, monkeypatch):
    svc, *_ = pair_service(8.0)
    real = engine_module.realise
    _inject_engine_failure(monkeypatch)
    svc.step(svc.approach_s)
    monkeypatch.setattr(engine_module, "realise", real)
    svc.reset()
    pair_service(8.0, svc=svc)
    out = svc.step(svc.approach_s)
    assert [e.type for e in out.events] == ["collision"]


def test_a_failure_outside_the_collision_engine_is_not_retried_as_merge_only(fallback_on, monkeypatch):
    svc, *_ = pair_service(8.0)
    before = dump(svc)

    real = svc._advance
    calls = {"n": 0}

    def flaky(target):  # fails once, outside the collision engine; a retry would succeed
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("integrator failure unrelated to collisions")
        real(target)

    monkeypatch.setattr(svc, "_advance", flaky)
    with pytest.raises(SimulationFailure, match="rolled back"):
        svc.step(svc.approach_s)
    assert dump(svc) == before and calls["n"] == 1, "not retried as a collision-engine failure"
    out = svc.step(svc.approach_s)
    assert [e.type for e in out.events] == ["collision"]


def test_the_merge_only_retry_is_exactly_the_legacy_algorithm(fallback_on, monkeypatch):
    """H4 / D-036: the retry uses the unchanged legacy resolver, so its events and bodies equal a legacy-merge universe's for the same
    scenario (nothing new is introduced into the legacy path); afterwards the configured mode is back."""
    import json

    from backend.simulation import LEGACY_MERGE_CONFIG

    legacy, *_ = pair_service(8.0, svc=SimulationService(LEGACY_MERGE_CONFIG))
    want = json.loads(legacy.step(legacy.approach_s).model_dump_json())
    svc, *_ = pair_service(8.0)
    _inject_engine_failure(monkeypatch)
    got = json.loads(svc.step(svc.approach_s).model_dump_json())
    assert got.pop("warnings") == ["collisions_merged_fallback"]
    strip = lambda s: [{k: v for k, v in b.items() if k != "id"} for b in s["bodies"]]  # noqa: E731 - body ids are random per universe
    assert strip(got) == strip(want) and got["simulationTimeS"] == want["simulationTimeS"]
    assert [{k: v for k, v in e.items() if k not in ("bodyIds", "resultBodyId")} for e in got["events"]] == \
           [{k: v for k, v in e.items() if k not in ("bodyIds", "resultBodyId")} for e in want["events"]]
    assert svc._deferred and svc._collision_callback() == svc._recorder.resolve and svc.collision_config.mode == "outcome-v1"


def test_a_mixed_material_merge_in_the_retry_is_flagged(fallback_on, monkeypatch):
    from backend.models import BodyUpdate

    svc, t, p, _ = pair_service(8.0)
    svc.update_body(p.id, BodyUpdate(material={"profileId": "water-ice"}))
    _inject_engine_failure(monkeypatch)
    out = svc.step(svc.approach_s)
    assert out.warnings == ["collisions_merged_fallback", "product_material_unspecified"]
