"""Orbital mechanics (backend/spaceflight/orbits.py) against closed-form values and an independent numerical integration."""
import math
import random

import pytest

from backend.spaceflight import orbits as o
from tests.validation import kepler_reference as ref

MU = 3.986004418e14  # Earth, m^3/s^2 (IERS 2010); only a number to exercise the formulas with


def rk4_two_body(r, v, mu, t, steps):
    """A plain RK4 integration of r'' = -mu r / |r|^3: shares nothing with the module under test."""
    def acc(p):
        d = math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2) ** 3
        return tuple(-mu * c / d for c in p)

    h = t / steps
    r, v = list(r), list(v)
    for _ in range(steps):
        k1v, k1r = acc(r), v
        r2 = [r[i] + 0.5 * h * k1r[i] for i in range(3)]
        v2 = [v[i] + 0.5 * h * k1v[i] for i in range(3)]
        k2v, k2r = acc(r2), v2
        r3 = [r[i] + 0.5 * h * k2r[i] for i in range(3)]
        v3 = [v[i] + 0.5 * h * k2v[i] for i in range(3)]
        k3v, k3r = acc(r3), v3
        r4 = [r[i] + h * k3r[i] for i in range(3)]
        v4 = [v[i] + h * k3v[i] for i in range(3)]
        k4v, k4r = acc(r4), v4
        r = [r[i] + h / 6.0 * (k1r[i] + 2 * k2r[i] + 2 * k3r[i] + k4r[i]) for i in range(3)]
        v = [v[i] + h / 6.0 * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]) for i in range(3)]
    return tuple(r), tuple(v)


# ---------- scalar relations ----------
@pytest.mark.parametrize("altitude_km", [200.0, 400.0, 20200.0, 35786.0])
def test_circular_speed_escape_speed_and_period_are_the_textbook_relations(altitude_km):
    r = 6378.137e3 + altitude_km * 1e3
    vc = o.circular_speed(MU, r)
    assert vc == pytest.approx(math.sqrt(MU / r), rel=1e-15)
    assert o.escape_speed(MU, r) == pytest.approx(math.sqrt(2.0) * vc, rel=1e-15)
    assert o.orbital_period(MU, r) == pytest.approx(2.0 * math.pi * r / vc, rel=1e-14)  # circumference / speed
    assert o.vis_viva_speed(MU, r, r) == pytest.approx(vc, rel=1e-15)


def test_geostationary_radius_has_a_sidereal_day_period():
    assert o.orbital_period(MU, 42164.17e3) == pytest.approx(86164.09, rel=2e-6)  # sidereal day; radius from Vallado table


def test_vis_viva_at_the_apsides_conserves_angular_momentum():
    a, e = 2.4e7, 0.6
    rp, ra = a * (1 - e), a * (1 + e)
    assert rp * o.vis_viva_speed(MU, rp, a) == pytest.approx(ra * o.vis_viva_speed(MU, ra, a), rel=1e-14)


def test_vis_viva_rejects_a_radius_the_orbit_never_reaches_and_period_rejects_unbound():
    with pytest.raises(o.OrbitError):
        o.vis_viva_speed(MU, 3.0e7, 1.0e7)  # r > 2a
    with pytest.raises(o.OrbitError):
        o.orbital_period(MU, -1.0e7)


def test_hohmann_leo_to_geo_matches_an_independent_energy_and_angular_momentum_calculation():
    """300 km parking orbit to geostationary radius. The expected values are derived here from conservation of energy and angular
    momentum on the transfer ellipse (not from vis-viva as the module does); they are the familiar 2.43 km/s, 1.47 km/s and 5.27 h."""
    mu, r1, r2 = 398600.0e9, 6678.0e3, 42164.0e3
    # speed at periapsis of the ellipse touching both circles: energy and h conservation give vp^2 = 2 mu r2 / (r1 (r1 + r2))
    vp = math.sqrt(2.0 * mu * r2 / (r1 * (r1 + r2)))
    va = vp * r1 / r2
    h = o.hohmann(mu, r1, r2)
    assert h.dv1 == pytest.approx(vp - math.sqrt(mu / r1), rel=1e-12) and h.dv1 == pytest.approx(2426.0, abs=2.0)
    assert h.dv2 == pytest.approx(math.sqrt(mu / r2) - va, rel=1e-12) and h.dv2 == pytest.approx(1467.0, abs=2.0)
    assert h.transfer_time == pytest.approx(math.pi * math.sqrt((0.5 * (r1 + r2)) ** 3 / mu), rel=1e-14)
    assert h.transfer_time / 3600.0 == pytest.approx(5.27, abs=0.01)
    assert h.semi_major_axis == pytest.approx(0.5 * (r1 + r2))


