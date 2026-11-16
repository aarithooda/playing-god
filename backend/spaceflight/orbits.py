"""Two-body orbital mechanics (pure functions, SI units, radians). No REBOUND, no service state.

Conventions
- A state is the position r [m] and velocity v [m/s] of the orbiting object RELATIVE to its central body, in the simulation's
  inertial axes (right-handed). `mu` [m^3/s^2] is the gravitational parameter of the relative motion: G (M + m).
- Classical elements (a, e, i, raan, argp, nu): the reference plane is the simulation's x-y plane and the reference direction its
  +x axis (in the Solar System presets that is the ecliptic and equinox of J2000.0, NOT a planet's equator: the engine has no
  body-fixed frames). a > 0 for an ellipse, a < 0 for a hyperbola; the parabola (e = 1) is not representable by `a` and is rejected.
- Singular cases are resolved by the usual substitutions, so `elements_to_state(state_to_elements(x))` returns x in every case:
    circular (e < CIRCULAR_TOL):    argp = 0 and nu is the argument of latitude (measured from the ascending node);
    equatorial (i or pi - i < EQUATORIAL_TOL): raan = 0 and argp is the longitude of periapsis (from +x);
    both: raan = argp = 0 and nu is the true longitude.
- Manoeuvre frame "VNB" (velocity, normal, binormal), relative to the reference body: V = v / |v| (prograde), N = (r x v) / |r x v|
  (orbit normal), B = V x N (in the orbit plane, perpendicular to the velocity, pointing away from the body on a circular orbit:
  "radial out"). A delta-v is given as (prograde, normal, radial-out) components.

Sources: Bate, Mueller & White, "Fundamentals of Astrodynamics" (1971), ch. 1-4; Vallado, "Fundamentals of Astrodynamics and
Applications" (4th ed.), algorithms 9 (RV2COE) and 10 (COE2RV); Curtis, "Orbital Mechanics for Engineering Students", ch. 2-4, 6.
"""
import math
from dataclasses import dataclass

Vec = tuple[float, float, float]

CIRCULAR_TOL = 1.0e-10
EQUATORIAL_TOL = 1.0e-10  # rad
PARABOLIC_TOL = 1.0e-9
TWO_PI = 2.0 * math.pi


class OrbitError(ValueError):
    """A physically invalid orbit request (the message says which quantity and why)."""


# ---------- small vector helpers ----------
def add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def scale(a: Vec, s: float) -> Vec:
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a: Vec) -> float:
    return math.sqrt(dot(a, a))


def unit(a: Vec) -> Vec:
    n = norm(a)
    if n == 0.0:
        raise OrbitError("a zero vector has no direction")
    return (a[0] / n, a[1] / n, a[2] / n)


def wrap(angle: float) -> float:
    """Angle in [0, 2 pi)."""
    w = math.fmod(angle, TWO_PI)
    if w < 0.0:
        w += TWO_PI
    return 0.0 if w >= TWO_PI else w


# ---------- scalar relations ----------
def circular_speed(mu: float, r: float) -> float:
    """v_c = sqrt(mu / r)."""
    return math.sqrt(mu / r)


def escape_speed(mu: float, r: float) -> float:
    """v_esc = sqrt(2 mu / r)."""
    return math.sqrt(2.0 * mu / r)


def vis_viva_speed(mu: float, r: float, a: float) -> float:
    """v = sqrt(mu (2 / r - 1 / a)); a < 0 for a hyperbola."""
    q = mu * (2.0 / r - 1.0 / a)
    if q < 0.0:
        raise OrbitError(f"radius {r:.6g} m is not on an orbit of semi-major axis {a:.6g} m")
    return math.sqrt(q)


def orbital_period(mu: float, a: float) -> float:
    """T = 2 pi sqrt(a^3 / mu) (bound orbits only)."""
    if not a > 0.0:
        raise OrbitError("only a bound orbit (a > 0) has a period")
    return TWO_PI * math.sqrt(a * a * a / mu)


def specific_energy(mu: float, r: Vec, v: Vec) -> float:
    """epsilon = v^2 / 2 - mu / r  [J/kg]; negative = bound."""
    return 0.5 * dot(v, v) - mu / norm(r)


def sphere_of_influence(distance: float, mass: float, primary_mass: float) -> float:
    """Laplace sphere of influence r_SOI = d (m / M)^(2/5) of a body of mass m at distance d from its primary M."""
    return distance * (mass / primary_mass) ** 0.4


