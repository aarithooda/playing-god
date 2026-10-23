"""P-003 stress tests: strongly curved binary orbits, many simultaneous collisions, extreme mass ratios.

All scenarios are deterministic (explicit initial conditions or a seeded generator) and use SI units. Expected
values come from closed forms (Kepler's equation, vis-viva, conservation laws), never from REBOUND output.
Tolerance classes (derived, not tuned):
- smooth IAS15 orbits: position 1e-9 a, energy and angular-momentum drift 1e-10 relative (M0 and the independent
  review observed 1e-13..1e-15; the margin covers platform differences);
- merger mass/momentum: floating-point round-off, 1e-12 relative to sum |m v| (1e-11 after a cascade of merges);
- contact-time estimate: the layer assumes a straight relative path inside the last internal step. The service
  limits curvature per chunk to 1% of the contact distance R, so the estimate may be off by the time to travel
  about 0.02 R at the contact speed (2x margin on the 1% criterion);
- speed at detection: the overlap is detected at the end of an internal step, slightly inside R, so speeds taken
  from the event differ from the speed at exactly R by (dv/dr) * overshoot (<= 1e-5 relative in these scenarios).
"""
import logging
import math
import random

import pytest

from backend.models import BodyCreate
from backend.simulation import SimulationService

G = 6.67430e-11


def make(name="b", m=1.0, r=1.0, x=(0.0, 0.0, 0.0), v=(0.0, 0.0, 0.0)) -> BodyCreate:
    return BodyCreate(name=name, massKg=m, radiusM=r, positionM=dict(zip("xyz", x)),
                      velocityMPerS=dict(zip("xyz", v)), colorHex="#ffffff")


@pytest.fixture
def svc():
    return SimulationService()


@pytest.fixture(autouse=True)
def no_engine_warnings(caplog):
    """The service logs any REBOUND warning (e.g. IAS15 non-convergence) instead of failing the step. In these
    scenarios such a warning would be a finding, so it fails the test."""
    caplog.set_level(logging.WARNING, logger="backend.simulation")
    yield
    bad = [r.getMessage() for r in caplog.records if "REBOUND warning" in r.getMessage()]
    assert bad == []


def vec(d):
    return [d.x, d.y, d.z]


def sub(a, b):
    return [p - q for p, q in zip(a, b)]


def norm(a):
    return math.sqrt(sum(c * c for c in a))


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def momentum(state):
    return [sum(b.massKg * vec(b.velocityMPerS)[k] for b in state.bodies) for k in range(3)]


def p_scale(state):
    return sum(b.massKg * norm(vec(b.velocityMPerS)) for b in state.bodies)


def total_mass(state):
    return sum(b.massKg for b in state.bodies)


# =====================================================================================================
# 1. Strongly curved binary orbits
# =====================================================================================================
def add_binary_at_apoapsis(svc, m1, m2, a, e, r1, r2):
    """Barycentric binary starting at apoapsis on the x axis, counter-clockwise. Returns (id1, id2, GM, T)."""
    big_m = m1 + m2
    gm = G * big_m
    r_apo = a * (1 + e)
    v_rel = math.sqrt(gm * (1 - e) / (a * (1 + e)))  # vis-viva at apoapsis
    b1 = svc.add_body(make("one", m1, r1, x=(-m2 / big_m * r_apo, 0, 0), v=(0, -m2 / big_m * v_rel, 0)))
    b2 = svc.add_body(make("two", m2, r2, x=(m1 / big_m * r_apo, 0, 0), v=(0, m1 / big_m * v_rel, 0)))
    return b1.id, b2.id, gm, 2 * math.pi * math.sqrt(a ** 3 / gm)


def pair_invariants(state, m1, m2):
    b1, b2 = state.bodies
    rel = sub(vec(b2.positionM), vec(b1.positionM))
    vrel = sub(vec(b2.velocityMPerS), vec(b1.velocityMPerS))
    mu = m1 * m2 / (m1 + m2)
    energy = 0.5 * mu * norm(vrel) ** 2 - G * m1 * m2 / norm(rel)
    ang = mu * norm(cross(rel, vrel))
    return energy, ang, rel


