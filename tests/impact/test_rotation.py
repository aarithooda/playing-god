"""Stage 2: rotation state and quaternion utilities (backend/impact/rotation.py). Expected values are analytic identities."""
import math

import pytest

from backend.impact import rotation as r
from backend.impact.contracts import ContractError, RotationState, Vec3


def close(a, b, tol):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


OMEGA = (0.3e-4, -0.5e-4, 0.8e-4)  # tilted axis, ~1 revolution per 1e5 s


def test_quaternion_multiplication_and_rotation_match_known_cases():
    qz90 = (math.sqrt(0.5), 0.0, 0.0, math.sqrt(0.5))  # +90 degrees about z
    assert close(r.rotate(qz90, (1.0, 0.0, 0.0)), (0.0, 1.0, 0.0), 1e-15)
    assert close(r.rotate(qz90, (0.0, 1.0, 0.0)), (-1.0, 0.0, 0.0), 1e-15)
    assert close(r.rotate(qz90, (0.0, 0.0, 1.0)), (0.0, 0.0, 1.0), 1e-15)
    assert close(r.q_mul(qz90, qz90), (0.0, 0.0, 0.0, 1.0), 1e-15)  # two quarter turns = a half turn
    assert close(r.inverse_rotate(qz90, (0.0, 1.0, 0.0)), (1.0, 0.0, 0.0), 1e-15)
    assert r.q_conj((1.0, 2.0, 3.0, 4.0)) == (1.0, -2.0, -3.0, -4.0)
    with pytest.raises(ValueError):
        r.q_normalize((0.0, 0.0, 0.0, 0.0))


def test_exp_rotation_is_the_axis_angle_rotation():
    omega = (0.0, 0.0, 2.0)
    q = r.exp_rotation(omega, math.pi / 4)  # angle 2 * pi/4 = pi/2 about z
    assert close(r.rotate(q, (1.0, 0.0, 0.0)), (0.0, 1.0, 0.0), 1e-15)
    assert r.exp_rotation((0.0, 0.0, 0.0), 5.0) == r.IDENTITY and r.exp_rotation(omega, 0.0) == r.IDENTITY
    assert r.q_norm(r.exp_rotation(OMEGA, 1.234e5)) == pytest.approx(1.0, abs=1e-15)


def test_quaternion_stays_unit_after_a_million_incremental_updates():
    q = r.IDENTITY
    for _ in range(1_000_000):
        q = r.advance(q, OMEGA, 37.0)
    assert abs(r.q_norm(q) - 1.0) <= 1e-12
    # and the accumulated incremental orientation agrees with the closed form to the accumulated round-off
    exact = r.orientation_at(r.make_rotation(OMEGA, 0.4, 1.0, 1.0, 0.0), 37.0e6)
    assert close(q, exact, 1e-8) or close(q, tuple(-c for c in exact), 1e-8)


def test_closed_form_orientation_is_unit_for_any_time():
    state = r.make_rotation(OMEGA, 0.4, 5.97e24, 6.371e6, 10.0)
    for t in (10.0, 11.0, 1e3, 1e5, 3.15e7, 1e9):
        assert abs(r.q_norm(r.orientation_at(state, t)) - 1.0) <= 1e-12


def test_body_local_world_round_trip_is_exact_to_1e12():
    state = r.make_rotation(OMEGA, 0.4, 1e22, 1e6, 0.0, q0=r.q_normalize((0.7, 0.1, -0.4, 0.2)))
    for t in (0.0, 1234.5, 8.8e4, 2.5e6):
        for v in ((1.0, 0.0, 0.0), (0.2, -0.7, 0.3), (0.0, 0.0, -1.0)):
            local = r.to_local(state, t, v)
            assert close(r.to_world(state, t, local), v, 1e-12)
            assert math.sqrt(sum(c * c for c in local)) == pytest.approx(math.sqrt(sum(c * c for c in v)), rel=1e-12)


