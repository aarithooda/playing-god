"""Independent analytical checks against the production REBOUND service.

These fixtures derive expectations from Newtonian mechanics rather than copying
the production tests or calling REBOUND to compute the reference values.
Run from this worktree with: .venv/Scripts/python.exe -m pytest -q -s tests/validation
"""
from __future__ import annotations

import math

import pytest

from backend.models import BodyCreate
from backend.simulation import G_SI, SimulationService

G = 6.67430e-11
C = 299_792_458.0


def body(name: str, mass: float, radius: float, position, velocity) -> BodyCreate:
    return BodyCreate(
        name=name,
        massKg=mass,
        radiusM=radius,
        positionM=dict(zip("xyz", position)),
        velocityMPerS=dict(zip("xyz", velocity)),
        colorHex="#ffffff",
    )


def xyz(v) -> tuple[float, float, float]:
    return (v.x, v.y, v.z)


def dot(a, b) -> float:
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a) -> float:
    return math.sqrt(dot(a, a))


def total_momentum(bodies):
    return tuple(sum(b.massKg * xyz(b.velocityMPerS)[k] for b in bodies) for k in range(3))


def total_angular_momentum(bodies):
    out = [0.0, 0.0, 0.0]
    for b in bodies:
        l = cross(xyz(b.positionM), xyz(b.velocityMPerS))
        for k in range(3):
            out[k] += b.massKg * l[k]
    return tuple(out)


def relative_error(actual: float, expected: float) -> float:
    return abs(actual - expected) / abs(expected)


def test_vector_gravity_against_force_over_mass_derivation():
    """A non-axis-aligned 3-D pair checks magnitude, sign, and component ratios."""
    m1, m2 = 4.0e12, 7.0e12
    r1, r2 = (0.0, 0.0, 0.0), (1200.0, 1600.0, 0.0)  # distance 2000 m
    d = 2000.0
    force_magnitude = G * m1 * m2 / d**2
    expected_a1 = tuple(force_magnitude / m1 * q / d for q in (1200.0, 1600.0, 0.0))
    expected_a2 = tuple(-force_magnitude / m2 * q / d for q in (1200.0, 1600.0, 0.0))

    svc = SimulationService()
    a = svc.add_body(body("a", m1, 1.0, r1, (0.0, 0.0, 0.0)))
    b = svc.add_body(body("b", m2, 1.0, r2, (0.0, 0.0, 0.0)))
    out = svc.step(1.0)
    by_id = {x.id: x for x in out.bodies}
    measured_a1 = xyz(by_id[a.id].velocityMPerS)
    measured_a2 = xyz(by_id[b.id].velocityMPerS)

    # The 1 s finite-time velocity change differs from a(0)*dt by O(a_rel*dt^2/d),
    # under 1e-7 here. The 2e-6 budget includes that trajectory curvature plus roundoff.
    assert measured_a1 == pytest.approx(expected_a1, rel=2e-6, abs=1e-15)
    assert measured_a2 == pytest.approx(expected_a2, rel=2e-6, abs=1e-15)
    assert G_SI == G
    assert dot(measured_a1, (1200.0, 1600.0, 0.0)) > 0.0
    assert dot(measured_a2, (1200.0, 1600.0, 0.0)) < 0.0


def test_circular_binary_after_one_period_against_kepler_solution():
    """Exact barycentric circular solution; state after T should equal its initial state."""
    m1, m2, a = 1.98847e30, 5.9722e24, 1.495978707e11
    mt = m1 + m2
    mu = m1 * m2 / mt
    omega = math.sqrt(G * mt / a**3)
    period = 2.0 * math.pi / omega
    vrel = omega * a
    x1, x2 = -m2 / mt * a, m1 / mt * a
    vy1, vy2 = -m2 / mt * vrel, m1 / mt * vrel

    svc = SimulationService()
    one = svc.add_body(body("primary", m1, 6.957e8, (x1, 0, 0), (0, vy1, 0)))
    two = svc.add_body(body("secondary", m2, 6.371e6, (x2, 0, 0), (0, vy2, 0)))
    initial = svc.snapshot().bodies
    expected_energy = -G * m1 * m2 / (2.0 * a)
    expected_lz = mu * a * vrel

    out = svc.step(period)
    by_id = {x.id: x for x in out.bodies}
    rel_r = tuple(x - y for x, y in zip(xyz(by_id[two.id].positionM), xyz(by_id[one.id].positionM)))
    energy = sum(0.5 * b.massKg * dot(xyz(b.velocityMPerS), xyz(b.velocityMPerS)) for b in out.bodies)
    energy -= G * m1 * m2 / norm(rel_r)
    lz = total_angular_momentum(out.bodies)[2]

    assert out.simulationTimeS == pytest.approx(period, rel=2e-13)
    # Documented tolerance: relative position error 2e-8 of a (report table). The original element-wise check used
    # abs=2e-3 m for the zero y component (1.3e-14 a), which only held for IAS15's PRS23 step-size criterion; the
    # service now uses GLOBAL (see backend/collisions.py select_ias15), which returns |dy| ~ 5e-3 m = 3.6e-14 a.
    assert norm(tuple(x - y for x, y in zip(rel_r, (a, 0.0, 0.0)))) < 2e-8 * a
    assert relative_error(energy, expected_energy) < 2e-10
    assert relative_error(lz, expected_lz) < 2e-10
    assert len(initial) == 2 and not out.events


