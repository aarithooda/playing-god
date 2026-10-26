

import pytest as _pytest


@_pytest.fixture(autouse=True)
def _strict_collision_engine(monkeypatch):
    """The impact tests exercise the strict path (an engine failure rolls the step back); the merge fallback has its own test."""
    from backend.simulation import SimulationService
    monkeypatch.setattr(SimulationService, "FALLBACK_TO_MERGE", False)