def test_eccentric_binary_three_periods_conserves_and_returns_to_apoapsis(svc):
    """e = 0.6 (periapsis 0.4 a = 400 m, >10x the contact distance 30 m), m = 5e12 + 1e12 kg, a = 1000 m,
    T = 2 pi sqrt(a^3/GM) ~ 9.9e3 s. After T/2 the separation is the periapsis a(1-e), on the opposite side; after
    each full period the relative position returns to its start. E = -G m1 m2 / 2a and L = mu sqrt(GM a (1-e^2))."""
    m1, m2, a, e = 5e12, 1e12, 1000.0, 0.6
    _, _, gm, period = add_binary_at_apoapsis(svc, m1, m2, a, e, 20.0, 10.0)
    e0, l0, rel0 = pair_invariants(svc.snapshot(), m1, m2)
    assert e0 == pytest.approx(-G * m1 * m2 / (2 * a), rel=1e-12)
    assert l0 == pytest.approx(m1 * m2 / (m1 + m2) * math.sqrt(gm * a * (1 - e ** 2)), rel=1e-12)

    half = svc.step(period / 2)
    _, _, rel_half = pair_invariants(half, m1, m2)
    assert norm(rel_half) == pytest.approx(a * (1 - e), rel=1e-9)
    assert rel_half[0] == pytest.approx(-a * (1 - e), rel=1e-9)  # periapsis lies opposite the start point

    svc.step(period / 2)
    for k in (1, 2, 3):
        if k > 1:
            svc.step(period)
        s = svc.snapshot()
        en, ang, rel = pair_invariants(s, m1, m2)
        assert norm(sub(rel, rel0)) < 1e-9 * a, f"period {k}"
        assert abs(en / e0 - 1) < 1e-10 and abs(ang / l0 - 1) < 1e-10, f"period {k}"
        assert len(s.bodies) == 2 and svc.events() == []


def kepler_time_apoapsis_to_separation(a, e, gm, r):
    """Time for a bound orbit to fall from apoapsis to centre separation r (>= periapsis), via Kepler's equation."""
    ecc_anomaly = math.acos((1 - r / a) / e)  # r = a(1 - e cos E)
    n = math.sqrt(gm / a ** 3)
    return (math.pi - (ecc_anomaly - e * math.sin(ecc_anomaly))) / n


def test_bound_orbit_with_periapsis_inside_contact_distance_merges_at_kepler_time(svc):
    """e = 0.9, a = 1000 m: periapsis 100 m < contact distance R = 150 m, so the pair merges on its first
    pericentre approach after ~T/2 (a strongly curved, accelerating path: the speed at contact is ~2x the apoapsis
    speed). Reference: Kepler's equation from apoapsis to separation R. The request spans a full period."""
    m1, m2, a, e, big_r = 5e12, 1e12, 1000.0, 0.9, 150.0
    id1, id2, gm, period = add_binary_at_apoapsis(svc, m1, m2, a, e, 100.0, 50.0)
    p0, mass0 = momentum(svc.snapshot()), total_mass(svc.snapshot())
    t_contact = kepler_time_apoapsis_to_separation(a, e, gm, big_r)
    v_contact = math.sqrt(gm * (2 / big_r - 1 / a))  # vis-viva
    mu = m1 * m2 / (m1 + m2)

    out = svc.step(period)
    assert len(out.events) == 1 and len(out.bodies) == 1
    ev = out.events[0]
    assert ev.bodyIds == [id1, id2] and ev.resultBodyId == id1  # heavier body survives
    assert ev.estimatedContactTimeS is not None
    assert abs(ev.estimatedContactTimeS - t_contact) <= 0.02 * big_r / v_contact
    assert ev.simulationTimeS >= t_contact  # detected at the end of an internal step, never before contact
    # The overlap is detected up to one internal IAS15 step (several seconds here) after contact, with the pair
    # already inside R and still accelerating, so the reported speed lies between the speed at R and at periapsis.
    v_periapsis = math.sqrt(gm * (2 / (a * (1 - e)) - 1 / a))
    assert v_contact * (1 - 1e-9) <= ev.relativeSpeedMPerS <= v_periapsis
    assert out.bodies[0].massKg == mass0
    assert norm(sub(momentum(out), p0)) < 1e-11 * mu * v_contact


