import pytest

from backend import universes


@pytest.fixture(autouse=True)
def _dormant_collision_modes(request):
    """Every universe stops on contact (owner decision D-071). The merge resolver and the collision-outcome engine are kept, dormant,
    and so are the tests that pin them: a test marked `dormant_collisions` runs with the engine default it was written for
    (outcome-v1, in which a pair without materials is the exact legacy merge). Nothing else is changed for it, and no unmarked
    test can reach the dormant modes without naming them (LEGACY_MERGE_CONFIG / OUTCOME_V1_CONFIG)."""
    if not request.node.get_closest_marker("dormant_collisions"):
        yield
        return
    from backend.simulation import OUTCOME_V1_CONFIG, SimulationService

    with pytest.MonkeyPatch.context() as patch:  # its own context: a test's `monkeypatch.undo()` must not end it early
        patch.setattr(SimulationService, "DEFAULT_CONFIG", OUTCOME_V1_CONFIG)
        yield


@pytest.fixture(autouse=True)
def registry(monkeypatch, _dormant_collision_modes):
    """A fresh registry (and so a fresh default universe) for every test: no state leaks between tests."""
    fresh = universes.UniverseRegistry()
    monkeypatch.setattr(universes, "_registry", fresh)
    return fresh
