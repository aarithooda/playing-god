"""Pre-impact capture and impact geometry (plan 3.5, spec 3.2). Pure functions: nothing here touches REBOUND.

REBOUND reports a contact only at the END of the internal step in which the swept spheres overlapped (detection time t_d).
This module freezes the pair's state before anything is mutated and derives the impact quantities:

- Contact time t_c = t_d - tau from the existing straight-line estimate (`backend.collisions.contact_time_estimate`).
  The pair is rewound linearly: x_k(t_c) = x_k(t_d) - v_k tau, velocities are the ones at t_d. By construction
  |r(t_c)| = R_t + R_p to round-off when a root exists. Error against the true curved path <= a_rel tau^2 / 2, which is
  at most the curvature budget (1 % of the contact distance) while the chunk criterion held (`chunk_criterion_satisfied`).
  Label: approximation. If no root exists (`contact_time_not_estimable`) the state at t_d is used unchanged.
- Normal n = r(t_c)/|r(t_c)| (target -> projectile); contact point x_c = x_t(t_c) + R_t n (inertial frame, D-010).
- Impact parameter b = sin(theta) = |n x u_hat| (LS12 convention, 0 = head-on); theta = asin(b).
- Q_R = 0.5 mu v^2 / M_tot; both mutual escape speeds are recorded: the physical-radii form sqrt(2 G M / (R_t + R_p)) and the
  Leinhardt & Stewart (2012) form sqrt(2 G M / R_C1) with R_C1 the radius of a sphere of the combined mass at
  rho_1 = 1000 kg/m^3 (the printed definition of R_C1 and rho_1; not one of the CP-SCI-1 disputed items). Recorded only.
- Target = the more massive body (ties: the lexicographically smaller id).
- Rotation is not tracked until Stage 2: body-local contact directions equal the inertial ones, latitude/longitude and
  the spin-axis angle are null.
SI units.
"""
import math
from typing import Sequence

from backend.impact.contracts import (BodyImpactState, ContactLatLon, ContactPointLocal, Environment, ImpactState,
                                      MutualEscapeSpeed, Vec3)
from backend.impact.models.perfect_merge import ContactTimeFn, PairBody, Vec, _add, _cross, _dot, _norm, _scale, _sub

LS12_RHO1_KG_PER_M3 = 1000.0  # printed density used by LS12 to define R_C1 (COLLISION_SCIENTIFIC_MODELS.md 3)
NEARBY_HILL_FACTOR = 3.0  # bodies within this many Hill radii of the pair are listed as nearby (plan 3.5 item 7)


def assign_roles(a: PairBody, b: PairBody) -> tuple[PairBody, PairBody]:
    """(target, projectile): the more massive body is the target; equal masses -> smaller id."""
    if a.mass > b.mass or (a.mass == b.mass and a.id < b.id):
        return a, b
    return b, a


def environment(pair: tuple[PairBody, PairBody], others: Sequence[PairBody], g: float) -> Environment:
    """Dominant external attractor of the pair's centre of mass (largest m/d^2, as `has_satellites`), the pair's Hill
    radius about it, and the bodies within NEARBY_HILL_FACTOR Hill radii."""
    total = pair[0].mass + pair[1].mass
    com = _scale(_add(_scale(list(pair[0].position), pair[0].mass), _scale(list(pair[1].position), pair[1].mass)), 1.0 / total)
    best: tuple[float, str] | None = None
    best_body: PairBody | None = None
    dists: dict[str, float] = {}
    for o in sorted(others, key=lambda body: body.id):
        d = _norm(_sub(list(o.position), com))
        dists[o.id] = d
        if d > 0.0:
            strength = o.mass / (d * d)
            if best is None or strength > best[0]:
                best, best_body = (strength, o.id), o
    if best_body is None:
        return Environment(None, None, ())
    d = dists[best_body.id]
    hill = d * (total / (3.0 * best_body.mass)) ** (1.0 / 3.0)
    nearby = sorted((dist, oid) for oid, dist in dists.items() if dist <= NEARBY_HILL_FACTOR * hill)
    return Environment(best_body.id, hill, tuple(oid for _, oid in nearby))