@pytest.mark.parametrize("clearance", [1.05, 1.5])
def test_bound_orbit_just_missing_contact_never_merges_over_three_periapses(svc, clearance):
    """Periapsis = clearance * R with R = 150 m (e = 1 - clearance*R/a), so the separation dips to 5% / 50% above
    the contact distance three times. `line` detection must not report a false merger on the curved chord, and the
    orbit must close. One request covers all three periods (the service subdivides it into chunks)."""
    m1, m2, a, big_r = 5e12, 1e12, 1000.0, 150.0
    e = 1 - clearance * big_r / a
    _, _, _, period = add_binary_at_apoapsis(svc, m1, m2, a, e, 100.0, 50.0)
    e0, l0, rel0 = pair_invariants(svc.snapshot(), m1, m2)
    out = svc.step(3 * period)
    assert out.events == [] and len(out.bodies) == 2
    en, ang, rel = pair_invariants(out, m1, m2)
    assert abs(en / e0 - 1) < 1e-9 and abs(ang / l0 - 1) < 1e-9
    assert norm(sub(rel, rel0)) < 1e-8 * a


def test_hyperbolic_flyby_of_a_planet_by_a_probe_matches_the_conic(svc):
    """Probe (1 kg) passes a 1e24 kg planet (radius 6e6 m, mass ratio 1e24) with v_inf = 5000 m/s and impact
    parameter b = 1e7 m: e = sqrt(1 + (b v_inf^2/GM)^2) ~ 3.9, periapsis ~ 7.7e6 m > R. Start and end at r0 = 5e9 m;
    by symmetry the end state is the start mirrored about the periapsis axis. The elapsed time is the hyperbolic
    Kepler equation. The planet is the focus (its motion is ~1e-24 of the probe's)."""
    gm, v_inf, b, r0, big_r = G * 1e24, 5000.0, 1e7, 5e9, 6e6
    a_h = gm / v_inf ** 2
    ecc = math.sqrt(1 + (b / a_h) ** 2)
    p = a_h * (ecc ** 2 - 1)
    assert a_h * (ecc - 1) > 1.2 * big_r  # periapsis clears the planet
    theta0 = math.acos((p / r0 - 1) / ecc)  # true anomaly at r0 (incoming = -theta0)
    h = b * v_inf
    v_t = h / r0
    v_r = -math.sqrt(v_inf ** 2 + 2 * gm / r0 - v_t ** 2)  # inbound
    rhat, that = (math.cos(-theta0), math.sin(-theta0)), (-math.sin(-theta0), math.cos(-theta0))
    pos = (r0 * rhat[0], r0 * rhat[1], 0.0)
    vel = (v_r * rhat[0] + v_t * that[0], v_r * rhat[1] + v_t * that[1], 0.0)
    svc.add_body(make("planet", 1e24, big_r))
    probe = svc.add_body(make("probe", 1.0, 1.0, x=pos, v=vel))

    def hyperbolic_time(theta):  # time from periapsis
        f = 2 * math.atanh(math.sqrt((ecc - 1) / (ecc + 1)) * math.tan(theta / 2))
        return (ecc * math.sinh(f) - f) / math.sqrt(gm / a_h ** 3)

    duration = 2 * hyperbolic_time(theta0)
    for _ in range(4):  # several requests, so stepping across periapsis is not a single lucky large step
        out = svc.step(duration / 4)
    assert out.events == [] and len(out.bodies) == 2
    final = next(x for x in out.bodies if x.id == probe.id)
    expected_pos = (r0 * math.cos(theta0), r0 * math.sin(theta0), 0.0)
    assert norm(sub(vec(final.positionM), expected_pos)) < 1e-8 * r0
    v_final = vec(final.velocityMPerS)
    assert 0.5 * norm(v_final) ** 2 - gm / norm(vec(final.positionM)) == pytest.approx(0.5 * v_inf ** 2, rel=1e-9)
    assert norm(cross(vec(final.positionM), v_final)) == pytest.approx(h, rel=1e-9)


