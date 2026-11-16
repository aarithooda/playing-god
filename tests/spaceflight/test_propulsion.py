"""Rocket relations and the burn arithmetic shared by the engine and the planner."""
import math

import pytest

from backend.spaceflight import propulsion as p
from backend.spaceflight.dynamics import Gravitator, build_hierarchy, burn_window, plan_impulse


def test_standard_gravity_is_the_defined_value_and_exhaust_velocity_follows():
    assert p.G0 == 9.80665
    assert p.exhaust_velocity(300.0) == pytest.approx(2941.995)


@pytest.mark.parametrize("dry,prop,isp", [(1000.0, 1000.0, 300.0), (4500.0, 18000.0, 450.0), (10.0, 0.5, 220.0)])
def test_tsiolkovsky_and_its_inverse_agree(dry, prop, isp):
    dv = p.delta_v_capacity(dry, prop, isp)
    assert dv == pytest.approx(isp * 9.80665 * math.log((dry + prop) / dry), rel=1e-15)
    assert p.propellant_for(dv, dry + prop, isp) == pytest.approx(prop, rel=1e-12)
    assert p.delta_v_from(prop, dry + prop, isp) == pytest.approx(dv, rel=1e-12)


def test_a_mass_ratio_of_e_gives_exactly_one_exhaust_velocity():
    assert p.delta_v_capacity(1000.0, 1000.0 * (math.e - 1.0), 311.0) == pytest.approx(311.0 * 9.80665, rel=1e-14)


def test_no_engine_and_no_propellant_give_nothing():
    assert p.delta_v_capacity(1000.0, 0.0, 300.0) == 0.0 and p.delta_v_capacity(1000.0, 500.0, 0.0) == 0.0
    assert p.mass_flow(0.0, 300.0) == 0.0 and p.mass_flow(1000.0, 0.0) == 0.0
    assert p.burn_duration(100.0, 1000.0, 0.0, 300.0) == math.inf and p.burn_duration(0.0, 1000.0, 0.0, 300.0) == 0.0
    assert p.propellant_for(0.0, 1000.0, 300.0) == 0.0 and p.propellant_for(10.0, 1000.0, 0.0) == math.inf


def test_burn_duration_is_propellant_over_mass_flow():
    flow = p.mass_flow(20000.0, 320.0)
    assert flow == pytest.approx(20000.0 / (320.0 * 9.80665))
    assert p.burn_duration(500.0, 5000.0, 20000.0, 320.0) == pytest.approx(p.propellant_for(500.0, 5000.0, 320.0) / flow, rel=1e-14)


def test_an_impulse_is_delivered_in_full_when_the_propellant_allows_it():
    res = plan_impulse((30.0, 40.0, 0.0), 2000.0, 1000.0, 300.0)
    assert res.delivered == pytest.approx(50.0) and res.shortfall == pytest.approx(0.0, abs=1e-12)
    assert res.delta_v == pytest.approx((30.0, 40.0, 0.0))
    assert res.propellant_used_kg == pytest.approx(2000.0 * (1.0 - math.exp(-50.0 / (300.0 * 9.80665))), rel=1e-14)


def test_an_impulse_beyond_the_propellant_is_shortened_along_its_direction():
    capacity = p.delta_v_capacity(1000.0, 100.0, 300.0)
    res = plan_impulse((0.0, 0.0, 1000.0), 1100.0, 100.0, 300.0)
    assert res.delivered == pytest.approx(capacity) and res.shortfall == pytest.approx(1000.0 - capacity)
    assert res.propellant_used_kg == pytest.approx(100.0) and res.delta_v == pytest.approx((0.0, 0.0, capacity))
    assert plan_impulse((0.0, 0.0, 5.0), 1000.0, 0.0, 300.0).delivered == 0.0
    assert plan_impulse((0.0, 0.0, 0.0), 1000.0, 10.0, 300.0).propellant_used_kg == 0.0


def test_a_centred_burn_window_straddles_the_node_and_an_uncentred_one_starts_at_it():
    w = burn_window(200.0, 1000.0, True, 3000.0, 1500.0, 5000.0, 310.0)
    duration = p.burn_duration(200.0, 3000.0, 5000.0, 310.0)
    assert w.end_s - w.start_s == pytest.approx(duration) and 0.5 * (w.start_s + w.end_s) == pytest.approx(1000.0)
    assert w.feasible and w.delivered == pytest.approx(200.0)
    w = burn_window(200.0, 1000.0, False, 3000.0, 1500.0, 5000.0, 310.0)
    assert w.start_s == 1000.0 and w.end_s == pytest.approx(1000.0 + duration)


def test_a_burn_window_ends_when_the_propellant_does():
    w = burn_window(5000.0, 0.0, False, 1100.0, 100.0, 1000.0, 300.0)
    assert not w.feasible and w.propellant_kg == pytest.approx(100.0)
    assert w.end_s == pytest.approx(100.0 / p.mass_flow(1000.0, 300.0))
    assert w.delivered == pytest.approx(p.delta_v_capacity(1000.0, 100.0, 300.0))
    assert burn_window(100.0, 5.0, True, 1000.0, 100.0, 0.0, 300.0).end_s == 5.0  # no thrust: no window


def test_hierarchy_puts_the_moon_under_earth_although_the_sun_pulls_harder():
    au, d = 1.495978707e11, 3.844e8
    sun = Gravitator("sun", 1.98847e30, 6.957e8, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    earth = Gravitator("earth", 5.9722e24, 6.371e6, (au, 0.0, 0.0), (0.0, 29780.0, 0.0))
    moon = Gravitator("moon", 7.346e22, 1.7374e6, (au + d, 0.0, 0.0), (0.0, 30800.0, 0.0))
    assert sun.mass_kg / (au + d) ** 2 > earth.mass_kg / d ** 2  # the premise: the Sun's pull on the Moon is the larger one
    h = build_hierarchy([sun, earth, moon])
    assert h.parent == {"sun": None, "earth": "sun", "moon": "earth"}
    assert h.soi["sun"] == math.inf and h.soi["earth"] == pytest.approx(9.25e8, rel=5e-3) and h.soi["moon"] == pytest.approx(6.62e7, rel=5e-3)
    assert h.reference_for((au + 7.0e6, 0.0, 0.0)).id == "earth"
    assert h.reference_for((au + d + 3.0e6, 0.0, 0.0)).id == "moon"
    assert h.reference_for((0.5 * au, 0.0, 0.0)).id == "sun"
    assert build_hierarchy([]).reference_for((0.0, 0.0, 0.0)) is None
