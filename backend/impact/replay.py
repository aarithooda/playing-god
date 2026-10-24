"""Dry-run replay of a recorded collision (plan 3.11; spec 10.5). Pure: it reads a `CollisionRecord`, recomputes what can be recomputed
from the frozen input, and compares digests. It never touches a simulation, so the revision and the state are unchanged by definition.

What is checked, in order:
1. `inputDigest`: the recorded input still hashes to the recorded digest (the record was not altered);
2. `seed`: the content-addressed seed of the input is the one the record carries;
3. `selection`: for a record without an engine fallback, the selector still chooses the recorded outcome spec (a model change shows up here);
4. `result`: `realise` on the recorded spec with the recorded live-state parameters (body budget, tier, engine warnings) gives a result
   whose digest equals the recorded one, and whose conservation report is within tolerance.
A legacy-merge record has no result: only 1-3 apply. Cross-platform tolerances (plan 9.5) are not applied here: a replay on the same
platform is expected to be bitwise identical, and a mismatch reports which top-level result fields differ.
"""
from typing import Optional

from backend.impact.applier import ENGINE_WARNINGS, realise
from backend.impact.contracts import CollisionRecord
from backend.impact.fragments import FragmentBudget
from backend.impact.models.perfect_merge import MODEL_ID, MODEL_VERSION
from backend.impact.records import derive_seed
from backend.impact.selector import Selector


def _budget(extra: dict) -> Optional[FragmentBudget]:
    if "replayBudgetFragments" not in extra:
        return None
    fraction = extra.get("replayMinMassFraction", -1.0)
    return FragmentBudget(int(extra["replayBudgetFragments"]), int(extra["replayBudgetParcels"]), None if fraction < 0 else fraction)


def _check(name: str, ok: Optional[bool], detail: str) -> dict:
    return {"name": name, "ok": ok, "detail": detail}  # ok None = not applicable


def replay(record: CollisionRecord, g: float) -> dict:
    data = record.input
    checks = [_check("inputDigest", data.compute_digest() == record.input_digest, f"recorded {record.input_digest[:12]}…")]
    checks.append(_check("seed", derive_seed(data.config.seed, data.impact, MODEL_ID, MODEL_VERSION) == data.seed, f"seed {data.seed}"))
    spec = record.outcome_spec
    engine_warnings = tuple(w for w in ENGINE_WARNINGS if w in record.warnings)
    forced = bool(engine_warnings)
    if spec is None:
        checks.append(_check("selection", None, "the record has no outcome spec"))
    elif forced:
        checks.append(_check("selection", None, "an engine fallback or cascade limit replaced the model's choice; the recorded spec is replayed as is"))
    else:
        chosen = Selector(g).select(data).spec
        checks.append(_check("selection", chosen == spec, f"selector chooses {chosen.outcome} ({chosen.model_id} {chosen.model_version})"))
    if record.result is None:
        checks.append(_check("result", None, "no result recorded (legacy merge: the exact legacy arithmetic, see the merger event)"))
        recorded = replayed = ""
        differing: list[str] = []
    else:
        extra = record.result.fields_extra
        recorded = record.result_digest
        again = realise(data, spec, g, parcel_allowed=bool(extra.get("replayParcelAllowed", 1.0)), extra_warnings=engine_warnings,
                        represent_spin=bool(extra.get("replayRepresentSpin", 1.0)), budget=_budget(extra))
        replayed = again.result_digest
        differing = [] if replayed == recorded else sorted(k for k in again.to_dict() if again.to_dict()[k] != record.result.to_dict().get(k))
        checks.append(_check("result", replayed == recorded, f"replayed {replayed[:12]}… recorded {recorded[:12]}…"))
        checks.append(_check("conservation", again.conservation.within_tolerance,
                             f"mass {again.conservation.mass_residual_rel:.3g}, momentum {again.conservation.momentum_residual_rel:.3g}"))
    applicable = [c for c in checks if c["ok"] is not None]
    return {"eventId": record.event_id, "reproduced": all(c["ok"] for c in applicable), "checks": checks,
            "recordedResultDigest": recorded, "replayedResultDigest": replayed, "differingFields": differing, "mutatesState": False}
