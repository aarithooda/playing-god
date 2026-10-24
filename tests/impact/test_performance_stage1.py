"""Stage 1 performance: the deferred-resolution machinery must not slow a collision-free step.

Plan 6 (Stage 1, Performance): collision-free `step(1e5 s)` at N = 50 / 100 / 200 within +10 % of the baseline. The planning
probe P5 measured 0.034 / 0.121 / 0.339 s on the planning machine; absolute times depend on the machine, so this test measures
mode "legacy-merge" (the unchanged code path) and mode "outcome-v1" back to back on the SAME machine and compares them
(best of several repetitions, to reject scheduler noise). The absolute numbers are printed for the evidence table
(`pytest -s tests/impact/test_performance_stage1.py`).
"""
import math
import time

import pytest

from backend.impact.config import CollisionConfig
from backend.simulation import SimulationService
from tests.impact import legacy_scenarios as ls

G = 6.67430e-11
BASELINE_P5_S = {50: 0.034, 100: 0.121, 200: 0.339}  # planning probe P5, planning machine (informational)
ALLOWED_SLOWDOWN = 1.10
SLACK_S = 0.004  # absolute slack for the smallest case


def solar_ring(n):
    """A star and n-1 light bodies on well-separated circular orbits: no contact is possible within the test step."""
    star_mass = 1.98847e30
    bodies = [ls.body("star", star_mass, 6.9634e8)]
    for i in range(n - 1):
        radius = 1.0e11 * (1.0 + 0.04 * i)
        v = math.sqrt(G * star_mass / radius)
        phase = 2.399963 * i  # golden angle: spreads the bodies around the orbit
        bodies.append(ls.body(f"p{i}", 1.0e22, 1.0e6, (radius * math.cos(phase), radius * math.sin(phase), 0.0),
                              (-v * math.sin(phase), v * math.cos(phase), 0.0)))
    return bodies


def best_step_time(mode, n, repeats=5):
    best = math.inf
    for _ in range(repeats):
        svc = SimulationService(CollisionConfig(mode=mode))
        svc.load_bodies(solar_ring(n), history_mode="step")
        svc.step(1.0e3)  # warm-up: first IAS15 steps are not representative
        t0 = time.perf_counter()
        out = svc.step(1.0e5)
        best = min(best, time.perf_counter() - t0)
        assert out.events == [] and len(out.bodies) == n
    return best


@pytest.mark.parametrize("n", [50, 100, 200])
def test_collision_free_step_latency_is_not_worse_than_the_legacy_path(n):
    legacy = best_step_time("legacy-merge", n)
    new = best_step_time("outcome-v1", n)
    print(f"\nN={n}: legacy-merge {legacy:.4f} s, outcome-v1 {new:.4f} s, ratio {new / legacy:.3f}"
          f" (planning probe P5 on the planning machine: {BASELINE_P5_S[n]} s)")
    assert new <= legacy * ALLOWED_SLOWDOWN + SLACK_S