def hill_radius(distance: float, mass: float, primary_mass: float) -> float:
    """Hill radius r_H = d (m / (3 M))^(1/3) (circular restricted three-body estimate)."""
    return distance * (mass / (3.0 * primary_mass)) ** (1.0 / 3.0)


@dataclass(frozen=True)
class Hohmann:
    """Two-impulse transfer between coplanar CIRCULAR orbits r1 -> r2 about one body (the minimum-energy two-impulse transfer
    for r2 / r1 < 11.94)."""

    dv1: float  # at r1, prograde if r2 > r1 [m/s]
    dv2: float  # at r2, to circularise [m/s]
    transfer_time: float  # half the transfer-ellipse period [s]
    semi_major_axis: float


def hohmann(mu: float, r1: float, r2: float) -> Hohmann:
    if not (r1 > 0.0 and r2 > 0.0 and mu > 0.0):
        raise OrbitError("Hohmann transfer needs positive radii and mu")
    a = 0.5 * (r1 + r2)
    v1, v2 = circular_speed(mu, r1), circular_speed(mu, r2)
    vt1, vt2 = vis_viva_speed(mu, r1, a), vis_viva_speed(mu, r2, a)
    return Hohmann(dv1=vt1 - v1, dv2=v2 - vt2, transfer_time=math.pi * math.sqrt(a ** 3 / mu), semi_major_axis=a)


# ---------- elements ----------
@dataclass(frozen=True)
class Elements:
    a: float  # semi-major axis [m]; < 0 for a hyperbola
    e: float
    i: float  # inclination to the x-y plane [rad], 0..pi
    raan: float  # longitude of the ascending node [rad]
    argp: float  # argument of periapsis [rad]
    nu: float  # true anomaly [rad]

    @property
    def periapsis(self) -> float:
        return self.a * (1.0 - self.e)

    @property
    def apoapsis(self) -> float:
        """Apoapsis radius; +inf for an unbound orbit."""
        return self.a * (1.0 + self.e) if self.e < 1.0 else math.inf

    @property
    def semi_latus_rectum(self) -> float:
        return self.a * (1.0 - self.e * self.e)


def perifocal_axes(i: float, raan: float, argp: float) -> tuple[Vec, Vec, Vec]:
    """Unit vectors P (towards periapsis), Q (90 deg ahead in the orbit plane) and W (orbit normal) in the inertial axes:
    the columns of R3(-raan) R1(-i) R3(-argp)."""
    co, so, ci, si, cw, sw = math.cos(raan), math.sin(raan), math.cos(i), math.sin(i), math.cos(argp), math.sin(argp)
    p = (co * cw - so * sw * ci, so * cw + co * sw * ci, sw * si)
    q = (-co * sw - so * cw * ci, -so * sw + co * cw * ci, cw * si)
    w = (so * si, -co * si, ci)
    return p, q, w


def check_elements(el: Elements) -> None:
    for name in ("a", "e", "i", "raan", "argp", "nu"):
        if not math.isfinite(getattr(el, name)):
            raise OrbitError(f"orbital element {name} must be finite")
    if el.e < 0.0:
        raise OrbitError("eccentricity must be >= 0")
    if abs(el.e - 1.0) < PARABOLIC_TOL:
        raise OrbitError("a parabolic orbit (e = 1) cannot be described by a semi-major axis; use e < 1 or e > 1")
    if el.e < 1.0 and not el.a > 0.0:
        raise OrbitError("an elliptical orbit needs a positive semi-major axis")
    if el.e > 1.0 and not el.a < 0.0:
        raise OrbitError("a hyperbolic orbit needs a negative semi-major axis")
    if not 0.0 <= el.i <= math.pi:
        raise OrbitError("inclination must be within 0..180 degrees")
    if el.e > 1.0:
        limit = math.acos(-1.0 / el.e)  # asymptote: the true anomaly of a hyperbola is bounded
        nu = math.atan2(math.sin(el.nu), math.cos(el.nu))
        if abs(nu) >= limit:
            raise OrbitError("true anomaly lies beyond the asymptote of this hyperbola")


