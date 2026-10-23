"""Physical correctness of backend/diagnostics.py (SI units). Serialization/API tests live elsewhere.

Reference values are closed forms or exact-arithmetic oracles written here, never the function under test.
Tolerances: closed forms at t=0 are limited by round-off only (1e-12 relative); integrated drift uses the 1e-10
bound already used for IAS15 orbits in tests/test_simulation_service.py.
"""
import copy
import json
import math
import random
from decimal import Decimal, getcontext
from fractions import Fraction

import pytest

from backend.diagnostics import DIAGNOSTICS_VERSION, compute_diagnostics
from backend.models import BodyCreate
from backend.simulation import SimulationService

G = 6.67430e-11
ZERO = (0.0, 0.0, 0.0)


def vec(d):
    return (d["x"], d["y"], d["z"])


def snap(svc):
    """Diagnostics of the service's current public state."""
    return compute_diagnostics([(b.massKg, (b.positionM.x, b.positionM.y, b.positionM.z),
                                 (b.velocityMPerS.x, b.velocityMPerS.y, b.velocityMPerS.z))
                                for b in svc.snapshot().bodies], [], G)


def add(svc, m, r, x, v):
    return svc.add_body(BodyCreate(name="b", massKg=m, radiusM=r, positionM=dict(zip("xyz", x)),
                                   velocityMPerS=dict(zip("xyz", v)), colorHex="#ffffff"))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


# ---------- exact-arithmetic oracle (Fraction for polynomial sums, 50-digit Decimal for the 1/r sum) ----------
def oracle(bodies):
    fr = lambda xs: [Fraction(x) for x in xs]  # noqa: E731
    m = [Fraction(b[0]) for b in bodies]
    r = [fr(b[1]) for b in bodies]
    v = [fr(b[2]) for b in bodies]
    mass = sum(m, Fraction(0))
    mom = [sum((m[i] * v[i][k] for i in range(len(m))), Fraction(0)) for k in range(3)]
    ke = sum((m[i] * sum(c * c for c in v[i]) / 2 for i in range(len(m))), Fraction(0))
    ang = [sum((m[i] * cross(r[i], v[i])[k] for i in range(len(m))), Fraction(0)) for k in range(3)]
    getcontext().prec = 50
    pe = Decimal(0)
    for i in range(len(m)):
        for j in range(i + 1, len(m)):
            d2 = sum((Decimal(bodies[i][1][k]) - Decimal(bodies[j][1][k])) ** 2 for k in range(3))
            pe -= Decimal(G) * Decimal(bodies[i][0]) * Decimal(bodies[j][0]) / d2.sqrt()
    return float(mass), [float(c) for c in mom], float(ke), float(pe), [float(c) for c in ang]


def rel(a, b):
    return abs(a - b) / abs(b) if b else abs(a)


# ---------- single body ----------
def test_single_body_values_and_exact_drift():
    svc = SimulationService()
    add(svc, 7.0, 1.0, (1.0e3, -2.0e3, 3.0e3), (4.0, 5.0, -6.0))
    d = snap(svc)
    assert d["version"] == DIAGNOSTICS_VERSION
    assert d["totalMassKg"] == 7.0
    assert vec(d["totalMomentumKgMPerS"]) == (28.0, 35.0, -42.0)
    assert d["kineticEnergyJ"] == 0.5 * 7.0 * (16 + 25 + 36)
    assert d["potentialEnergyJ"] == 0.0
    # r x v = (-2e3*-6 - 3e3*5, 3e3*4 - 1e3*-6, 1e3*5 - -2e3*4) = (-3e3, 1.8e4, 1.3e4)
    assert vec(d["angularMomentumAboutOriginKgM2PerS"]) == pytest.approx((-21000.0, 126000.0, 91000.0), rel=1e-15)
    assert vec(d["bookedSpinKgM2PerS"]) == (0.0, 0.0, 0.0)
    svc.step(1000.0)  # lone body drifts exactly; P, K, L are unchanged
    d2 = snap(svc)
    assert vec(d2["totalMomentumKgMPerS"]) == vec(d["totalMomentumKgMPerS"])
    assert d2["kineticEnergyJ"] == d["kineticEnergyJ"]
    assert vec(d2["angularMomentumAboutOriginKgM2PerS"]) == pytest.approx(
        vec(d["angularMomentumAboutOriginKgM2PerS"]), rel=1e-12)


