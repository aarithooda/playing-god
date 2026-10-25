"""Stage 12 performance criteria (plan section 6, Stage 12). Wall-clock limits are measured on the machine running the tests
and are generous bounds, not benchmarks; the collision-free step latency at N = 50/100/200 is `test_performance_stage1.py`."""
import time

import pytest

from tests.impact.test_engine_outcomes import deferred, pair_service


def test_a_catastrophic_event_with_full_budgets_resolves_within_half_a_second():
    best = None
    for _ in range(3):
        svc, *_ = pair_service(8.0, 0.0, m_t=1.0e22, m_p=1.0e22)  # equal masses at 8 v_esc: disruption
        t0 = time.perf_counter()
        out = svc.step(svc.approach_s)
        dt = time.perf_counter() - t0
        assert out.events and out.events[0].outcome in ("catastrophic_disruption", "super_catastrophic_disruption")
        best = dt if best is None else min(best, dt)
    print(f"\ncatastrophic event step (best of 3): {best:.3f} s")
    assert best <= 0.5


def test_a_step_with_many_simultaneous_events_stays_inside_the_step_time_budget():
    from tests.helpers import make
    from tests.impact.test_engine_outcomes import ROCK

    svc = deferred()
    n_pairs = 12
    for i in range(n_pairs):  # independent contacting pairs far apart from each other
        y = i * 1.0e9
        svc.add_body(make(f"t{i}", m=1.0e22, r=1.0e6, x=(0.0, y, 0.0), material=ROCK))
        svc.add_body(make(f"p{i}", m=1.0e21, r=4.5e5, x=(2.0e6, y, 0.0), v=(-3.0e3, 0.0, 0.0), material=ROCK))
    t0 = time.perf_counter()
    out = svc.step(2.0e3)
    elapsed = time.perf_counter() - t0
    print(f"\n{n_pairs} simultaneous pairs, step {elapsed:.3f} s, events {len(out.events)}")
    assert elapsed < svc.step_time_limit_s and len(out.events) >= 1
