"""Independent two-body (Kepler) reference for Experiment 01. Imports nothing from REBOUND or the backend.

Given the relative position r0 and velocity v0 of a bound two-body system and mu = G (m1 + m2), `propagate` returns the
exact relative state at time t using the Gauss f and g functions in the change of eccentric anomaly dE:

    n t = dE + (r0.v0 / (n a^2)) (1 - cos dE) - (1 - r0/a) sin dE        (Kepler's equation, solved by Newton)
    r = f r0 + g v0,   f = 1 - (a/r0)(1 - cos dE),   g = t - (dE - sin dE)/n

This form has no singularity as e -> 0 and needs no orbital-element conversion, so it shares no code and no numerical
path with the integrator it is used to check.
"""
import math

Vec = tuple[float, float, float]


def dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def norm(a: Vec) -> float:
    return math.sqrt(dot(a, a))


def cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def elements(r0: Vec, v0: Vec, mu: float) -> dict:
    """Semi-major axis, eccentricity, period, apsides of the Keplerian orbit through (r0, v0)."""
    r = norm(r0)
    a = 1.0 / (2.0 / r - dot(v0, v0) / mu)
    if not a > 0:
        raise ValueError("the orbit is not bound")
    h = cross(r0, v0)
    # eccentricity vector e = (v x h)/mu - r0/|r0|
    vxh = cross(v0, h)
    e_vec = tuple(vxh[i] / mu - r0[i] / r for i in range(3))
    e = norm(e_vec)
    return {"a": a, "e": e, "period": 2.0 * math.pi * math.sqrt(a ** 3 / mu), "perihelion": a * (1.0 - e), "aphelion": a * (1.0 + e),
            "r0": r}


def propagate(r0: Vec, v0: Vec, mu: float, t: float) -> tuple[Vec, Vec]:
    r0n = norm(r0)
    a = 1.0 / (2.0 / r0n - dot(v0, v0) / mu)
    if not a > 0:
        raise ValueError("the orbit is not bound")
    n = math.sqrt(mu / a ** 3)
    A = dot(r0, v0) / (n * a * a)  # = e sin E0
    B = 1.0 - r0n / a  # = e cos E0
    target = n * t
    x = target
    for _ in range(100):
        F = x + A * (1.0 - math.cos(x)) - B * math.sin(x) - target
        dF = 1.0 + A * math.sin(x) - B * math.cos(x)  # = r/a > 0
        step = F / dF
        x -= step
        if abs(step) <= 1e-16 * max(1.0, abs(x)):
            break
    c, s = math.cos(x), math.sin(x)
    f = 1.0 - (a / r0n) * (1.0 - c)
    g = t - (x - s) / n
    r = tuple(f * r0[i] + g * v0[i] for i in range(3))
    rn = norm(r)
    fdot = -math.sqrt(mu * a) / (rn * r0n) * s
    gdot = 1.0 - (a / rn) * (1.0 - c)
    v = tuple(fdot * r0[i] + gdot * v0[i] for i in range(3))
    return r, v