# ---------- two-body closed forms (centre-of-mass frame) ----------
def two_body(svc, M, m, rp, a_sma):
    """Bodies at periapsis separation rp of an orbit with semi-major axis a_sma, momentum zero, along +x / +y."""
    mu = M * m / (M + m)
    v_rel = math.sqrt(G * (M + m) * (2.0 / rp - 1.0 / a_sma))
    add(svc, M, 1.0e3, (-m / (M + m) * rp, 0.0, 0.0), (0.0, -m / (M + m) * v_rel, 0.0))
    add(svc, m, 1.0e3, (M / (M + m) * rp, 0.0, 0.0), (0.0, M / (M + m) * v_rel, 0.0))
    return mu, v_rel


@pytest.mark.parametrize("e", [0.0, 0.5])
def test_two_body_orbit_matches_closed_forms_and_conserves(e):
    M, m, a = 1.98847e30, 5.9722e24, 1.495978707e11
    rp = a * (1.0 - e)
    svc = SimulationService()
    mu, v_rel = two_body(svc, M, m, rp, a)
    d = snap(svc)
    assert rel(d["totalMassKg"], M + m) < 1e-15
    assert max(abs(c) for c in vec(d["totalMomentumKgMPerS"])) < 1e-12 * m * v_rel  # zero by construction, vs the scale m*v
    assert rel(d["potentialEnergyJ"], -G * M * m / rp) < 1e-12
    assert rel(d["kineticEnergyJ"] + d["potentialEnergyJ"], -G * M * m / (2 * a)) < 1e-9  # cancellation: vs E
    assert rel(vec(d["angularMomentumAboutOriginKgM2PerS"])[2], mu * rp * v_rel) < 1e-12
    e0 = d["kineticEnergyJ"] + d["potentialEnergyJ"]
    l0 = vec(d["angularMomentumAboutOriginKgM2PerS"])[2]
    period = 2 * math.pi * math.sqrt(a ** 3 / (G * (M + m)))
    for _ in range(10):
        svc.step(period / 10)
    d1 = snap(svc)
    assert rel(d1["kineticEnergyJ"] + d1["potentialEnergyJ"], e0) < 1e-10
    assert rel(vec(d1["angularMomentumAboutOriginKgM2PerS"])[2], l0) < 1e-10


# ---------- three equal masses on a rotating equilateral triangle (Lagrange solution) ----------
def test_equilateral_triangle_closed_forms_and_conservation():
    m, s = 1.0e24, 1.0e9
    omega = math.sqrt(3 * G * m / s ** 3)
    rho = s / math.sqrt(3)
    svc = SimulationService()
    for k in range(3):
        th = 2 * math.pi * k / 3
        add(svc, m, 1.0e6, (rho * math.cos(th), rho * math.sin(th), 0.0),
            (-omega * rho * math.sin(th), omega * rho * math.cos(th), 0.0))
    d = snap(svc)
    assert rel(d["potentialEnergyJ"], -3 * G * m * m / s) < 1e-12
    assert rel(d["kineticEnergyJ"], 3 * G * m * m / (2 * s)) < 1e-12
    assert rel(vec(d["angularMomentumAboutOriginKgM2PerS"])[2], m * omega * s * s) < 1e-12
    assert max(abs(c) for c in vec(d["totalMomentumKgMPerS"])) < 1e-12 * 3 * m * omega * rho  # symmetric: P = 0
    e0 = d["kineticEnergyJ"] + d["potentialEnergyJ"]
    for _ in range(5):
        svc.step(1.0e6)  # about 0.36 of a rotation (period ~1.4e7 s)
    d1 = snap(svc)
    assert rel(d1["kineticEnergyJ"] + d1["potentialEnergyJ"], e0) < 1e-10
    assert rel(vec(d1["angularMomentumAboutOriginKgM2PerS"])[2], m * omega * s * s) < 1e-10
    assert max(abs(c) for c in vec(d1["totalMomentumKgMPerS"])) < 1e-10 * 3 * m * omega * rho


