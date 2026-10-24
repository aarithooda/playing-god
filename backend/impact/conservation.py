"""Conservation accounting of one collision event (plan 4.8, 9.1, 9.2; spec 10.3). Pure functions: no REBOUND, no service state.

All quantities are computed in the pair's centre-of-mass frame and are exact functions of the body states, so the report describes
precisely the pre- and post-impact states handed to it.

- Mass: |M_after - M_before| / M_before (math.fsum).
- Linear momentum: |P_after - P_before| / max(sum m|v|, tiny).
- Angular momentum about the COM: orbital sum m (x - x_c) x (v - v_c) plus spin sum I omega. When a remnant has no moment of inertia its
  share cannot be represented: the report then says so (`angular_momentum_unmodelled`) and gives no residual; the booked amount goes to the
  service's existing booked-spin ledger.
- Energy (COM frame): translational kinetic, rotational, mutual point-mass potential, uniform-sphere self-gravity (-3/5 G m^2 / R, an
  approximation; zero for a debris parcel, which is a dispersed population). `dissipated_j` is the remainder E_before - E_after. Placing products at a clear separation (rule E-12) raises their
  mutual potential by a placement artefact, `placement_shift_j`; it is reported and credited, not hidden:
  `dissipated_j + placement_shift_j >= -tol * KE_com` is the acceptance test (an inelastic collision may dissipate, never create energy).
"""
import math
from dataclasses import dataclass
from typing import Optional, Sequence

from backend.impact.contracts import CollisionTolerances, ConservationReport, EnergyReport, Vec3

Vec = tuple[float, float, float]
TINY = 1.0e-300


@dataclass(frozen=True)
class State:
    """A body (or parcel) as the accounting sees it. `spin` is the spin angular momentum I*omega [kg m^2/s, world frame]."""

    mass: float
    position: Vec
    velocity: Vec
    radius: float
    spin: Vec = (0.0, 0.0, 0.0)
    inertia: Optional[float] = None  # kg m^2; None = no rotation model (its spin must be zero)
    self_bound: bool = True  # False for a debris PARCEL: a dispersed population has no compact-sphere self-gravity (its collision radius is
    # only the radius of a sphere of its bulk density, so crediting it the binding energy of that sphere would invent energy)


def _sub(a: Sequence[float], b: Sequence[float]) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Sequence[float], b: Sequence[float]) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a: Sequence[float]) -> float:
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def _fsum_vec(rows: Sequence[Sequence[float]]) -> Vec:
    return (math.fsum(r[0] for r in rows), math.fsum(r[1] for r in rows), math.fsum(r[2] for r in rows))


def total_mass(bodies: Sequence[State]) -> float:
    return math.fsum(b.mass for b in bodies)


def momentum(bodies: Sequence[State]) -> Vec:
    return _fsum_vec([(b.mass * b.velocity[0], b.mass * b.velocity[1], b.mass * b.velocity[2]) for b in bodies])


def momentum_scale(bodies: Sequence[State]) -> float:
    return math.fsum(b.mass * _norm(b.velocity) for b in bodies)


def centre_of_mass(bodies: Sequence[State]) -> tuple[Vec, Vec]:
    m = total_mass(bodies)
    x = _fsum_vec([(b.mass * b.position[0], b.mass * b.position[1], b.mass * b.position[2]) for b in bodies])
    p = momentum(bodies)
    return (x[0] / m, x[1] / m, x[2] / m), (p[0] / m, p[1] / m, p[2] / m)


def orbital_angular_momentum(bodies: Sequence[State], x_c: Vec, v_c: Vec) -> Vec:
    rows = []
    for b in bodies:
        c = _cross(_sub(b.position, x_c), _sub(b.velocity, v_c))
        rows.append((b.mass * c[0], b.mass * c[1], b.mass * c[2]))
    return _fsum_vec(rows)


def spin_angular_momentum(bodies: Sequence[State]) -> Vec:
    return _fsum_vec([b.spin for b in bodies])


def kinetic_energy(bodies: Sequence[State], v_c: Vec) -> float:
    return math.fsum(0.5 * b.mass * sum(c * c for c in _sub(b.velocity, v_c)) for b in bodies)


def rotational_energy(bodies: Sequence[State]) -> float:
    """sum S^2 / (2 I) over bodies with a rotation model."""
    return math.fsum(0.5 * sum(c * c for c in b.spin) / b.inertia for b in bodies if b.inertia)


