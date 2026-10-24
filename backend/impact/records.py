"""Collision records: identity, seeds and the bounded per-universe record list (plan 3.11, 4.9).

Identity. Record ids are `col-<n>` where n is the number of the engine's never-reset event counter (`SimulationService._event_seq`),
the same counter that numbers the legacy merger events `evt-<n>`. A merger event `evt-5` and its record `col-5` therefore
describe the same physical event, and ids are never reused (a rolled-back step gives its numbers back, because its events were
never visible). `legacy_event_id` links the two explicitly.

Seeds. `derive_seed` is content-addressed: SHA-256 over the universe seed, the canonical pre-impact state, the model id and the
model version, first 8 bytes, masked to 63 bits (the range of `CollisionConfig.seed`). A replay after rollback, restore or
derivation of the same input yields the same seed whatever happened before it. The perfect merger draws no random numbers; the
seed is recorded for uniformity with later models.
"""
import hashlib
from typing import Optional

from backend.impact.contracts import (MAX_SEED, CollisionConfig, CollisionInput, CollisionRecord, CollisionResult, ImpactState,
                                      OutcomeSpec, canonical_json)

MAX_COLLISION_RECORDS = 1000  # same retention shape as the event list (MAX_EVENTS_KEPT)


def record_id(seq: int) -> str:
    return f"col-{seq}"


def derive_seed(universe_seed: int, impact: ImpactState, model_id: str, model_version: str) -> int:
    h = hashlib.sha256()
    for part in (str(universe_seed), canonical_json(impact), model_id, model_version):
        h.update(part.encode("utf-8"))
        h.update(b"\x1f")  # unit separator: no ambiguity between parts
    return int.from_bytes(h.digest()[:8], "big") & MAX_SEED


def build_input(seq: int, impact: ImpactState, config: CollisionConfig, model_id: str, model_version: str,
                parent_event_id: Optional[str] = None, generation: int = 0) -> CollisionInput:
    draft = CollisionInput(event_id=record_id(seq), parent_event_id=parent_event_id, generation=generation, impact=impact,
                           config=config, seed=derive_seed(config.seed, impact, model_id, model_version))
    return CollisionInput.from_dict({**draft.to_dict(), "inputDigest": draft.compute_digest()})


def build_record(data: CollisionInput, spec: Optional[OutcomeSpec], selection_reasons: tuple[str, ...], warnings: tuple[str, ...],
                 legacy_event_id: Optional[str], result: Optional[CollisionResult] = None) -> CollisionRecord:
    return CollisionRecord(
        event_id=data.event_id, parent_event_id=data.parent_event_id, root_event_id=data.parent_event_id or data.event_id,
        generation=data.generation, input=data, selection_reasons=selection_reasons, outcome_spec=spec, result=result,
        warnings=warnings, fidelity=dict(spec.fidelity) if spec is not None else {}, input_digest=data.input_digest,
        result_digest="" if result is None else result.result_digest, legacy_event_id=legacy_event_id)


def trim(records: list) -> None:
    """Keep the newest MAX_COLLISION_RECORDS (in place)."""
    del records[:-MAX_COLLISION_RECORDS]