# ---------- exact oracle on random configurations ----------
@pytest.mark.parametrize("seed", range(5))
def test_random_systems_match_exact_arithmetic(seed):
    rng = random.Random(seed)
    n = rng.randint(3, 10)
    bodies = [(10 ** rng.uniform(3, 30), tuple(rng.uniform(-1e11, 1e11) for _ in range(3)),
               tuple(rng.uniform(-3e4, 3e4) for _ in range(3))) for _ in range(n)]
    d = compute_diagnostics(bodies, [], G)
    mass, mom, ke, pe, ang = oracle(bodies)
    p_scale = sum(b[0] * math.hypot(*b[2]) for b in bodies)
    l_scale = sum(b[0] * math.hypot(*b[1]) * math.hypot(*b[2]) for b in bodies)
    assert rel(d["totalMassKg"], mass) < 4 * n * 2.0 ** -53
    assert rel(d["kineticEnergyJ"], ke) < 8 * n * 2.0 ** -53
    assert rel(d["potentialEnergyJ"], pe) < 1e-14 * n
    for k, ax in enumerate("xyz"):
        assert abs(d["totalMomentumKgMPerS"][ax] - mom[k]) <= 1e-15 * p_scale
        assert abs(d["angularMomentumAboutOriginKgM2PerS"][ax] - ang[k]) <= 1e-15 * l_scale


def test_result_is_independent_of_body_order_and_does_not_mutate_inputs():
    rng = random.Random(7)
    bodies = [(10 ** rng.uniform(3, 30), tuple(rng.uniform(-1e11, 1e11) for _ in range(3)),
               tuple(rng.uniform(-3e4, 3e4) for _ in range(3))) for _ in range(8)]
    spins = [(1.0, 2.0, 3.0), (-4.0, 5.0, 6.0)]
    before = copy.deepcopy((bodies, spins))
    a = compute_diagnostics(bodies, spins, G)
    assert (bodies, spins) == before
    shuffled = bodies[:]
    random.Random(1).shuffle(shuffled)
    assert compute_diagnostics(shuffled, spins[::-1], G) == a  # bitwise: fsum + symmetric pair terms


def test_booked_spin_is_the_vector_sum():
    d = compute_diagnostics([], [(1.0, 2.0, 3.0), (-4.0, 5.0, 6.0)], G)
    assert vec(d["bookedSpinKgM2PerS"]) == (-3.0, 7.0, 9.0)


# ---------- undefined and degenerate configurations ----------
def test_empty_system_is_all_zero_not_null():
    d = compute_diagnostics([], [], G)
    assert d == {"version": 1, "totalMassKg": 0.0, "totalMomentumKgMPerS": {"x": 0.0, "y": 0.0, "z": 0.0},
                 "kineticEnergyJ": 0.0, "potentialEnergyJ": 0.0,
                 "angularMomentumAboutOriginKgM2PerS": {"x": 0.0, "y": 0.0, "z": 0.0},
                 "bookedSpinKgM2PerS": {"x": 0.0, "y": 0.0, "z": 0.0}}


def test_coincident_centres_make_only_potential_energy_undefined():
    d = compute_diagnostics([(2.0, ZERO, (1.0, 0.0, 0.0)), (3.0, ZERO, ZERO), (4.0, (9.0, 0.0, 0.0), ZERO)], [], G)
    assert d["potentialEnergyJ"] is None
    assert d["totalMassKg"] == 9.0 and d["kineticEnergyJ"] == 1.0
    assert vec(d["totalMomentumKgMPerS"]) == (2.0, 0.0, 0.0)


