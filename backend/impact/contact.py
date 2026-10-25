"""Gravity-consistent contact state (investigation of the detection-time velocity offset, D-063).

REBOUND's `line` detection reports a pair only at the END of the internal IAS15 step in which the swept spheres overlapped
(detection time t_d). By then the pair has kept falling for up to one internal step: the separation is below R_t + R_p and
the relative speed has grown by about a_rel * tau. `geometry.capture_impact` historically rewound POSITIONS linearly but kept
the VELOCITIES of t_d, so its impact speed, Q_R and kinetic energy referred to a later time than its positions (measured on two
Earths falling from rest: impact speed 0.1-1.3 % above the analytic contact speed, depending on the internal step grid).

`refine_contact` removes that inconsistency without touching the live simulation: it integrates a COPY of the whole REBOUND
system (all bodies, same G, IAS15, collisions off) backwards from t_d and locates the first time on the integrated path at
which the pair's centre distance equals R_t + R_p (bracket over the last internal step, then safeguarded Newton/bisection).
The positions AND velocities it returns therefore refer to the same time and follow the real gravitational trajectory,
including every other body. Limitations, stated: the root is found to `SEPARATION_TOL_REL` of the contact distance; the
point-mass gravity of the integrator is used up to contact (no tidal deformation); if the integrated path never reaches
contact inside the last step (a `line` hit on a grazing pass whose curved path stays outside R) or the copy fails, the caller
keeps the linear estimate and labels it.
SI units. Never mutates `sim`.
"""
import math
import warnings
from dataclasses import dataclass
from typing import Optional

SEPARATION_TOL_REL = 1.0e-9  # |d(t_c) - R| / R accepted as contact
SCAN_SAMPLES = 8  # samples over the last internal step used to bracket the first crossing
MAX_ITERATIONS = 40


@dataclass(frozen=True)
class ContactState:
    """The pair at the refined contact time, from the integrated path. `states` maps every body id to (position, velocity)."""

    time_s: float
    states: dict
    separation_residual_rel: float
    iterations: int


def _pair(states: dict, a: str, b: str) -> tuple[float, float]:
    """(centre distance, its time derivative) of the pair."""
    (xa, va), (xb, vb) = states[a], states[b]
    r = [q - p for p, q in zip(xa, xb)]
    v = [q - p for p, q in zip(va, vb)]
    d = math.sqrt(sum(c * c for c in r))
    return d, (sum(x * y for x, y in zip(r, v)) / d if d > 0.0 else 0.0)


def _copy(sim):
    """A copy without collision handling. REBOUND warns that a copy has no function pointers: intended here (no callbacks, no
    heartbeat), so the warning is silenced."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        c = sim.copy()
    c.collision = "none"
    return c


def refine_contact(sim, id_a: str, id_b: str, t_lo: float, contact_distance: float) -> Optional[ContactState]:
    """First time in [t_lo, sim.t] at which |x_b - x_a| = contact_distance on the integrated path, or None if the path does not
    reach contact there (or the copy cannot be integrated). `sim` is at the detection time; it is copied, never changed."""
    t_d = sim.t
    if not (contact_distance > 0.0 and t_lo <= t_d):
        return None
    try:
        base = _copy(sim)  # the copy only follows gravity; detection and resolution stay with the live simulation
    except Exception:  # noqa: BLE001 - a copy failure must not fail the step: the caller keeps the linear estimate
        return None
    cache: dict = {}
    evaluations = 0

    def at(t: float) -> dict:
        nonlocal evaluations
        if t not in cache:
            evaluations += 1
            c = _copy(base)
            if t != t_d:
                c.integrate(t, exact_finish_time=1)
            cache[t] = {p.name: ((p.x, p.y, p.z), (p.vx, p.vy, p.vz)) for p in c.particles}
        return cache[t]

    def f(t: float) -> float:
        return _pair(at(t), id_a, id_b)[0] - contact_distance

    try:
        if f(t_d) >= 0.0 and t_lo == t_d:
            return None
        ts = [t_lo + (t_d - t_lo) * k / SCAN_SAMPLES for k in range(SCAN_SAMPLES + 1)] if t_d > t_lo else [t_d]
        values = [f(t) for t in ts]
        if values[0] < 0.0:
            return None  # already overlapping at the start of the last step: not a first contact inside it
        hi = next((k for k, v in enumerate(values) if v < 0.0), None)
        if hi is None:
            return None  # the integrated path stays outside contact at every sample: the caller keeps the linear estimate
        lo_t, hi_t, lo_f, hi_f = ts[hi - 1], ts[hi], values[hi - 1], values[hi]
        t = hi_t
        for _ in range(MAX_ITERATIONS):
            d, ddot = _pair(at(t), id_a, id_b)
            ft = d - contact_distance
            if abs(ft) <= SEPARATION_TOL_REL * contact_distance:
                break
            if ft > 0.0:
                lo_t, lo_f = t, ft
            else:
                hi_t, hi_f = t, ft
            newton = t - ft / ddot if ddot != 0.0 else math.nan
            # safeguard: Newton only while it stays strictly inside the bracket, otherwise bisect
            t = newton if lo_t < newton < hi_t else 0.5 * (lo_t + hi_t)
            if hi_t - lo_t <= 1.0e-15 * max(abs(t_d), 1.0):
                break
        d, _ = _pair(at(t), id_a, id_b)
        return ContactState(t, dict(at(t)), abs(d - contact_distance) / contact_distance, evaluations)
    except Exception:  # noqa: BLE001 - REBOUND failure on the copy: the caller keeps the linear estimate and says so
        return None