def test_hohmann_inward_gives_negative_burns_and_rejects_nonsense():
    h = o.hohmann(MU, 4.2e7, 7.0e6)
    assert h.dv1 < 0 and h.dv2 < 0
    with pytest.raises(o.OrbitError):
        o.hohmann(MU, 0.0, 7.0e6)


def test_sphere_of_influence_and_hill_radius_of_earth_and_moon():
    au, m_sun, m_earth, m_moon = 1.495978707e11, 1.98847e30, 5.9722e24, 7.346e22
    assert o.sphere_of_influence(au, m_earth, m_sun) == pytest.approx(9.25e8, rel=5e-3)  # 925,000 km (Bate, Mueller & White)
    assert o.sphere_of_influence(3.844e8, m_moon, m_earth) == pytest.approx(6.62e7, rel=5e-3)  # 66,200 km
    assert o.hill_radius(au, m_earth, m_sun) == pytest.approx(1.497e9, rel=5e-3)


# ---------- elements <-> state ----------
def test_a_circular_equatorial_orbit_gives_the_obvious_state():
    r, v = o.elements_to_state(o.Elements(7.0e6, 0.0, 0.0, 0.0, 0.0, 0.0), MU)
    assert r == pytest.approx((7.0e6, 0.0, 0.0), abs=1e-6)
    assert v == pytest.approx((0.0, math.sqrt(MU / 7.0e6), 0.0), abs=1e-9)


def test_inclination_tilts_the_velocity_and_the_node_rotates_the_position():
    i = math.radians(51.6)
    r, v = o.elements_to_state(o.Elements(7.0e6, 0.0, i, 0.0, 0.0, 0.0), MU)
    vc = math.sqrt(MU / 7.0e6)
    assert r == pytest.approx((7.0e6, 0.0, 0.0), abs=1e-6) and v == pytest.approx((0.0, vc * math.cos(i), vc * math.sin(i)), abs=1e-9)
    r, _ = o.elements_to_state(o.Elements(7.0e6, 0.0, i, math.radians(90.0), 0.0, 0.0), MU)
    assert r == pytest.approx((0.0, 7.0e6, 0.0), abs=1e-6)
    r, _ = o.elements_to_state(o.Elements(7.0e6, 0.0, i, 0.0, 0.0, math.radians(90.0)), MU)  # a quarter orbit after the node
    assert r == pytest.approx((0.0, 7.0e6 * math.cos(i), 7.0e6 * math.sin(i)), abs=1e-6)


def test_periapsis_and_apoapsis_of_an_ellipse_are_where_the_elements_say():
    el = o.Elements(1.0e7, 0.3, 0.4, 1.0, 2.0, 0.0)
    r, v = o.elements_to_state(el, MU)
    assert o.norm(r) == pytest.approx(el.periapsis, rel=1e-14) and o.dot(r, v) == pytest.approx(0.0, abs=1e-3)
    assert o.norm(v) == pytest.approx(o.vis_viva_speed(MU, el.periapsis, el.a), rel=1e-14)
    r, v = o.elements_to_state(o.Elements(1.0e7, 0.3, 0.4, 1.0, 2.0, math.pi), MU)
    assert o.norm(r) == pytest.approx(el.apoapsis, rel=1e-14)