def test_overflow_gives_null_for_that_quantity_only():
    d = compute_diagnostics([(1e45, ZERO, ZERO), (1e45, (1e-300, 0.0, 0.0), ZERO)], [], G)
    assert d["potentialEnergyJ"] is None
    assert d["totalMassKg"] == 2e45
    d = compute_diagnostics([(1e300, ZERO, (1e300, 0.0, 0.0))], [], G)  # K overflows, P overflows, mass is fine
    assert d["kineticEnergyJ"] is None and d["totalMomentumKgMPerS"] is None
    assert d["totalMassKg"] == 1e300


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_non_finite_input_never_raises_and_never_leaks(bad):
    bodies = [(1.0, (bad, 0.0, 0.0), (0.0, bad, 0.0)), (2.0, (1.0, 0.0, 0.0), (0.0, 0.0, 0.0))]
    d = compute_diagnostics(bodies, [(bad, 0.0, 0.0)], G)
    assert d["potentialEnergyJ"] is None and d["bookedSpinKgM2PerS"] is None
    assert d["angularMomentumAboutOriginKgM2PerS"] is None  # all-or-nothing vectors
    json.dumps(d, allow_nan=False)  # raises on any NaN/Infinity


def test_every_degenerate_case_is_strict_json():
    cases = [[], [(1.0, ZERO, ZERO)], [(1.0, ZERO, ZERO), (1.0, ZERO, ZERO)],
             [(1e45, ZERO, ZERO), (1e45, (1e-300, 0.0, 0.0), ZERO)]]
    for c in cases:
        json.dumps(compute_diagnostics(c, [], G), allow_nan=False)


def test_zero_quantities_are_positive_zero_never_negative_zero():
    """-g * 0.0 is -0.0, which JSON would print as "-0.0" and a UI could show as "-0"."""
    for bodies in ([], [(1.0, ZERO, ZERO)], [(1.0, (1.0, 0.0, 0.0), ZERO), (1.0, (-1.0, 0.0, 0.0), (0.0, 0.0, -0.0))]):
        d = compute_diagnostics(bodies, [(-0.0, -0.0, -0.0)], G)
        values = [d["totalMassKg"], d["kineticEnergyJ"], d["bookedSpinKgM2PerS"]["x"],
                  d["angularMomentumAboutOriginKgM2PerS"]["z"], d["totalMomentumKgMPerS"]["y"]]
        if len(bodies) < 2:
            values.append(d["potentialEnergyJ"])
        assert all(math.copysign(1.0, v) == 1.0 for v in values), (bodies, d)


PAIR = [(1.0, ZERO, ZERO), (2.0, (1.0, 0.0, 0.0), ZERO)]


@pytest.mark.parametrize("bodies", [[], PAIR[:1], PAIR], ids=["empty", "single", "pair"])
@pytest.mark.parametrize("bad_g", [math.nan, math.inf, -math.inf, 1e308, -1e308])
def test_unusable_gravitational_constant_gives_none_never_nan_or_inf(bodies, bad_g):
    """A NaN/infinite `g`, or a finite `g` whose product with the pair sum overflows, must not leak into the result
    (NaN would also fail JSON serialization): only potentialEnergyJ depends on `g`, and it becomes undefined."""
    d = compute_diagnostics(bodies, [], bad_g)
    # with a pair, every listed g fails (non-finite, or 1e308 * pair sum overflows); with no pair only a
    # non-finite g does, because a finite g times an empty sum is a well-defined 0.0
    undefined = len(bodies) == 2 or not math.isfinite(bad_g)
    assert d["potentialEnergyJ"] is (None if undefined else d["potentialEnergyJ"])
    if not undefined:
        assert d["potentialEnergyJ"] == 0.0
    others = {k: v for k, v in d.items() if k != "potentialEnergyJ"}
    assert others == {k: v for k, v in compute_diagnostics(bodies, [], G).items() if k != "potentialEnergyJ"}
    json.dumps(d, allow_nan=False)


def test_valid_gravitational_constant_is_unchanged_by_the_guard():
    d = compute_diagnostics(PAIR, [], G)
    assert d["potentialEnergyJ"] == -G * 2.0 / 1.0