def test_a_body_fixed_site_returns_to_the_same_world_direction_after_one_period():
    state = r.make_rotation(OMEGA, 0.4, 1e22, 1e6, 0.0)
    period = r.rotation_period_s(state)
    assert period == pytest.approx(2 * math.pi / math.sqrt(sum(c * c for c in OMEGA)), rel=1e-15)
    site_local = (0.6, -0.48, 0.64)
    for n in (1, 2, 5):
        start = r.to_world(state, 0.0, site_local)
        assert close(r.to_world(state, n * period, site_local), start, 1e-9), n
    half = r.to_world(state, period / 2, site_local)
    axis = tuple(c / math.sqrt(sum(x * x for x in OMEGA)) for c in OMEGA)
    along = sum(a * b for a, b in zip(site_local, axis))
    # after half a turn the component along the axis is unchanged and the perpendicular part is reversed
    expected = tuple(2 * along * a - s for a, s in zip(axis, site_local))
    assert close(half, expected, 1e-9)


def test_site_at_the_south_pole_stays_on_the_axis_while_equatorial_sites_circle():
    state = r.make_rotation((0.0, 0.0, 7.2921e-5), 0.4, 5.97e24, 6.371e6, 0.0)
    south = (0.0, 0.0, -1.0)
    for t in (0.0, 1e3, 4.3e4, 1e6):
        assert close(r.to_world(state, t, south), south, 1e-12)
    quarter = 0.25 * r.rotation_period_s(state)
    assert close(r.to_world(state, quarter, (1.0, 0.0, 0.0)), (0.0, 1.0, 0.0), 1e-9)


def test_rebase_describes_the_same_rotation_from_a_new_epoch():
    state = r.make_rotation(OMEGA, 0.4, 1e22, 1e6, 0.0, q0=r.q_normalize((0.5, 0.5, 0.5, 0.5)))
    moved = r.rebase(state, 5.0e5)
    assert moved.t0_s == 5.0e5 and moved.omega_rad_per_s == state.omega_rad_per_s
    for t in (5.0e5, 7.7e5, 3.3e6):
        a, b = r.orientation_at(state, t), r.orientation_at(moved, t)
        assert close(a, b, 1e-9) or close(a, tuple(-c for c in b), 1e-9)


def test_spin_angular_momentum_and_energy_follow_i_omega():
    mass, radius, k = 6.0e24, 6.4e6, 0.4
    state = r.make_rotation((0.0, 0.0, 7.0e-5), k, mass, radius, 0.0)
    i = k * mass * radius ** 2
    assert state.moment_of_inertia_kg_m2 == pytest.approx(i, rel=1e-15)
    assert r.spin_angular_momentum(state) == (0.0, 0.0, i * 7.0e-5)
    assert r.rotational_energy(state) == pytest.approx(0.5 * i * 7.0e-5 ** 2, rel=1e-15)
    bigger = r.with_inertia(state, 100.0, 2 * i)
    assert r.spin_angular_momentum(bigger)[2] == pytest.approx(2 * i * 7.0e-5, rel=1e-15) and bigger.t0_s == 100.0


def test_a_non_rotating_state_has_no_period_and_an_unchanging_orientation():
    state = r.make_rotation((0.0, 0.0, 0.0), 0.4, 1.0, 1.0, 0.0, q0=r.q_normalize((1.0, 1.0, 0.0, 0.0)))
    assert r.rotation_period_s(state) is None
    assert r.orientation_at(state, 1e9) == state.q0


def test_invalid_rotation_states_are_rejected():
    with pytest.raises(ContractError):
        RotationState(Vec3(0, 0, 1), (2.0, 0.0, 0.0, 0.0), 0.0, 1.0)  # not a unit quaternion
    with pytest.raises(ContractError):
        RotationState(Vec3(0, 0, 1), r.IDENTITY, 0.0, 0.0)  # zero inertia
    with pytest.raises(ContractError):
        RotationState(Vec3(0, 0, float("nan")), r.IDENTITY, 0.0, 1.0)