def test_random_states_round_trip_through_the_elements_including_the_singular_cases():
    rng = random.Random(20261115)
    worst = 0.0
    for _ in range(4000):
        e = rng.choice([0.0, rng.random() * 0.97, 1.02 + rng.random() * 3.0])
        i = rng.choice([0.0, math.pi, rng.random() * math.pi])
        rp = 7.0e6 * (1.0 + 10.0 * rng.random())
        a = rp / (1.0 - e)
        nu = rng.uniform(-0.95, 0.95) * math.acos(-1.0 / e) if e > 1.0 else rng.uniform(0.0, 2.0 * math.pi)
        el = o.Elements(a, e, i, rng.uniform(0, 2 * math.pi), rng.uniform(0, 2 * math.pi), nu)
        r, v = o.elements_to_state(el, MU)
        back = o.state_to_elements(r, v, MU)
        r2, v2 = o.elements_to_state(back, MU)
        worst = max(worst, o.norm(o.sub(r, r2)) / o.norm(r), o.norm(o.sub(v, v2)) / o.norm(v))
        assert back.a == pytest.approx(a, rel=1e-9) and back.e == pytest.approx(e, abs=1e-9) and back.i == pytest.approx(i, abs=1e-9)
    assert worst < 1e-10


def test_non_singular_elements_are_recovered_individually():
    el = o.Elements(1.2e7, 0.25, math.radians(63.4), math.radians(40.0), math.radians(270.0), math.radians(123.0))
    back = o.state_to_elements(*o.elements_to_state(el, MU), MU)
    for name in ("a", "e", "i", "raan", "argp", "nu"):
        assert getattr(back, name) == pytest.approx(getattr(el, name), rel=1e-11, abs=1e-11), name


@pytest.mark.parametrize("bad", [
    o.Elements(7e6, -0.1, 0, 0, 0, 0), o.Elements(7e6, 1.0, 0, 0, 0, 0), o.Elements(-7e6, 0.5, 0, 0, 0, 0), o.Elements(7e6, 1.5, 0, 0, 0, 0),
    o.Elements(7e6, 0.1, 4.0, 0, 0, 0), o.Elements(float("nan"), 0.1, 0, 0, 0, 0), o.Elements(-7e6, 1.5, 0, 0, 0, 3.0)])
def test_unphysical_elements_are_rejected(bad):
    with pytest.raises(o.OrbitError):
        o.elements_to_state(bad, MU)


def test_degenerate_states_are_rejected_not_guessed():
    with pytest.raises(o.OrbitError):
        o.state_to_elements((7e6, 0, 0), (1000.0, 0, 0), MU)  # purely radial
    with pytest.raises(o.OrbitError):
        o.state_to_elements((7e6, 0, 0), (0, math.sqrt(2 * MU / 7e6), 0), MU)  # exactly parabolic
    with pytest.raises(o.OrbitError):
        o.elements_to_state(o.Elements(7e6, 0, 0, 0, 0, 0), 0.0)


# ---------- time ----------
@pytest.mark.parametrize("e", [0.0, 0.1, 0.7, 0.95])
def test_kepler_equation_round_trips_and_a_period_returns_to_the_start(e):
    for k in range(25):
        nu = 2.0 * math.pi * k / 25.0
        assert o.true_from_mean(o.mean_from_true(nu, e), e) == pytest.approx(nu, abs=1e-10)
    el = o.Elements(9.0e6, e, 0.5, 1.0, 2.0, 0.7)
    r, v = o.elements_to_state(el, MU)
    r2, v2 = o.propagate_kepler(r, v, MU, o.orbital_period(MU, el.a))
    assert o.norm(o.sub(r, r2)) < 1e-5 * o.norm(r) and o.norm(o.sub(v, v2)) < 1e-5 * o.norm(v)


def test_hyperbolic_kepler_equation_round_trips():
    for e in (1.1, 2.0, 5.0):
        limit = math.acos(-1.0 / e)
        for k in range(-9, 10):
            nu = 0.1 * k * limit
            assert o.true_from_mean(o.mean_from_true(nu, e), e) == pytest.approx(nu, abs=1e-10)


