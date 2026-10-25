"""The event's relative speed is the speed AT DETECTION (end of the integrator step), not at the estimated contact time; the two times are
different fields and are not conflated. Documented in context/API_CONTRACT.md. Isolated pair of equal bodies released from rest, so the
analytic contact speed is known from the energy integral: v_c = sqrt(2 G M (1/R - 1/d0)), M the total mass, R the contact distance."""
import math

import pytest

from backend.impact.config import CollisionConfig
from backend.simulation import G_SI, SimulationService
from tests.helpers import make

M_EACH, RADIUS, X0 = 5.972e24, 6.371e6, 1.496e7


def _fall(mode: str, dt: float):
    svc = SimulationService(CollisionConfig(mode=mode))
    kw = {"material": {"profileId": "silicate-rock"}} if mode == "outcome-v1" else {}
    svc.add_body(make("A", m=M_EACH, r=RADIUS, x=(X0, 0, 0), **kw))
    svc.add_body(make("B", m=M_EACH, r=RADIUS, x=(-X0, 0, 0), **kw))
    out = None
    while not (out and out.events):
        out = svc.step(dt)
    return svc, out.events[0]


def _contact_speed() -> float:
    return math.sqrt(2 * G_SI * 2 * M_EACH * (1 / (2 * RADIUS) - 1 / (2 * X0)))


@pytest.mark.parametrize("mode,dt", [("legacy-merge", 1000.0), ("outcome-v1", 1000.0)])
def test_reported_speed_is_the_speed_at_detection_and_times_stay_separate(mode, dt):
    svc, event = _fall(mode, dt)
    speed = event.relativeSpeedMPerS if event.type == "merger" else event.impactSpeedMPerS
    contact_speed = _contact_speed()
    # detection is strictly after the estimated contact, and the speed has grown over that interval (bodies still approaching)
    assert event.estimatedContactTimeS is not None and event.simulationTimeS > event.estimatedContactTimeS
    assert speed > contact_speed * (1 + 1e-3)
    assert speed == pytest.approx(contact_speed, rel=0.02)  # ... but only by the small amount the step length allows
    if mode == "legacy-merge":
        return  # that mode keeps no collision records (the exact original path)
    # the same value is the one recorded for the impact, at the same detection time
    (record,) = svc.collision_records()
    assert record.input.impact.detection_time_s == event.simulationTimeS
    assert record.input.impact.contact_time_s == pytest.approx(event.estimatedContactTimeS)
    assert record.input.impact.impact_speed_m_per_s == pytest.approx(speed, rel=1e-12)


def test_shorter_steps_move_the_reported_speed_toward_the_contact_speed():
    _, coarse = _fall("legacy-merge", 1000.0)
    _, fine = _fall("legacy-merge", 10.0)
    c = _contact_speed()
    assert abs(fine.relativeSpeedMPerS - c) < abs(coarse.relativeSpeedMPerS - c)
