"""D-063: the impact state's velocities refer to the contact time (integrated refinement), not the later detection time.

Two equal Earths released at rest fall head-on; with no other body the speed at contact (centre distance 2R) is exactly
sqrt(2 G (2M) (1/(2R) - 1/d0)). Before D-063 the record used the velocities at detection, 0.1-1.3 % too fast depending on the
step grid. The legacy `merger` event (material unspecified) keeps its exact arithmetic: relative speed AT DETECTION."""
import math

import pytest

from backend.impact.config import CollisionConfig
from backend.simulation import G_SI, SimulationService
from tests.helpers import make

M, R, D0 = 5.972e24, 6.371e6, 3.0e9
V_CONTACT = math.sqrt(2.0 * G_SI * 2.0 * M * (1.0 / (2.0 * R) - 1.0 / D0))


def first_event(dt_s: float, mode: str = "outcome-v1"):
    svc = SimulationService(CollisionConfig(mode=mode))
    svc.add_body(make("E0", m=M, r=R, x=(0.0, 0.0, 0.0), v=(0.0, 0.0, 0.0)))
    svc.add_body(make("E1", m=M, r=R, x=(D0, 0.0, 0.0), v=(0.0, 0.0, 0.0)))
    for _ in range(10000):
        response = svc.step(dt_s)
        if response.events:
            return svc, response.events[0]
    raise AssertionError("no collision")


@pytest.mark.parametrize("dt_s", [3.0e5, 3.15e6, 3.94e6])
def test_record_impact_speed_is_the_contact_speed_on_every_step_grid(dt_s):
    svc, event = first_event(dt_s)
    impact = svc.collision_records()[-1].input.impact
    assert impact.contact_state_method == "integrated"
    assert impact.impact_speed_m_per_s == pytest.approx(V_CONTACT, rel=1e-9)
    assert impact.contact_separation_residual_rel <= 1e-9
    # positions and velocities refer to the same time: the rewound separation is the contact distance
    sep = math.dist(impact.target.position_m.as_tuple(), impact.projectile.position_m.as_tuple())
    assert sep == pytest.approx(2.0 * R, rel=1e-9)
    # the legacy merger event is unchanged: its speed is the one at detection, which is never below the contact speed
    assert event.type == "merger"
    assert event.relativeSpeedMPerS == impact.detection_relative_speed_m_per_s
    assert event.relativeSpeedMPerS >= V_CONTACT * (1 - 1e-9)


def test_pair_momentum_of_the_record_equals_the_live_pair_momentum():
    svc, event = first_event(3.15e6)
    impact = svc.collision_records()[-1].input.impact
    # equal masses at rest initially: total momentum is zero; the record's pair momentum keeps it (centre of mass from detection)
    assert max(abs(c) for c in impact.pair_momentum_kg_m_per_s.as_tuple()) <= 1e-12 * M * V_CONTACT


def test_legacy_mode_event_is_identical_to_outcome_v1_legacy_route():
    _, legacy = first_event(3.15e6, mode="legacy-merge")
    _, deferred = first_event(3.15e6)
    ids = ("bodyIds", "resultBodyId")  # body ids are random per service
    assert {k: v for k, v in legacy.model_dump().items() if k not in ids} == {k: v for k, v in deferred.model_dump().items() if k not in ids}
