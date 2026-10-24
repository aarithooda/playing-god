"""Stage 5: realisation of the debris of a disruption/erosion/accretion event into tracked fragments and debris parcels (plan 3.9, 4.7;
decisions D-046 parcels, D-047 body budget, D-048 ejection and threshold). Pure functions: no REBOUND, no service state, and the only
random numbers come from the `random.Random` the caller seeds from the content-addressed event seed (bitwise replay).

SCIENTIFIC STATUS: PROVISIONAL (D-038, D-048). Nothing here is a validated result; each assumption is registered in
`models/provisional.py`:
- fragment masses follow the LS12 power law (beta = 2.85, unverified): cumulative N(>D) ~ D^-beta, i.e. N(>m) ~ m^-q with q = beta / 3;
- the realised ranks are m_k = c (k - u_k)^(-1/q), u_k seeded in [0, 1/2): the quantiles of that law, largest first, with a deterministic
  jitter (never equal-mass fragments); the tracked set holds at most `TRACKED_SHARE` of the debris mass (engineering, DQ-6 (3));
- the ejection speed of every product is a multiple f of the mutual escape speed, f drawn in `EJECTION_FACTOR_RANGE` (Chambers 2013 /
  Childs & Steffen 2022 practice, "somewhat arbitrary" there; NOT a universal constant, DQ-6 (1));
- products are placed on a ring in the collision plane around the centre of mass (C13 / CS22 geometry) with stratified, seeded angles.

Accounting: the untracked tail (debris mass minus the tracked fragments) goes to parcels; if no parcel may exist it is returned to the
largest remnant. One uniform shift of all bodies closes the momentum and the centre of mass exactly (the plan closes on the largest remnant alone; that would give a very light remnant an unbounded velocity, see `ring_layout`).
"""
import math
import random
from dataclasses import dataclass
from typing import Optional, Sequence

Vec = tuple[float, float, float]

EJECTION_FACTOR_RANGE = (1.05, 1.10)  # PROVISIONAL (D-048): multiple of the mutual escape speed
TRACKED_SHARE = 0.5  # PROVISIONAL engineering: the tracked fragments hold at most this fraction of the debris mass
PARCEL_DMIN_RATIO = 1.0e-3  # PROVISIONAL engineering: lower diameter cut of the untracked population, relative to its upper cut
MAX_RECOIL_IN_ESCAPE_SPEEDS = 1.0  # a momentum closure that would throw the remnant out faster than this is rejected


@dataclass(frozen=True)
class FragmentBudget:
    """What the body budget allows for ONE event (D-047): tracked fragments, parcels, and the optional config mass threshold."""

    max_fragments: int
    max_parcels: int
    min_mass_fraction: Optional[float] = None  # CollisionConfig.tracked_fragment_min_mass_fraction (None = budget-driven only)


@dataclass(frozen=True)
class MassSplit:
    tracked: tuple[float, ...]  # fragment masses, largest first
    tail_kg: float  # untracked debris (to parcels, else to the remnant)


def power_law_exponent(beta: float) -> float:
    """q in N(>m) ~ m^-q for a cumulative diameter law N(>D) ~ D^-beta at constant density."""
    return beta / 3.0


def split_masses(debris_kg: float, largest_remnant_kg: float, total_kg: float, beta: float, max_fragments: int,
                 min_mass_fraction: Optional[float], rng: random.Random) -> MassSplit:
    """Tracked fragment masses (largest first) and the untracked tail. Sum exact: tail = debris - fsum(tracked) >= 0."""
    if debris_kg <= 0.0 or max_fragments <= 0:
        return MassSplit((), max(debris_kg, 0.0))
    q = power_law_exponent(beta)
    weights = [(k - 0.5 * rng.random()) ** (-1.0 / q) for k in range(1, max_fragments + 1)]
    scale = min(largest_remnant_kg / weights[0], TRACKED_SHARE * debris_kg / math.fsum(weights))
    masses = [min(scale * w, largest_remnant_kg) for w in weights]  # min(): the first one equals the cap up to a rounding error
    floor = 0.0 if min_mass_fraction is None else min_mass_fraction * total_kg
    tracked = tuple(m for m in masses if m >= floor)
    tail = debris_kg - math.fsum(tracked)
    if tail < 0.0:  # only through rounding: give the last fragment back
        tracked = tracked[:-1]
        tail = debris_kg - math.fsum(tracked)
    return MassSplit(tracked, tail)


def _unit(a: Sequence[float]) -> Vec:
    n = math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
    return (a[0] / n, a[1] / n, a[2] / n)


def plane_basis(downrange: Vec, normal: Vec) -> tuple[Vec, Vec]:
    """Orthonormal (e, p) spanning the collision plane: e along the relative velocity, p from the contact normal (any perpendicular if
    the impact is head-on)."""
    e = _unit(downrange)
    d = e[0] * normal[0] + e[1] * normal[1] + e[2] * normal[2]
    p = (normal[0] - d * e[0], normal[1] - d * e[1], normal[2] - d * e[2])
    if math.sqrt(sum(c * c for c in p)) < 1.0e-9:
        helper = (1.0, 0.0, 0.0) if abs(e[0]) < 0.9 else (0.0, 1.0, 0.0)
        d = e[0] * helper[0] + e[1] * helper[1] + e[2] * helper[2]
        p = (helper[0] - d * e[0], helper[1] - d * e[1], helper[2] - d * e[2])
    return e, _unit(p)