@pytest.mark.parametrize("el,dt", [(o.Elements(8.0e6, 0.2, 0.6, 1.0, 2.0, 0.3), 3000.0), (o.Elements(2.6e7, 0.72, 1.1, 4.0, 5.0, 2.5), 20000.0),
                                   (o.Elements(-9.0e6, 1.4, 0.3, 2.0, 1.0, -1.2), 2500.0)])
def test_kepler_propagation_matches_an_independent_rk4_integration(el, dt):
    r, v = o.elements_to_state(el, MU)
    mine = o.propagate_kepler(r, v, MU, dt)
    reference = rk4_two_body(r, v, MU, dt, 40000)
    assert o.norm(o.sub(mine[0], reference[0])) < 1e-3  # metres
    assert o.norm(o.sub(mine[1], reference[1])) < 1e-6


def test_kepler_propagation_matches_the_repositorys_independent_f_and_g_reference():
    el = o.Elements(1.5e7, 0.35, 0.9, 0.4, 1.3, 2.0)
    r, v = o.elements_to_state(el, MU)
    mine = o.propagate_kepler(r, v, MU, 12345.0)
    theirs = ref.propagate(r, v, MU, 12345.0)
    assert o.norm(o.sub(mine[0], theirs[0])) < 1e-4 and o.norm(o.sub(mine[1], theirs[1])) < 1e-7


def test_time_to_the_apsides():
    el = o.Elements(1.0e7, 0.3, 0.2, 0.0, 0.0, math.pi)  # at apoapsis
    period = o.orbital_period(MU, el.a)
    assert o.time_to_true_anomaly(el, MU, 0.0) == pytest.approx(0.5 * period, rel=1e-12)
    assert o.time_to_true_anomaly(el, MU, math.pi) == pytest.approx(0.0, abs=1e-6)
    assert o.time_since_periapsis(el, MU) == pytest.approx(0.5 * period, rel=1e-12)
    outbound = o.Elements(-9.0e6, 1.5, 0.0, 0.0, 0.0, 0.8)
    assert o.time_to_true_anomaly(outbound, MU, 0.0) < 0.0  # the periapsis of an escape trajectory is behind


# ---------- frames ----------
def test_vnb_axes_on_a_circular_orbit_are_prograde_normal_and_radial_out():
    v_hat, n_hat, b_hat = o.vnb_axes((7.0e6, 0.0, 0.0), (0.0, 7500.0, 0.0))
    assert v_hat == pytest.approx((0, 1, 0)) and n_hat == pytest.approx((0, 0, 1)) and b_hat == pytest.approx((1, 0, 0))
    assert o.vnb_to_inertial((7.0e6, 0, 0), (0, 7500.0, 0), 10.0, 20.0, 30.0) == pytest.approx((30.0, 10.0, 20.0))


def test_vnb_axes_are_orthonormal_for_an_eccentric_inclined_state_and_undefined_for_radial_motion():
    r, v = o.elements_to_state(o.Elements(1.3e7, 0.4, 1.0, 2.0, 3.0, 1.0), MU)
    axes = o.vnb_axes(r, v)
    for i in range(3):
        for j in range(3):
            assert o.dot(axes[i], axes[j]) == pytest.approx(1.0 if i == j else 0.0, abs=1e-14)
    with pytest.raises(o.OrbitError):
        o.vnb_axes((7.0e6, 0, 0), (100.0, 0, 0))


def test_plane_of_recovers_inclination_and_node_and_plane_angle_measures_the_tilt():
    for i_deg, raan_deg in ((5.145, 125.0), (28.5, 0.0), (97.8, 250.0), (0.0, 0.0)):
        r, v = o.elements_to_state(o.Elements(1.0e7, 0.1, math.radians(i_deg), math.radians(raan_deg), 1.0, 2.0), MU)
        i, raan = o.plane_of(o.cross(r, v))
        assert math.degrees(i) == pytest.approx(i_deg, abs=1e-9) and math.degrees(raan) == pytest.approx(raan_deg, abs=1e-9)
    assert o.plane_angle((0, 0, 1), (0, 1, 1)) == pytest.approx(math.pi / 4)