def test_chunk_cap_does_not_corrupt_a_long_orbit_request(svc):
    """The service subdivides a step into at most MAX_CHUNKS_PER_STEP chunks. A circular orbit (r = 1000 m, contact
    distance 2 m, so no collision is possible) requested for 1000 periods in ONE call needs more chunks than the cap
    allows at the 1% curvature criterion, so chunks are stretched to dt/2000 (half a period). The orbit itself is
    still integrated by IAS15 inside each chunk: it must stay closed and conserve energy."""
    m1, m2, r = 1e12, 1e9, 1000.0
    _, _, _, period = add_binary_at_apoapsis(svc, m1, m2, r, 0.0, 1.0, 1.0)
    e0, l0, rel0 = pair_invariants(svc.snapshot(), m1, m2)
    out = svc.step(1000 * period)
    assert out.events == [] and len(out.bodies) == 2
    en, ang, rel = pair_invariants(out, m1, m2)
    assert abs(en / e0 - 1) < 1e-8 and abs(ang / l0 - 1) < 1e-8
    assert norm(sub(rel, rel0)) < 1e-6 * r


# =====================================================================================================
# 2. More than three simultaneous collisions
# =====================================================================================================
def converging_ring(svc, n, ring_radius, speed, mass, radius):
    for i in range(n):
        ang = 2 * math.pi * i / n
        d = (math.cos(ang), math.sin(ang), 0.0)
        svc.add_body(make(f"ring{i}", mass, radius, x=tuple(ring_radius * c for c in d),
                          v=tuple(-speed * c for c in d)))


@pytest.mark.parametrize("n", [4, 6, 12])
def test_symmetric_ring_collapses_into_one_body_at_the_centre(svc, n):
    """n equal bodies (1e6 kg, radius 5 m) on a ring of radius 100 m, each moving radially inward at 10 m/s. By
    symmetry the net momentum is 0 and the centre of mass stays at the origin, so every merge keeps the remnant
    there. Adjacent bodies touch before opposite ones, so all contacts fall within a fraction of a second of one
    another. Expected: exactly n-1 mergers, one body of mass n*m at rest at the origin (mutual gravity,
    ~1e-10 m/s^2, is negligible against 10 m/s)."""
    ring_radius, speed, m = 100.0, 10.0, 1e6
    converging_ring(svc, n, ring_radius, speed, m, 5.0)
    out = svc.step(ring_radius / speed + 5.0)
    events = svc.events()
    assert len(events) == n - 1 and len(out.bodies) == 1
    (rem,) = out.bodies
    assert rem.massKg == n * m
    assert norm(vec(rem.positionM)) < 1e-6 and norm(vec(rem.velocityMPerS)) < 1e-9
    absorbed = [e.bodyIds[1] for e in events]
    assert len(set(absorbed)) == n - 1 and rem.id not in absorbed  # each body absorbed once, survivor never
    assert [e.id for e in events] == [f"evt-{k}" for k in range(1, n)]
    assert events[-1].resultMassKg == n * m
    assert svc.step(50.0).events == []  # no pending contact is left behind


def homologous_collapse(svc, seed, n=10, tau=40.0):
    """n bodies on a 200..400 m shell (seeded), random masses 1e5..1e7 kg, radius 20 m, velocity -x/tau: all reach
    the origin together at t = tau whatever their mass (gravity ~1e-9 m/s^2 is negligible)."""
    rnd = random.Random(seed)
    for i in range(n):
        d = [rnd.gauss(0, 1) for _ in range(3)]
        shell = rnd.uniform(200.0, 400.0)
        pos = [shell * c / norm(d) for c in d]
        svc.add_body(make(f"h{i}", rnd.uniform(1e5, 1e7), 20.0, x=tuple(pos), v=tuple(-c / tau for c in pos)))