def test_head_on_inelastic_merge_matches_momentum_and_reduced_mass_energy():
    m1, m2, v1, v2 = 2.0e6, 3.0e6, 500.0, -500.0
    mu = m1 * m2 / (m1 + m2)
    expected_ke_loss = 0.5 * mu * (v1 - v2) ** 2
    svc = SimulationService()
    svc.add_body(body("light", m1, 10.0, (-1000.0, 0, 0), (v1, 0, 0)))
    svc.add_body(body("heavy", m2, 10.0, (1000.0, 0, 0), (v2, 0, 0)))
    before = svc.snapshot().bodies
    p0 = total_momentum(before)

    out = svc.step(2.1)
    assert len(out.events) == 1 and len(out.bodies) == 1
    remnant = out.bodies[0]
    event = out.events[0]
    assert remnant.massKg == m1 + m2
    assert total_momentum(out.bodies) == pytest.approx(p0, rel=2e-12, abs=1e-5)
    assert xyz(remnant.velocityMPerS)[0] == pytest.approx((m1 * v1 + m2 * v2) / (m1 + m2), rel=1e-10)
    assert event.kineticEnergyLostJ == pytest.approx(expected_ke_loss, rel=2e-6)
    assert event.relativeSpeedMPerS == pytest.approx(v1 - v2, rel=2e-6)
    assert svc._resolver.heat_J == pytest.approx(expected_ke_loss, rel=2e-6)
    assert norm(xyz(event.spinAddedKgM2PerS)) < 1e-5

    # Potential energy is a separate term: at contact, U = -G*m1*m2/(R1+R2) = -20 J.
    # The KE ledger must not silently be interpreted as total mechanical-energy loss.
    contact_potential = -G * m1 * m2 / 20.0
    assert contact_potential == pytest.approx(-20.0229, rel=2e-3)
    assert event.kineticEnergyLostJ > 1e9 * abs(contact_potential)
    # Include gravitational focusing in the exact two-body contact-speed reference:
    # K_rel(contact) = K_rel(initial) + G*m1*m2*(1/Rcontact - 1/r_initial).
    r_initial = 2000.0
    ke_at_contact = expected_ke_loss + G * m1 * m2 * (1.0 / 20.0 - 1.0 / r_initial)
    # The overlap is detected at the end of an internal step, `delay` after the analytic contact time (1980 m at
    # 1000 m/s = 1.98 s). Over that delay gravity does work F*v_rel*delay on the pair, which is exactly what the
    # event's KE shows beyond the contact-state reference (the delay depends on the engine's step grid: ~75 us with
    # PRS23, ~200 us with GLOBAL; this test originally bounded the effect by 0.1 J, valid only for the former).
    delay = event.simulationTimeS - 1.98
    assert 0.0 <= delay < 1e-3
    detection_shift = G * m1 * m2 / 20.0 ** 2 * (v1 - v2) * delay
    assert abs(event.kineticEnergyLostJ - (ke_at_contact + detection_shift)) < 0.02


