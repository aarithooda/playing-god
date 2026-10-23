"""System-level scientific diagnostics for the point-mass Newtonian model (SI units throughout).

Pure functions over plain numbers: no REBOUND, no service state, no mutation. The caller passes one consistent
snapshot (the same values it serialises as `bodies`), so the result describes exactly that state.

Definitions, in the single inertial right-handed frame of D-010, G in m^3 kg^-1 s^-2:
- total mass            M = sum m_i                                   [kg]
- total momentum        P = sum m_i v_i                               [kg m/s]
- kinetic energy        K = sum 1/2 m_i |v_i|^2                       [J]
- potential energy      U = -G sum_{i<j} m_i m_j / |r_i - r_j|        [J], zero at infinite separation
- angular momentum      L = sum m_i r_i x v_i, about the fixed origin (0,0,0)   [kg m^2/s]
- booked spin           S = sum of the merger-booked spin vectors     [kg m^2/s] (bookkeeping, no dynamics)

Policy: every quantity is a finite float or None (JSON null); a vector is all-or-nothing. Empty sums are 0.0. U is None
when two centres coincide (undefined) or on overflow. The function never raises and never returns NaN/Infinity.
All sums use math.fsum and pair terms are symmetric, so the result does not depend on the order of the bodies.
"""
import math
from typing import Iterable, Sequence

DIAGNOSTICS_VERSION = 1

Vec = Sequence[float]
BodyState = tuple[float, Vec, Vec]  # (mass kg, position m, velocity m/s)


def _sum(terms: Iterable[float]) -> float | None:
    """Exactly-rounded sum, or None if it is not a finite number (fsum raises on inf-inf and on overflow)."""
    try:
        total = math.fsum(terms)
    except (OverflowError, ValueError):
        return None
    return total + 0.0 if math.isfinite(total) else None  # +0.0 turns a negative zero into 0.0


def _vec_sum(rows: list[Vec]) -> dict[str, float] | None:
    comps = [_sum(r[k] for r in rows) for k in range(3)]
    if any(c is None for c in comps):
        return None
    return {"x": comps[0], "y": comps[1], "z": comps[2]}


def _cross(a: Vec, b: Vec) -> tuple[float, float, float]:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _potential_energy(bodies: Sequence[BodyState], g: float) -> float | None:
    terms = []
    for i in range(len(bodies)):
        mi, ri, _ = bodies[i]
        for j in range(i + 1, len(bodies)):
            mj, rj, _ = bodies[j]
            d = math.dist(ri, rj)
            if d == 0.0 or not math.isfinite(d):
                return None  # coincident centres: undefined; non-finite positions: unusable
            terms.append(mi * mj / d)
    total = _sum(terms)
    if total is None:
        return None
    energy = -g * total + 0.0  # an empty or single-body sum is +0.0, never -0.0
    return energy if math.isfinite(energy) else None  # a NaN/inf `g`, or g*total overflowing, is undefined, not a value


def compute_diagnostics(bodies: Sequence[BodyState], spins: Iterable[Vec], g: float) -> dict:
    """Diagnostics of one snapshot. `spins` are the booked spin vectors of the bodies that carry one."""
    spin_rows = [tuple(s) for s in spins]
    return {
        "version": DIAGNOSTICS_VERSION,
        "totalMassKg": _sum(m for m, _, _ in bodies),
        "totalMomentumKgMPerS": _vec_sum([tuple(m * c for c in v) for m, _, v in bodies]),
        "kineticEnergyJ": _sum(0.5 * m * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) for m, _, v in bodies),
        "potentialEnergyJ": _potential_energy(bodies, g),
        "angularMomentumAboutOriginKgM2PerS": _vec_sum(
            [tuple(m * c for c in _cross(r, v)) for m, r, v in bodies]),
        "bookedSpinKgM2PerS": _vec_sum(spin_rows),
    }