def test_homologous_collapse_of_ten_random_bodies_conserves_everything(svc):
    """Ten simultaneous arrivals at one point, seeded (20261024). The order REBOUND reports overlaps is fixed by
    the service's rand_seed, so the outcome is reproducible. Invariants: total mass, momentum, centre-of-mass
    trajectory, one body left, n-1 events; and a second identical run gives the identical event sequence."""
    n, t_end = 10, 60.0
    homologous_collapse(svc, 20261024, n)
    s0 = svc.snapshot()
    mass0, p0, scale = total_mass(s0), momentum(s0), p_scale(s0)
    com0 = [sum(b.massKg * vec(b.positionM)[k] for b in s0.bodies) / mass0 for k in range(3)]
    out = svc.step(t_end)
    assert len(svc.events()) == n - 1 and len(out.bodies) == 1
    (rem,) = out.bodies
    assert rem.massKg == pytest.approx(mass0, rel=1e-13)
    assert norm(sub(momentum(out), p0)) < 1e-11 * scale
    expected_com = [com0[k] + p0[k] / mass0 * t_end for k in range(3)]
    assert norm(sub(vec(rem.positionM), expected_com)) < 1e-6  # merges and internal forces never move the COM

    again = SimulationService()
    homologous_collapse(again, 20261024, n)
    again.step(t_end)

    def key(s):
        return [(e.simulationTimeS, e.resultMassKg, e.relativeSpeedMPerS) for e in s.events()]

    assert key(again) == key(svc)


def test_five_independent_pairs_collide_within_one_chunk(svc):
    """Five well-separated pairs (1 km apart), each closing head-on at 20 m/s from the same gap, so all five contacts
    fall in the same internal step. Five mergers, five survivors, and each pair's mass and momentum are conserved
    separately (not only the global totals). The pairs still attract each other (<= G*35e6 kg/(1 km)^2 * 8 s ~ 2e-8
    m/s), so velocities are compared to 5e-8 m/s, i.e. 5e-9 of the 10 m/s approach speed."""
    pairs = []
    for k in range(5):
        y = 1000.0 * k
        mh = 2e6 * (k + 1)
        heavy = svc.add_body(make(f"H{k}", mh, 2.0, x=(-50.0, y, 0.0), v=(10.0, 0.01 * k, 0.0)))
        light = svc.add_body(make(f"L{k}", 1e6, 1.0, x=(50.0, y, 0.0), v=(-10.0, 0.0, 0.0)))
        pairs.append((heavy.id, light.id, mh, 1e6, 0.01 * k))
    out = svc.step(8.0)
    assert len(out.events) == 5 and len(out.bodies) == 5
    by_id = {b.id: b for b in out.bodies}
    for hid, lid, mh, ml, vyh in pairs:
        assert lid not in by_id and by_id[hid].massKg == mh + ml
        assert by_id[hid].velocityMPerS.x == pytest.approx((mh * 10.0 - ml * 10.0) / (mh + ml), abs=5e-8)
        assert by_id[hid].velocityMPerS.y == pytest.approx(mh * vyh / (mh + ml), abs=5e-8)
    times = [e.simulationTimeS for e in out.events]
    assert max(times) - min(times) < 0.5
    assert svc.step(5.0).events == []


def test_four_body_chain_collision_resolves_over_two_requests(svc):
    """Four bodies on a line converging on a resting second body. A chain can resolve across internal steps (the
    remnant merges with the next body one step later, PHYSICS_SPIKE.md), so only the invariants are asserted:
    exactly three mergers, one body, mass exact, momentum conserved to round-off."""
    xs, vs, ms = [-40.0, 0.0, 12.0, 24.0], [8.0, 0.0, 0.0, -6.0], [3e6, 1e6, 2e6, 4e6]
    for i, (x, v, m) in enumerate(zip(xs, vs, ms)):
        svc.add_body(make(f"c{i}", m, 5.0, x=(x, 0, 0), v=(v, 0, 0)))
    p0 = momentum(svc.snapshot())
    svc.step(4.0)
    out = svc.step(20.0)
    assert len(svc.events()) == 3 and len(out.bodies) == 1
    assert out.bodies[0].massKg == sum(ms)
    assert norm(sub(momentum(out), p0)) < 1e-11 * sum(m * abs(v) for m, v in zip(ms, vs))