@dataclass(frozen=True)
class Layout:
    """Positions/velocities in the pair's COM frame (relative to x_c, v_c): remnant first, then the products in input order."""

    remnant_position: Vec
    remnant_velocity: Vec
    positions: tuple[Vec, ...]
    velocities: tuple[Vec, ...]
    ring_radius_m: float
    recoil_m_per_s: float


def ring_layout(remnant_kg: float, remnant_radius: float, masses: Sequence[float], radii: Sequence[float], basis: tuple[Vec, Vec],
                v_esc: float, eps: float, g: float, rng: random.Random) -> Layout:
    """Place the products on a ring in the collision plane around the remnant, outward velocities f * v_esc, momentum/COM closed by one uniform shift.

    The pair distances all scale with the ring radius rho (products at rho * unit vectors, the remnant at the ring centre), so the
    smallest rho with no overlap and a clear separation (1 + eps) is exact: rho = max over pairs of (r_a + r_b)(1 + eps) / |a - b|.
    """
    n = len(masses)
    e, p = basis
    phase = rng.random() * 2.0 * math.pi
    order = list(range(n))
    rng.shuffle(order)  # which product gets which sector (so the largest is not always downrange)
    dirs: list[Vec] = [(0.0, 0.0, 0.0)] * n
    for slot, idx in enumerate(order):
        theta = phase + 2.0 * math.pi * (slot + 0.25 + 0.5 * rng.random()) / n  # neighbours stay at least half a sector apart
        c, s = math.cos(theta), math.sin(theta)
        dirs[idx] = (c * e[0] + s * p[0], c * e[1] + s * p[1], c * e[2] + s * p[2])
    factors = [EJECTION_FACTOR_RANGE[0] + (EJECTION_FACTOR_RANGE[1] - EJECTION_FACTOR_RANGE[0]) * rng.random() for _ in range(n)]
    total = remnant_kg + math.fsum(masses)
    # the ring is centred on the remnant; one uniform shift (position and velocity) of ALL bodies then closes the centre of mass and the
    # momentum exactly. (The plan closes on the largest remnant alone; a remnant much lighter than the debris would absorb an unbounded
    # velocity, so the closure is spread over all bodies. Same totals, reported as `recoil`.)
    msum = [math.fsum(masses[i] * dirs[i][a] for i in range(n)) for a in range(3)]
    wsum = [math.fsum(masses[i] * factors[i] * v_esc * dirs[i][a] for i in range(n)) for a in range(3)]
    shift_dir: Vec = (-msum[0] / total, -msum[1] / total, -msum[2] / total)
    dv: Vec = (-wsum[0] / total, -wsum[1] / total, -wsum[2] / total)
    recoil = math.sqrt(sum(c * c for c in dv))
    if recoil > MAX_RECOIL_IN_ESCAPE_SPEEDS * v_esc:
        raise ValueError(f"the momentum closure shift {recoil:.6g} m/s exceeds {MAX_RECOIL_IN_ESCAPE_SPEEDS} v_esc")
    points = [*dirs, (0.0, 0.0, 0.0)]
    rads = [*radii, remnant_radius]
    mass_all = [*masses, remnant_kg]
    vel_all = [*[(factors[i] * v_esc * dirs[i][0], factors[i] * v_esc * dirs[i][1], factors[i] * v_esc * dirs[i][2]) for i in range(n)], (0.0, 0.0, 0.0)]
    rho = 0.0
    for i in range(len(points)):
        for j in range(i + 1, len(points)):
            dist = math.dist(points[i], points[j])
            if dist < 1.0e-9:
                raise ValueError("two products would be placed at the same point")
            rho = max(rho, (rads[i] + rads[j]) * (1.0 + eps) / dist)
            # every pair must also be UNBOUND at its starting separation (relative speed >= the pair's escape speed): otherwise the products
            # placed here would fall back on each other at once, an artefact of the placement and not of the impact
            v_rel2 = sum((vel_all[i][a] - vel_all[j][a]) ** 2 for a in range(3))
            if v_rel2 > 0.0:
                rho = max(rho, 2.0 * g * (mass_all[i] + mass_all[j]) / (v_rel2 * dist))
    shift = (rho * shift_dir[0], rho * shift_dir[1], rho * shift_dir[2])
    positions = tuple((rho * d[0] + shift[0], rho * d[1] + shift[1], rho * d[2] + shift[2]) for d in dirs)
    velocities = tuple((factors[i] * v_esc * dirs[i][0] + dv[0], factors[i] * v_esc * dirs[i][1] + dv[1], factors[i] * v_esc * dirs[i][2] + dv[2])
                       for i in range(n))
    return Layout(remnant_position=shift, remnant_velocity=dv, positions=positions, velocities=velocities, ring_radius_m=rho, recoil_m_per_s=recoil)