def elements_to_state(el: Elements, mu: float) -> tuple[Vec, Vec]:
    """Position and velocity relative to the central body (Vallado alg. 10)."""
    check_elements(el)
    if not (mu > 0.0 and math.isfinite(mu)):
        raise OrbitError("mu must be positive")
    p = el.semi_latus_rectum
    cn, sn = math.cos(el.nu), math.sin(el.nu)
    r = p / (1.0 + el.e * cn)
    k = math.sqrt(mu / p)
    pv, qv, _ = perifocal_axes(el.i, el.raan, el.argp)
    pos = add(scale(pv, r * cn), scale(qv, r * sn))
    vel = add(scale(pv, -k * sn), scale(qv, k * (el.e + cn)))
    return pos, vel


def state_to_elements(r: Vec, v: Vec, mu: float) -> Elements:
    """Classical elements of a relative state (Vallado alg. 9), with the singular-case conventions of the module docstring."""
    rn, vn = norm(r), norm(v)
    if not (rn > 0.0 and mu > 0.0):
        raise OrbitError("a state needs a non-zero radius and positive mu")
    h = cross(r, v)
    hn = norm(h)
    if hn <= 1.0e-14 * rn * max(vn, 1.0e-300):
        raise OrbitError("rectilinear motion (zero angular momentum) has no classical elements")
    energy = 0.5 * vn * vn - mu / rn
    ev = sub(scale(r, (vn * vn - mu / rn) / mu), scale(v, dot(r, v) / mu))
    e = norm(ev)
    if abs(e - 1.0) < PARABOLIC_TOL or energy == 0.0:
        raise OrbitError("a parabolic state (e = 1) has no semi-major axis")
    a = -mu / (2.0 * energy)
    i = math.acos(max(-1.0, min(1.0, h[2] / hn)))
    n = (-h[1], h[0], 0.0)  # node vector k x h
    nn = norm(n)
    equatorial = i < EQUATORIAL_TOL or math.pi - i < EQUATORIAL_TOL or nn <= 1.0e-14 * hn
    circular = e < CIRCULAR_TOL
    retro = h[2] < 0.0
    if equatorial:
        raan = 0.0
        node = (1.0, 0.0, 0.0)
    else:
        raan = wrap(math.atan2(n[1], n[0]))
        node = (n[0] / nn, n[1] / nn, 0.0)
    w = (h[0] / hn, h[1] / hn, h[2] / hn)
    side = cross(w, node)  # 90 deg ahead of the node line in the orbit plane

    def angle_from_node(x: Vec) -> float:
        return wrap(math.atan2(dot(x, side), dot(x, node)))

    if equatorial and retro:
        # the x axis is in the orbit plane; angles are measured along the direction of motion
        pass
    if circular:
        argp = 0.0
        nu = angle_from_node(r)
    else:
        argp = angle_from_node(ev)
        nu = wrap(angle_from_node(r) - argp)
    return Elements(a=a, e=0.0 if circular else e, i=i, raan=raan, argp=argp, nu=nu)


# ---------- anomalies and time ----------
def eccentric_from_true(nu: float, e: float) -> float:
    """Eccentric anomaly E (e < 1) or hyperbolic anomaly H (e > 1) of a true anomaly."""
    if e < 1.0:
        return math.atan2(math.sqrt(1.0 - e * e) * math.sin(nu), e + math.cos(nu))
    nu = math.atan2(math.sin(nu), math.cos(nu))
    x = math.sqrt((e - 1.0) / (e + 1.0)) * math.tan(0.5 * nu)
    if not abs(x) < 1.0:
        raise OrbitError("the true anomaly lies on or beyond the asymptote of this hyperbola")
    return 2.0 * math.atanh(x)


def mean_from_true(nu: float, e: float) -> float:
    """Mean anomaly M (elliptic: wrapped to [0, 2 pi); hyperbolic: signed, 0 at periapsis)."""
    ea = eccentric_from_true(nu, e)
    if e < 1.0:
        return wrap(ea - e * math.sin(ea))
    return e * math.sinh(ea) - ea


