"""Stage 7: dynamical classification of debris and the explicit escape-removal rule (plan 3.10, 4.10; decision D-051). Pure functions.

SCIENTIFIC STATUS: the classification is two-body Keplerian energy arithmetic (computed); the use of the Hill radius as a boundary and of
the removal radius are ENGINEERING criteria (provisional, D-051). CP-SCI-1 is not signed off.

Classification is dynamical, never by visual distance (BE-DYN). For a fragment or parcel f (mass m, position x, velocity v):
- `escaping`: positive two-body specific energy of f relative to the barycentre of ALL OTHER bodies, eps = v_rel^2 / 2 - G (M + m) / d >= 0;
- else `bound_to_remnant`: negative energy relative to the largest remnant of its own event (if that still exists) AND an apocentre
  not beyond the Hill radius of that remnant about the most massive heavier body (if there is none, the remnant dominates);
- else `orbiting_system` (bound to the system but not held by the remnant).
The energies use the instantaneous states, so a classification is a statement about the present, not a prediction of the future.

Removal (the ONLY way a product leaves the simulation besides a collision): a body that is `escaping` and farther from the barycentre of
all other bodies than `factor` x the extent of the system (factor = CollisionConfig.escape_removal_radius_factor, default 1000) moves,
with its mass, momentum and angular momentum, to the escaped-material ledger (diagnostics report it; totals including the ledger are
conserved). The extent is the largest distance of a non-product body from the barycentre of the non-product bodies, at least the
largest non-product radius.
"""
import math
from dataclasses import dataclass
from typing import Optional, Sequence

Vec = tuple[float, float, float]

CLASSES = ("bound_to_remnant", "orbiting_system", "escaping")


@dataclass(frozen=True)
class Mass:
    id: str
    m: float
    x: Vec
    v: Vec
    radius: float = 0.0


def _sub(a: Sequence[float], b: Sequence[float]) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _norm(a: Sequence[float]) -> float:
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def _cross(a: Sequence[float], b: Sequence[float]) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def barycentre(bodies: Sequence[Mass]) -> tuple[float, Vec, Vec]:
    """(total mass, position, velocity) of the bodies' centre of mass."""
    total = math.fsum(b.m for b in bodies)
    x = tuple(math.fsum(b.m * b.x[a] for b in bodies) / total for a in range(3))
    v = tuple(math.fsum(b.m * b.v[a] for b in bodies) / total for a in range(3))
    return total, x, v  # type: ignore[return-value]


def two_body_energy(m1: float, x1: Vec, v1: Vec, m2: float, x2: Vec, v2: Vec, g: float) -> float:
    """Specific orbital energy of the relative motion of two point masses: v_rel^2 / 2 - G (m1 + m2) / d."""
    d = _norm(_sub(x1, x2))
    vr = _sub(v1, v2)
    return 0.5 * (vr[0] * vr[0] + vr[1] * vr[1] + vr[2] * vr[2]) - g * (m1 + m2) / d


def apocentre(m1: float, x1: Vec, v1: Vec, m2: float, x2: Vec, v2: Vec, g: float) -> Optional[float]:
    """Apocentre distance of a BOUND relative orbit (None if unbound): a (1 + e) with a = -mu / (2 eps), e^2 = 1 + 2 eps h^2 / mu^2."""
    mu = g * (m1 + m2)
    eps = two_body_energy(m1, x1, v1, m2, x2, v2, g)
    if eps >= 0.0:
        return None
    h = _norm(_cross(_sub(x1, x2), _sub(v1, v2)))
    a = -mu / (2.0 * eps)
    e = math.sqrt(max(1.0 + 2.0 * eps * h * h / (mu * mu), 0.0))
    return a * (1.0 + e)


def hill_radius(m_remnant: float, distance: float, m_dominant: float) -> float:
    """a (m / (3 M))^(1/3) of the remnant about the dominant attractor at distance a."""
    return distance * (m_remnant / (3.0 * m_dominant)) ** (1.0 / 3.0)


def classify(f: Mass, others: Sequence[Mass], remnant: Optional[Mass], g: float) -> str:
    """Class of one fragment/parcel `f` against the other bodies (`others` excludes `f`; it includes `remnant`)."""
    if not others:
        return "orbiting_system"
    m_o, x_o, v_o = barycentre(others)
    if two_body_energy(f.m, f.x, f.v, m_o, x_o, v_o, g) >= 0.0:
        return "escaping"
    if remnant is None:
        return "orbiting_system"
    apo = apocentre(f.m, f.x, f.v, remnant.m, remnant.x, remnant.v, g)
    if apo is None:
        return "orbiting_system"
    heavier = [b for b in others if b.id != remnant.id and b.m > remnant.m]
    if not heavier:
        return "bound_to_remnant"  # the remnant dominates the system: nothing bounds its sphere of influence
    dominant = max(heavier, key=lambda b: b.m)
    r_hill = hill_radius(remnant.m, _norm(_sub(remnant.x, dominant.x)), dominant.m)
    return "bound_to_remnant" if apo <= r_hill else "orbiting_system"


def classify_all(bodies: Sequence[Mass], product_ids: set[str], remnant_of: dict[str, str], g: float) -> dict[str, str]:
    """Classes of all product bodies. `remnant_of` maps a product id to the id of its event's largest remnant (absent = unknown)."""
    by_id = {b.id: b for b in bodies}
    out = {}
    for pid in product_ids:
        f = by_id.get(pid)
        if f is None:
            continue
        others = [b for b in bodies if b.id != pid]
        out[pid] = classify(f, others, by_id.get(remnant_of.get(pid, "")), g)
    return out


def system_extent(bodies: Sequence[Mass], product_ids: set[str]) -> float:
    """Largest distance of a non-product body from the barycentre of the non-product bodies; at least the largest such radius."""
    core = [b for b in bodies if b.id not in product_ids]
    if not core:
        return 0.0
    _, x, _ = barycentre(core)
    return max(max(_norm(_sub(b.x, x)) for b in core), max(b.radius for b in core))


def removal_candidates(bodies: Sequence[Mass], product_ids: set[str], classes: dict[str, str], factor: float) -> list[str]:
    """Ids that are escaping and beyond `factor` x the system extent from the barycentre of all other bodies (sorted: deterministic)."""
    extent = system_extent(bodies, product_ids)
    if extent <= 0.0:
        return []
    out = []
    for b in bodies:
        if classes.get(b.id) != "escaping":
            continue
        others = [o for o in bodies if o.id != b.id]
        if not others:
            continue
        _, x, _ = barycentre(others)
        if _norm(_sub(b.x, x)) > factor * extent:
            out.append(b.id)
    return sorted(out)