def capture_impact(first: PairBody, second: PairBody, t_detect: float, dt_last_done: float, others: Sequence[PairBody],
                   chunk_criterion_satisfied: bool, contact_time: ContactTimeFn, g: float) -> tuple[ImpactState, list[str]]:
    """Freeze the pair `first`/`second` (states at the detection time) into an `ImpactState`. Returns it with the
    warnings raised while computing it. Raises ValueError for a non-physical pair (non-positive mass or radius)."""
    tgt, prj = assign_roles(first, second)
    contact_dist = tgt.radius + prj.radius
    warnings: list[str] = []
    r_d = _sub(list(prj.position), list(tgt.position))
    u = _sub(list(prj.velocity), list(tgt.velocity))
    t_contact = contact_time(t_detect, dt_last_done, r_d, u, contact_dist)
    if t_contact is None:
        t_contact, estimated = t_detect, False
        warnings.append("contact_time_not_estimable")
    else:
        estimated = True
    tau = t_detect - t_contact
    x_t = [x - v * tau for x, v in zip(tgt.position, tgt.velocity)]
    x_p = [x - v * tau for x, v in zip(prj.position, prj.velocity)]
    r_c = _sub(x_p, x_t)
    dist = _norm(r_c)
    speed = _norm(u)
    if dist > 0.0:
        normal = _scale(r_c, 1.0 / dist)
    else:
        warnings.append("degenerate_contact_normal")
        normal = _scale(u, -1.0 / speed) if speed > 0.0 else [1.0, 0.0, 0.0]
    if speed > 0.0:
        u_hat = _scale(u, 1.0 / speed)
        b = min(1.0, _norm(_cross(normal, u_hat)))
        if _dot(normal, u_hat) >= 0.0:
            warnings.append("not_approaching_at_contact")
    else:
        b = 0.0
        warnings.append("relative_velocity_zero")
    contact_point = _add(x_t, _scale(normal, tgt.radius))
    total = tgt.mass + prj.mass
    mu = tgt.mass * prj.mass / total
    ke_com = 0.5 * mu * speed * speed
    r_c1 = (3.0 * total / (4.0 * math.pi * LS12_RHO1_KG_PER_M3)) ** (1.0 / 3.0)
    momentum = _add(_scale(list(tgt.velocity), tgt.mass), _scale(list(prj.velocity), prj.mass))
    angular = _scale(_cross(r_c, u), mu)

    def state(body: PairBody, position: Vec) -> BodyImpactState:
        return BodyImpactState(id=body.id, mass_kg=body.mass, radius_m=body.radius, position_m=Vec3.of(position),
                               velocity_m_per_s=Vec3.of(body.velocity))

    impact = ImpactState(
        detection_time_s=t_detect, contact_time_s=t_contact, contact_time_estimated=estimated, rewind_s=tau,
        target=state(tgt, x_t), projectile=state(prj, x_p), relative_velocity_m_per_s=Vec3.of(u),
        impact_speed_m_per_s=speed, contact_point_m=Vec3.of(contact_point), contact_normal=Vec3.of(normal),
        contact_point_local=ContactPointLocal(Vec3.of(normal), Vec3.of(_scale(normal, -1.0))),
        contact_lat_lon_deg=ContactLatLon(None), impact_angle_deg=math.degrees(math.asin(b)), impact_parameter=b,
        spin_axis_angle_deg=None, total_mass_kg=total, reduced_mass_kg=mu, mass_ratio=prj.mass / tgt.mass,
        mutual_escape_speed_m_per_s=MutualEscapeSpeed(math.sqrt(2.0 * g * total / r_c1),
                                                      math.sqrt(2.0 * g * total / contact_dist)),
        specific_impact_energy_j_per_kg=ke_com / total, pair_momentum_kg_m_per_s=Vec3.of(momentum),
        pair_kinetic_energy_com_j=ke_com, pair_orbital_angular_momentum_com_kg_m2_per_s=Vec3.of(angular),
        environment=environment((tgt, prj), others, g), chunk_criterion_satisfied=chunk_criterion_satisfied)
    return impact, warnings
