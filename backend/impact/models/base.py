"""The outcome-model protocol: the adapter boundary for current and future (e.g. hydrodynamic) solvers.

A model is a pure function of a `CollisionInput` (no REBOUND, no service state). It returns an `OutcomeSpec`, or
`Unsupported` with reasons when the input lies outside every validity envelope; it never silently returns a
misleading outcome (spec 6.5). A future solver implements the same protocol; nothing downstream changes (spec 12).
"""
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from backend.impact.contracts import CollisionInput, OutcomeSpec


@dataclass(frozen=True)
class Unsupported:
    """No supported model applies. The reasons are explicit; the caller uses the documented fallback, never a guessed outcome."""

    reasons: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "reasons", tuple(self.reasons))
        if not self.reasons:
            raise ValueError("an Unsupported verdict must state its reasons")


@runtime_checkable
class OutcomeModel(Protocol):
    model_id: str
    model_version: str

    def evaluate(self, data: CollisionInput) -> "OutcomeSpec | Unsupported":
        ...