def mutual_potential(bodies: Sequence[State], g: float, floor_at_contact: bool = False) -> float:
    """-G sum_{i<j} m_i m_j / d_ij. With `floor_at_contact` a pair closer than R_i + R_j (overlapping spheres) is evaluated at contact."""
    terms = []
    for i in range(len(bodies)):
        for j in range(i + 1, len(bodies)):
            d = _norm(_sub(bodies[i].position, bodies[j].position))
            if floor_at_contact:
                d = max(d, bodies[i].radius + bodies[j].radius)
            terms.append(bodies[i].mass * bodies[j].mass / d)
    return -g * math.fsum(terms)


def self_gravity(bodies: Sequence[State], g: float) -> float:
    """Uniform-sphere binding energy -3/5 G m^2 / R of each compact body (approximation); debris parcels contribute zero."""
    return -0.6 * g * math.fsum(b.mass * b.mass / b.radius for b in bodies if b.self_bound)


def placement_shift(bodies: Sequence[State], g: float) -> float:
    """Potential-energy artefact of keeping the products apart: sum G m_i m_j (1/(R_i+R_j) - 1/d_ij) over pairs (>= 0 when clear)."""
    terms = []
    for i in range(len(bodies)):
        for j in range(i + 1, len(bodies)):
            d = _norm(_sub(bodies[i].position, bodies[j].position))
            contact = bodies[i].radius + bodies[j].radius
            terms.append(bodies[i].mass * bodies[j].mass * (1.0 / contact - 1.0 / d))
    return g * math.fsum(terms)


def _vec(v: Vec) -> Vec3:
    return Vec3(v[0], v[1], v[2])


def build_report(before: Sequence[State], after: Sequence[State], g: float, tolerances: CollisionTolerances, angular_scale: float,
                 angular_unmodelled: Optional[str] = None, ke_com_reference: Optional[float] = None) -> tuple[ConservationReport, float]:
    """Compare two states of the same closed system. Returns (report, placement_shift_j). `angular_scale` is the reference of the
    relative angular-momentum residual (the larger of |L_before| and this, e.g. mu R v_i). `ke_com_reference` defaults to the
    translational kinetic energy of `before` in the COM frame."""
    x_c, v_c = centre_of_mass(before)
    m_b, m_a = total_mass(before), total_mass(after)
    p_b, p_a = momentum(before), momentum(after)
    p_scale = max(momentum_scale(before), TINY)
    l_b = _fsum_vec([orbital_angular_momentum(before, x_c, v_c), spin_angular_momentum(before)])
    l_a = _fsum_vec([orbital_angular_momentum(after, x_c, v_c), spin_angular_momentum(after)])
    mass_res = abs(m_a - m_b) / m_b
    mom_res = _norm(_sub(p_a, p_b)) / p_scale
    l_res = None if angular_unmodelled else _norm(_sub(l_a, l_b)) / max(_norm(l_b), angular_scale, TINY)
    ke_b, ke_a = kinetic_energy(before, v_c), kinetic_energy(after, v_c)
    rot_b, rot_a = rotational_energy(before), rotational_energy(after)
    pot_b, pot_a = mutual_potential(before, g, floor_at_contact=True), mutual_potential(after, g)
    self_b, self_a = self_gravity(before, g), self_gravity(after, g)
    dissipated = (ke_b + rot_b + pot_b + self_b) - (ke_a + rot_a + pot_a + self_a)
    shift = placement_shift(after, g)
    reference = ke_b if ke_com_reference is None else ke_com_reference
    non_negative = dissipated + shift >= -tolerances.dissipated_energy_floor_rel * max(reference, TINY)
    within = (mass_res <= tolerances.mass_rel and mom_res <= tolerances.momentum_rel
              and (l_res is None or l_res <= tolerances.angular_momentum_rel) and non_negative)
    report = ConservationReport(
        mass_before_kg=m_b, mass_after_kg=m_a, mass_residual_rel=mass_res, momentum_before_kg_m_per_s=_vec(p_b),
        momentum_after_kg_m_per_s=_vec(p_a), momentum_residual_rel=mom_res, angular_momentum_before_kg_m2_per_s=_vec(l_b),
        angular_momentum_after_kg_m2_per_s=_vec(l_a), angular_momentum_residual_rel=l_res, angular_momentum_unmodelled=angular_unmodelled,
        energy=EnergyReport(
            kinetic_translational_before_j=ke_b, kinetic_translational_after_j=ke_a, rotational_before_j=rot_b, rotational_after_j=rot_a,
            mutual_potential_before_j=pot_b, mutual_potential_after_j=pot_a, self_gravitational_before_j=self_b,
            self_gravitational_after_j=self_a, dissipated_j=dissipated, dissipated_non_negative=non_negative),
        tolerances=tolerances, within_tolerance=within)
    return report, shift
