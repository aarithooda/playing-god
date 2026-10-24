"""The independent reference is itself checked, by means that share nothing with it: closed-form cases and a separate
brute-force RK4 integration (so a mistake in the reference cannot hide a mistake in the engine)."""
import math

import pytest

from tests.validation.kepler_reference import cross, dot, elements, norm, propagate


def test_circular_orbit_quarter_turn():
    r, v = propagate((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), 1.0, math.pi / 2)
    assert r == pytest.approx((0.0, 1.0, 0.0), abs=1e-14)
    assert v == pytest.approx((-1.0, 0.0, 0.0), abs=1e-14)


def test_period_returns_to_the_start():
    r0, v0 = (1.0, 0.0, 0.2), (0.0, 0.7, 0.1)
    el = elements(r0, v0, 1.0)
    r, v = propagate(r0, v0, 1.0, el["period"])
    assert r == pytest.approx(r0, abs=1e-12) and v == pytest.approx(v0, abs=1e-12)
    r, v = propagate(r0, v0, 1.0, 3 * el["period"] + 0.37 * el["period"])
    r2, v2 = propagate(r0, v0, 1.0, 0.37 * el["period"])
    assert r == pytest.approx(r2, abs=1e-11)


def test_apsides_and_conservation_on_an_eccentric_orbit():
    r0, v0 = (1.0, 0.0, 0.0), (0.0, 0.6, 0.0)  # slower than circular: the start is the aphelion, e = 1 - v^2 r / mu... = 0.64
    el = elements(r0, v0, 1.0)
    assert el["e"] == pytest.approx(0.64, rel=1e-12) and el["aphelion"] == pytest.approx(1.0, rel=1e-12)
    h0 = cross(r0, v0)
    e0 = 0.5 * dot(v0, v0) - 1.0 / norm(r0)
    for t in (0.3, 2.0, 7.7, 19.0):
        r, v = propagate(r0, v0, 1.0, t)
        assert 0.5 * dot(v, v) - 1.0 / norm(r) == pytest.approx(e0, abs=1e-13)
        assert cross(r, v) == pytest.approx(h0, abs=1e-13)
        assert el["perihelion"] - 1e-12 <= norm(r) <= el["aphelion"] + 1e-12


def rk4(r, v, mu, t_end, steps):
    def acc(p):
        d = norm(p) ** 3
        return tuple(-mu * p[i] / d for i in range(3))

    h = t_end / steps
    for _ in range(steps):
        k1r, k1v = v, acc(r)
        r2 = tuple(r[i] + 0.5 * h * k1r[i] for i in range(3)); v2 = tuple(v[i] + 0.5 * h * k1v[i] for i in range(3))
        k2r, k2v = v2, acc(r2)
        r3 = tuple(r[i] + 0.5 * h * k2r[i] for i in range(3)); v3 = tuple(v[i] + 0.5 * h * k2v[i] for i in range(3))
        k3r, k3v = v3, acc(r3)
        r4 = tuple(r[i] + h * k3r[i] for i in range(3)); v4 = tuple(v[i] + h * k3v[i] for i in range(3))
        k4r, k4v = v4, acc(r4)
        r = tuple(r[i] + h / 6 * (k1r[i] + 2 * k2r[i] + 2 * k3r[i] + k4r[i]) for i in range(3))
        v = tuple(v[i] + h / 6 * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]) for i in range(3))
    return r, v


@pytest.mark.parametrize("r0,v0", [((1.0, 0.0, 0.0), (0.0, 0.6, 0.0)), ((1.0, 0.0, 0.0), (0.2, 0.9, 0.0)), ((0.9, 0.3, 0.1), (-0.3, 0.85, 0.05))])
def test_agrees_with_brute_force_integration(r0, v0):
    t = 9.0  # more than a full orbit
    expected = rk4(r0, v0, 1.0, t, 120_000)
    got = propagate(r0, v0, 1.0, t)
    assert got[0] == pytest.approx(expected[0], abs=1e-9)
    assert got[1] == pytest.approx(expected[1], abs=1e-9)


def test_unbound_orbit_is_refused():
    with pytest.raises(ValueError):
        propagate((1.0, 0.0, 0.0), (0.0, 1.5, 0.0), 1.0, 1.0)
    with pytest.raises(ValueError):
        elements((1.0, 0.0, 0.0), (0.0, 1.5, 0.0), 1.0)