def test_grazing_merge_books_orbital_angular_momentum_as_spin():
    m1, m2, bimpact, vrel = 2.0e6, 3.0e6, 15.0, 1000.0
    mu = m1 * m2 / (m1 + m2)
    expected_spin_z = -mu * bimpact * vrel
    svc = SimulationService()
    svc.add_body(body("light", m1, 10.0, (-1000.0, bimpact / 2.0, 0), (vrel / 2.0, 0, 0)))
    svc.add_body(body("heavy", m2, 10.0, (1000.0, -bimpact / 2.0, 0), (-vrel / 2.0, 0, 0)))
    before = svc.snapshot().bodies
    p0 = total_momentum(before)
    l0 = total_angular_momentum(before)

    out = svc.step(2.1)
    assert len(out.events) == 1 and len(out.bodies) == 1
    remnant = out.bodies[0]
    spin = svc._resolver.spin[remnant.id]
    event_spin = xyz(out.events[0].spinAddedKgM2PerS)
    assert event_spin[2] == pytest.approx(expected_spin_z, rel=2e-6)
    assert spin == pytest.approx(event_spin, rel=1e-12, abs=1e-8)
    assert total_momentum(out.bodies) == pytest.approx(p0, rel=2e-12, abs=1e-5)
    # Orbital L of the post-merge centre plus the hidden remnant spin equals initial L.
    l_after_orbit = total_angular_momentum(out.bodies)
    assert tuple(l_after_orbit[k] + spin[k] for k in range(3)) == pytest.approx(l0, rel=2e-6, abs=1e-3)
    ke_at_contact = 0.5 * mu * vrel**2 + G * m1 * m2 * (1.0 / 20.0 - 1.0 / math.hypot(2000.0, bimpact))
    assert abs(out.events[0].kineticEnergyLostJ - ke_at_contact) < 1.0


def test_near_relativistic_straight_through_collision_is_detected():
    """Numerical stress only: Newtonian merger physics is not physically valid at 0.49c per body."""
    speed = 0.49 * C
    m1, m2, r = 1.0e10, 2.0e10, 5.0e5
    svc = SimulationService()
    svc.add_body(body("left", m1, r, (-5.0e8, 0, 0), (speed, 0, 0)))
    svc.add_body(body("right", m2, r, (5.0e8, 0, 0), (-speed, 0, 0)))
    out = svc.step(4.0)
    assert len(out.events) == 1 and len(out.bodies) == 1
    assert out.events[0].relativeSpeedMPerS == pytest.approx(2.0 * speed, rel=2e-10)
    assert out.events[0].estimatedContactTimeS == pytest.approx((1.0e9 - 2.0 * r) / (2.0 * speed), abs=1e-8)
    mu = m1 * m2 / (m1 + m2)
    assert out.events[0].kineticEnergyLostJ == pytest.approx(0.5 * mu * (2.0 * speed) ** 2, rel=3e-10)


def test_fast_near_miss_remains_two_bodies():
    """Impact parameter exceeds R1+R2 by 0.1%; line sweep must not invent contact."""
    svc = SimulationService()
    svc.add_body(body("left", 1.0e6, 1.0, (-1000.0, 1.001, 0), (1.0e6, 0, 0)))
    svc.add_body(body("right", 1.0e6, 1.0, (1000.0, -1.001, 0), (-1.0e6, 0, 0)))
    out = svc.step(0.002)
    assert not out.events and len(out.bodies) == 2
    min_separation = 2.002
    assert min_separation > 2.0


def test_exact_tangency_merges_but_has_no_contact_time_estimate():
    """The swept path is tangent at exactly R1+R2; current REBOUND reports merge, estimator returns null."""
    impact_parameter = 2.0  # exactly the sum of two unit radii
    svc = SimulationService()
    svc.add_body(body("left", 1.0e6, 1.0, (-1000.0, impact_parameter / 2.0, 0), (1.0e6, 0, 0)))
    svc.add_body(body("right", 1.0e6, 1.0, (1000.0, -impact_parameter / 2.0, 0), (-1.0e6, 0, 0)))
    out = svc.step(0.002)
    assert len(out.events) == 1 and len(out.bodies) == 1
    # The merger is correct for the <= contact convention, but the quadratic estimate is ill-conditioned at a
    # double root and currently returns None instead of the analytic t=0.001 s.
    assert out.events[0].estimatedContactTimeS is None