def true_from_mean(m: float, e: float) -> float:
    """Solve Kepler's equation (Newton with a bisection safeguard) and return the true anomaly."""
    if e < 1.0:
        m = wrap(m)
        ea = m if e < 0.8 else math.pi
        lo, hi = 0.0, TWO_PI
        for _ in range(100):
            f = ea - e * math.sin(ea) - m
            if abs(f) < 1.0e-15 * max(1.0, abs(m)):
                break
            if f > 0.0:
                hi = ea
            else:
                lo = ea
            step = ea - f / (1.0 - e * math.cos(ea))
            ea = step if lo < step < hi else 0.5 * (lo + hi)
        return wrap(2.0 * math.atan2(math.sqrt(1.0 + e) * math.sin(0.5 * ea), math.sqrt(1.0 - e) * math.cos(0.5 * ea)))
    # Hyperbolic: f(H) = e sinh H - H - M is increasing and, for H > 0, convex, and (e - 1) sinh H <= e sinh H - H <= e sinh H
    # there, so the root of |M| lies in [asinh(|M| / e), asinh(|M| / (e - 1))]. Newton from the upper end descends monotonically
    # (no overflow, no overshoot); the bracket is kept as a safeguard against round-off. Odd symmetry gives M < 0.
    sign, m = (1.0, m) if m >= 0.0 else (-1.0, -m)
    lo, hi = math.asinh(m / e), math.asinh(m / (e - 1.0))
    ha = hi
    for _ in range(200):
        f = e * math.sinh(ha) - ha - m
        if abs(f) <= 1.0e-15 * max(1.0, m):
            break
        if f > 0.0:
            hi = ha
        else:
            lo = ha
        step = ha - f / (e * math.cosh(ha) - 1.0)
        ha = step if lo <= step <= hi else 0.5 * (lo + hi)
        if hi - lo <= 1.0e-16 * max(1.0, hi):
            break
    return sign * 2.0 * math.atan(math.sqrt((e + 1.0) / (e - 1.0)) * math.tanh(0.5 * ha))


def mean_motion(mu: float, a: float) -> float:
    return math.sqrt(mu / abs(a) ** 3)


def time_since_periapsis(el: Elements, mu: float) -> float:
    """Elliptic: in [0, T). Hyperbolic: signed (negative before periapsis)."""
    return mean_from_true(el.nu, el.e) / mean_motion(mu, el.a)


def time_to_true_anomaly(el: Elements, mu: float, nu_target: float) -> float:
    """Time until the true anomaly next equals `nu_target` (elliptic: in [0, T); hyperbolic: may be negative = already passed)."""
    n = mean_motion(mu, el.a)
    if el.e < 1.0:
        return wrap(mean_from_true(nu_target, el.e) - mean_from_true(el.nu, el.e)) / n
    return (mean_from_true(nu_target, el.e) - mean_from_true(el.nu, el.e)) / n


def propagate_kepler(r: Vec, v: Vec, mu: float, dt: float) -> tuple[Vec, Vec]:
    """Two-body propagation of a relative state by `dt` seconds (through the elements; exact for unperturbed motion)."""
    el = state_to_elements(r, v, mu)
    m = mean_from_true(el.nu, el.e) + mean_motion(mu, el.a) * dt
    nu = true_from_mean(m, el.e)
    return elements_to_state(Elements(el.a, el.e, el.i, el.raan, el.argp, nu), mu)


# ---------- manoeuvre frame ----------
def vnb_axes(r: Vec, v: Vec) -> tuple[Vec, Vec, Vec]:
    """(prograde V, orbit normal N, radial-out B = V x N) of a relative state. Needs a non-zero velocity that is not purely radial."""
    vhat = unit(v)
    h = cross(r, v)
    if norm(h) <= 1.0e-14 * norm(r) * norm(v):
        raise OrbitError("the orbit frame is undefined for purely radial motion")
    nhat = unit(h)
    return vhat, nhat, cross(vhat, nhat)


def vnb_to_inertial(r: Vec, v: Vec, prograde: float, normal: float, radial: float) -> Vec:
    vhat, nhat, bhat = vnb_axes(r, v)
    return add(add(scale(vhat, prograde), scale(nhat, normal)), scale(bhat, radial))


def plane_angle(h1: Vec, h2: Vec) -> float:
    """Angle between two orbit planes given their angular-momentum vectors [rad], 0..pi."""
    c = dot(unit(h1), unit(h2))
    return math.acos(max(-1.0, min(1.0, c)))


def plane_of(h: Vec) -> tuple[float, float]:
    """(inclination, raan) of the orbit plane whose angular momentum is h (raan = 0 for an equatorial plane)."""
    hn = norm(h)
    i = math.acos(max(-1.0, min(1.0, h[2] / hn)))
    if i < EQUATORIAL_TOL or math.pi - i < EQUATORIAL_TOL:
        return i, 0.0
    return i, wrap(math.atan2(h[0], -h[1]))
