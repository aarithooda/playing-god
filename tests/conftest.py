import pytest

from backend import universes


@pytest.fixture(autouse=True)
def registry(monkeypatch):
    """A fresh registry (and so a fresh default universe) for every test: no state leaks between tests."""
    fresh = universes.UniverseRegistry()
    monkeypatch.setattr(universes, "_registry", fresh)
    return fresh