# =====================================================================================================
# 3. Extreme mass ratios
# =====================================================================================================
def test_one_kg_probe_around_a_solar_mass_body_closes_a_circular_orbit(svc):
    """Mass ratio 2e30 : 1 (Sun and a 1 kg probe), circular orbit at 1 AU. Period from Kepler's third law with
    G(M+m). Over one period the probe returns to its start and its specific energy is -GM/2a. Double precision
    resolves 1.5e11 m to ~3e-5 m, so the tolerance 1e-8 a = 1.5e3 m is generous."""
    big, small, a = 1.98847e30, 1.0, 1.495978707e11
    gm = G * (big + small)
    svc.add_body(make("sun", big, 6.9634e8))
    probe = svc.add_body(make("probe", small, 1.0, x=(a, 0, 0), v=(0, math.sqrt(gm / a), 0)))
    period = 2 * math.pi * math.sqrt(a ** 3 / gm)
    quarter = svc.step(period / 4)
    q = next(b for b in quarter.bodies if b.id == probe.id)
    assert q.positionM.y == pytest.approx(a, rel=1e-8)  # a quarter period later: on the +y axis
    out = svc.step(3 * period / 4)
    p = next(b for b in out.bodies if b.id == probe.id)
    assert norm(sub(vec(p.positionM), [a, 0, 0])) < 1e-8 * a
    spec_e = 0.5 * norm(vec(p.velocityMPerS)) ** 2 - gm / norm(vec(p.positionM))
    assert spec_e == pytest.approx(-gm / (2 * a), rel=1e-9)
    assert out.events == []


@pytest.mark.parametrize("probe_first", [False, True])
def test_one_kg_probe_merges_into_a_1e12_kg_body_exactly(svc, probe_first):
    """Mass ratio 1e12 : 1. Both masses and their sum are exactly representable in binary64 (< 2^53), so the
    remnant mass must be EXACTLY 1e12 + 1. The probe (300 m/s at 200 m) hits a body at rest. Total momentum is
    m*v exactly, so v_com = m v / (M + m) to round-off. The heavy body keeps its id whichever was created first.
    Gravity speeds the probe up (v_rel^2 = v0^2 + 2 G (M+m) (1/R - 1/r0)), which the event speed must match."""
    big, small, v0, r0, big_r = 1e12, 1.0, 300.0, 200.0, 10.5
    if probe_first:
        probe = svc.add_body(make("probe", small, 0.5, x=(-r0, 0, 0), v=(v0, 0, 0)))
        heavy = svc.add_body(make("heavy", big, 10.0))
    else:
        heavy = svc.add_body(make("heavy", big, 10.0))
        probe = svc.add_body(make("probe", small, 0.5, x=(-r0, 0, 0), v=(v0, 0, 0)))
    out = svc.step(2.0)
    assert len(out.events) == 1 and [b.id for b in out.bodies] == [heavy.id]
    ev, rem = out.events[0], out.bodies[0]
    assert ev.bodyIds == [heavy.id, probe.id] and ev.resultMassKg == big + small == rem.massKg
    assert rem.velocityMPerS.x == pytest.approx(small * v0 / (big + small), rel=1e-6)  # includes gravity's pull
    v_contact = math.sqrt(v0 ** 2 + 2 * G * (big + small) * (1 / big_r - 1 / r0))
    assert ev.relativeSpeedMPerS == pytest.approx(v_contact, rel=1e-5)
    mu = big * small / (big + small)
    assert ev.kineticEnergyLostJ == pytest.approx(0.5 * mu * ev.relativeSpeedMPerS ** 2, rel=1e-12)


def test_mass_ratio_beyond_binary64_loses_the_light_body_but_conserves_momentum(svc):
    """Mass ratio 1e17 : 1. binary64 spacing at 1e17 is 16 kg, so M + 1 kg rounds back to (within an ulp of) M:
    the stored mass cannot be exact (a documented limitation, found by the independent review at 1e16 : 1). What
    must still hold: the step succeeds, the light body is absorbed, the mass is within one ulp, and the total
    momentum (1 kg * 1000 m/s initially) is conserved to round-off."""
    big, small, v = 1e17, 1.0, 1e3
    heavy = svc.add_body(make("heavy", big, 1e3))
    svc.add_body(make("probe", small, 1.0, x=(-1e5, 0, 0), v=(v, 0, 0)))
    out = svc.step(300.0)
    assert len(out.events) == 1 and [b.id for b in out.bodies] == [heavy.id]
    rem = out.bodies[0]
    assert abs(rem.massKg - (big + small)) <= math.ulp(big) and out.events[0].resultMassKg == rem.massKg
    assert rem.massKg * rem.velocityMPerS.x == pytest.approx(small * v, rel=1e-12)