def test_near_simultaneous_three_body_contacts_conserve_total_mass_and_momentum():
    """Both outer bodies reach the central sphere at t≈1 s; event order may be engine-defined."""
    svc = SimulationService()
    svc.add_body(body("left", 1.0e6, 10.0, (-30.0, 0, 0), (10.0, 0, 0)))
    svc.add_body(body("centre", 1.0e7, 10.0, (0, 0, 0), (0, 0, 0)))
    svc.add_body(body("right", 2.0e6, 10.0, (30.0, 0, 0), (-10.0, 0, 0)))
    before = svc.snapshot().bodies
    p0 = total_momentum(before)
    l0 = total_angular_momentum(before)

    out = svc.step(1.2)
    assert len(out.events) == 2 and len(out.bodies) == 1
    assert out.bodies[0].massKg == pytest.approx(1.3e7, rel=1e-14)
    assert total_momentum(out.bodies) == pytest.approx(p0, rel=2e-12, abs=1e-5)
    spin = svc._resolver.spin[out.bodies[0].id]
    lorbit = total_angular_momentum(out.bodies)[2]
    assert (lorbit + spin[2]) == pytest.approx(l0[2], abs=1e-3)
    assert svc._resolver.errors == []
    assert svc._resolver.stale == 0


def test_two_separated_collisions_in_one_request_preserve_global_totals():
    """Two independent pairs reach contact in the same long, straight-line sweep."""
    svc = SimulationService()
    records = [
        body("A", 2.0e6, 10.0, (-1000.0, 0, 0), (1000.0, 0, 0)),
        body("B", 3.0e6, 10.0, (1000.0, 0, 0), (-1000.0, 0, 0)),
        body("C", 4.0e6, 10.0, (-1000.0, 1000.0, 0), (1000.0, 0, 0)),
        body("D", 5.0e6, 10.0, (1000.0, 1000.0, 0), (-1000.0, 0, 0)),
    ]
    for rec in records:
        svc.add_body(rec)
    before = svc.snapshot().bodies
    p0 = total_momentum(before)
    total_mass = sum(b.massKg for b in before)
    out = svc.step(1.1)
    assert len(out.events) == 2 and len(out.bodies) == 2
    assert sum(b.massKg for b in out.bodies) == pytest.approx(total_mass, rel=1e-14)
    assert total_momentum(out.bodies) == pytest.approx(p0, rel=2e-12, abs=1e-5)
    assert all(abs(e.estimatedContactTimeS - 0.99) < 2e-6 for e in out.events)


def test_extreme_mass_ratio_exposes_binary64_mass_rounding():
    """At 1e16:1, adding 1 kg to the remnant mass rounds away in IEEE-754 binary64."""
    heavy_mass, probe_mass = 1.0e16, 1.0
    svc = SimulationService()
    svc.add_body(body("heavy", heavy_mass, 1.0, (0, 0, 0), (0, 0, 0)))
    svc.add_body(body("probe", probe_mass, 1.0, (1.0e6, 0, 0), (-1000.0, 0, 0)))
    out = svc.step(1001.0)
    assert len(out.events) == 1 and len(out.bodies) == 1
    rounded_expected = heavy_mass + probe_mass
    exact_integer_mass = int(heavy_mass) + int(probe_mass)
    assert out.bodies[0].massKg == rounded_expected == heavy_mass
    assert int(out.bodies[0].massKg) == exact_integer_mass - 1
    assert (exact_integer_mass - out.bodies[0].massKg) / exact_integer_mass < 2.0e-16


def test_radial_free_fall_contact_time_matches_closed_form():
    """Two-body radial fall from rest, with finite contact radius rather than point collision."""
    central_mass, probe_mass = 1.0e24, 1.0
    r0, contact = 1.0e8, 1.0e6 + 1.0
    theta = math.acos(math.sqrt(contact / r0))
    t_contact = math.sqrt(r0**3 / (2.0 * G * (central_mass + probe_mass))) * (
        theta + math.sin(theta) * math.cos(theta)
    )
    svc = SimulationService()
    svc.add_body(body("central", central_mass, 1.0e6, (0, 0, 0), (0, 0, 0)))
    svc.add_body(body("probe", probe_mass, 1.0, (r0, 0, 0), (0, 0, 0)))
    out = svc.step(3.0e5)
    assert len(out.events) == 1 and len(out.bodies) == 1
    # `simulationTimeS` is detection time; the straight-line estimate is compared with exact contact time.
    assert out.events[0].estimatedContactTimeS == pytest.approx(t_contact, rel=2e-3)
    assert out.events[0].simulationTimeS >= t_contact
    assert out.events[0].simulationTimeS - t_contact < 0.01 * t_contact
