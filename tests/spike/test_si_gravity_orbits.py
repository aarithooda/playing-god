"""M0 spike tests: SI convention, gravity, orbits, smooth checkpoint.

Tolerance classes (kept separate on purpose):
  * round-off: results that are exact identities in arithmetic; allowed error ~ a few thousand epsilon (2.2e-16).
  * integration error: depends on the integrator/step; bounds are derived below, not tuned.
  * model approximation: neglected physics (e.g. mutual gravity of 1 tonne spheres), bounded analytically.
Skipped automatically if REBOUND is not installed (pip install -r backend/experiments/requirements.txt).
"""
import pytest

pytest.importorskip("rebound")
from backend.experiments import rebound_spike as sp  # noqa: E402


def test_project_G_is_set_explicitly_and_differs_from_rebound_si_constant():
    """Quantity: G [m^3 kg^-1 s^-2]. Project value 6.67430e-11. REBOUND's own SI value is 6.67408e-11
    (observed), 3.3e-5 relative lower, which would shift an orbital period by ~1.6e-5 relative."""
    assert sp.new_sim().G == sp.G_SI == 6.67430e-11
    assert sp.rebound_units_G() / sp.G_SI - 1.0 == pytest.approx(-3.3e-5, rel=0.05)


def test_gravitational_acceleration_earth_moon_pair():
    """Quantity: acceleration of the Earth [m/s^2]; expected G m_moon / r^2 = 3.3163e-5 (analytic, at the final r).
    Tolerance 1e-9 relative; measured 1.4e-11."""
    r = sp.acceleration_check()
    assert r["rel_err"] < 1e-9


@pytest.mark.parametrize("e", [0.0, 0.5])
def test_ias15_sun_earth_orbit_conserves_and_returns(e):
    """10 orbits, a = 1 AU, T = 2 pi sqrt(a^3 / (G (M+m))) = 3.1558e7 s (analytic, independent of REBOUND).
    dE/E and dL/L: IAS15 is designed for machine precision, ~400-500 steps => round-off accumulation ~5e-15;
    bound 1e-12 (200x margin). |dp|/(M v): same class, bound 1e-14. Return error |r(10T) - r(0)|/|r(0)|:
    phase error, measured 5e-14..9e-14; bound 1e-10 (still < 15 m at 1 AU)."""
    r = sp.orbit("ias15", e=e)
    assert r["rel_dE"] < 1e-12
    assert r["rel_dL"] < 1e-12
    assert r["rel_dp"] < 1e-14
    assert r["return_err_rel"] < 1e-10
    assert r["period_s"] == pytest.approx(3.1557671e7, rel=1e-7)


@pytest.mark.parametrize("e", [0.0, 0.5])
def test_whfast_sun_earth_orbit_conserves_and_returns(e):
    """WHFast with dt = T/200. Integration-error estimate for the planet's reflex: (m/M) (2 pi dt/T)^2 =
    3e-6 * 1e-3 = 3e-9, so the energy/phase bounds below (1e-8) follow from the scheme, not from the data
    (measured dE/E 3e-15..8e-15, return error 3e-12..1.3e-11)."""
    r = sp.orbit("whfast", e=e)
    assert r["rel_dE"] < 1e-8
    assert r["rel_dL"] < 1e-8
    assert r["rel_dp"] < 1e-14
    assert r["return_err_rel"] < 1e-8


@pytest.mark.parametrize("integrator", ["ias15", "whfast"])
def test_smooth_checkpoint_restore_is_bitwise_identical(integrator):
    """save at t=1e7 s, restore, advance to 2e7 s == uninterrupted run: positions, velocities, masses, names
    (bitwise), plus t, G and integrator. Tolerance: exact equality (deterministic arithmetic)."""
    r = sp.checkpoint(integrator)
    assert r["bitwise_equal"] is True
    assert r["same_t_G_integrator"] is True
    assert r["G_restored"] == sp.G_SI
