"""Pre-impact capture and impact geometry (plan 3.5, spec 3.2). Pure functions: nothing here touches REBOUND.

REBOUND reports a contact only at the END of the internal step in which the swept spheres overlapped (detection time t_d).
This module freezes the pair's state before anything is mutated and derives the impact quantities:

- Contact state (D-063). Preferred: an integrated `ContactState` (`backend.impact.contact.refine_contact`): the pair's RELATIVE
  position and velocity at the first time the integrated path reaches |r| = R_t + R_p, so positions and velocities refer to the
  same time. The pair's centre of mass is taken from the detection state and moved back uniformly (x_com(t_c) = x_com(t_d) -
  v_com tau, v_com unchanged): it is what the live simulation holds, so total momentum stays continuous to round-off; the
  external impulse over tau that this ignores is far below the momentum tolerance. Method label `integrated`.
  Fallback (no integrated root, or a body changed earlier in the same batch): t_c from the straight-line estimate
  (`backend.collisions.contact_time_estimate`), positions rewound linearly x_k(t_c) = x_k(t_d) - v_k tau with the VELOCITIES OF
  t_d (label `linear_rewind`, warning `contact_state_linear_rewind`): the speed then includes the infall gained during the
  overlap (measured up to +1.3 % for two Earths, D-063). If no root exists either (`contact_time_not_estimable`) the state at
  t_d is used unchanged.
- Normal n = r(t_c)/|r(t_c)| (target -> projectile); contact point x_c = x_t(t_c) + R_t n (inertial frame, D-010).
- Impact parameter b = sin(theta) = |n x u_hat| (LS12 convention, 0 = head-on); theta = asin(b).
- Q_R = 0.5 mu v^2 / M_tot; both mutual escape speeds are recorded: the physical-radii form sqrt(2 G M / (R_t + R_p)) and the
  Leinhardt & Stewart (2012) form sqrt(2 G M / R_C1) with R_C1 the radius of a sphere of the combined mass at
  rho_1 = 1000 kg/m^3 (the printed definition of R_C1 and rho_1; not one of the CP-SCI-1 disputed items). Recorded only.
- Target = the more massive body (ties: the lexicographically smaller id).
- Rotation (Stage 2): a body with a rotation state contributes its spin (inertial frame), its orientation AT THE CONTACT TIME
  and its material profile (a copy from the registry, with layer overrides applied). The contact direction is also given in
  each body's own frame (inverse rotation by the orientation at t_c), so a site stays attached to the surface as the body
  rotates. The target's latitude/longitude is measured about its spin axis: the pole is the spin axis (fixed in the body), the
  prime meridian the body-local x axis projected perpendicular to it (the y axis if x is within 1e-6 of the pole). The spin-axis
  angle is the angle between the two spin axes. A body without a rotation state (no material, or no moment of inertia) has
  none of this: its local directions equal the inertial ones and everything else stays null (DQ-2).
SI units.
"""
import dataclasses
import math
from typing import Callable, Optional, Sequence

from backend.impact import rotation as rot
from backend.impact.contact import ContactState
from backend.impact.contracts import (BodyImpactState, ContactLatLon, ContactPointLocal, Environment, ImpactState,
                                      MaterialProfile, MaterialRef, MutualEscapeSpeed, Orientation, RotationState, Vec3)
from backend.impact.materials import get_profile
from backend.impact.models.perfect_merge import ContactTimeFn, PairBody, Vec, _add, _cross, _dot, _norm, _scale, _sub

LS12_RHO1_KG_PER_M3 = 1000.0  # printed density used by LS12 to define R_C1 (COLLISION_SCIENTIFIC_MODELS.md 3)
NEARBY_HILL_FACTOR = 3.0  # bodies within this many Hill radii of the pair are listed as nearby (plan 3.5 item 7)


# (material, rotation state) of a body, by id; the service supplies it from its side tables
BodyExtras = Callable[[str], "tuple[Optional[MaterialRef], Optional[RotationState]]"]


def resolved_profile(ref: Optional[MaterialRef]) -> Optional[MaterialProfile]:
    """The registry profile of a material reference, with the reference's layer override applied. None if unspecified."""
    if ref is None:
        return None
    profile = get_profile(ref.profile_id)
    if profile is None:
        raise ValueError(f"unknown material profile {ref.profile_id}")
    return profile if ref.layers is None else dataclasses.replace(profile, layers=ref.layers)


def site_latitude_longitude_deg(state: RotationState, t_s: float, direction_world: Sequence[float]) -> Optional[tuple[float, float]]:
    """Latitude and longitude (degrees) of a world direction relative to the body's spin pole and prime meridian; None when the
    body does not rotate. Defined in the body's own frame, so it does not change as the body rotates."""
    w = state.omega_rad_per_s.as_tuple()
    wn = math.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2])
    if wn == 0.0:
        return None
    pole = rot.inverse_rotate(state.q0, [c / wn for c in w])  # the spin axis in body coordinates (constant)
    site = rot.to_local(state, t_s, direction_world)
    ref = (1.0, 0.0, 0.0) if abs(pole[0]) < 1.0 - 1.0e-6 else (0.0, 1.0, 0.0)
    d = sum(a * b for a, b in zip(ref, pole))
    meridian = _unit([r - d * p for r, p in zip(ref, pole)])
    east = _cross(pole, meridian)
    lat = math.degrees(math.asin(max(-1.0, min(1.0, _dot(site, pole)))))
    lon = math.degrees(math.atan2(_dot(site, east), _dot(site, meridian)))
    return lat, lon


def _unit(v: Sequence[float]) -> list[float]:
    n = _norm(list(v))
    return [c / n for c in v]


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
                   chunk_criterion_satisfied: bool, contact_time: ContactTimeFn, g: float,
                   extras: Optional[BodyExtras] = None, contact_state: Optional[ContactState] = None,
                   representation_of: Optional[Callable[[str], str]] = None) -> tuple[ImpactState, list[str]]:
    """Freeze the pair `first`/`second` (states at the detection time) into an `ImpactState`. Returns it with the
    warnings raised while computing it. Raises ValueError for a non-physical pair (non-positive mass or radius).
    `contact_state`: the integrated state at contact (module docstring); None uses the linear rewind. `representation_of(id)` gives a
    body's representation ("body" | "fragment" | "debris-parcel"; H3): a debris parcel is a statistical population, which the models and
    the accounting must know."""
    tgt, prj = assign_roles(first, second)
    contact_dist = tgt.radius + prj.radius
    warnings: list[str] = []
    r_d = _sub(list(prj.position), list(tgt.position))
    u_d = _sub(list(prj.velocity), list(tgt.velocity))
    v_t, v_p = list(tgt.velocity), list(prj.velocity)
    if contact_state is not None and tgt.id in contact_state.states and prj.id in contact_state.states:
        (xt_c, vt_c), (xp_c, vp_c) = contact_state.states[tgt.id], contact_state.states[prj.id]
        t_contact, estimated, method = contact_state.time_s, True, "integrated"
        tau = t_detect - t_contact
        total_m = tgt.mass + prj.mass
        ft, fp = prj.mass / total_m, tgt.mass / total_m
        x_com = _scale(_add(_scale(list(tgt.position), tgt.mass), _scale(list(prj.position), prj.mass)), 1.0 / total_m)
        v_com = _scale(_add(_scale(v_t, tgt.mass), _scale(v_p, prj.mass)), 1.0 / total_m)
        x_com_c = _sub(x_com, _scale(v_com, tau))
        r_rel, u = _sub(list(xp_c), list(xt_c)), _sub(list(vp_c), list(vt_c))
        x_t, x_p = _sub(x_com_c, _scale(r_rel, ft)), _add(x_com_c, _scale(r_rel, fp))
        v_t, v_p = _sub(v_com, _scale(u, ft)), _add(v_com, _scale(u, fp))
        residual = contact_state.separation_residual_rel
    else:
        u = u_d
        method, residual = "linear_rewind", None
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
    momentum = _add(_scale(v_t, tgt.mass), _scale(v_p, prj.mass))
    angular = _scale(_cross(r_c, u), mu)

    lookup = extras or (lambda _id: (None, None))
    t_ref, t_rot = lookup(tgt.id)[0], lookup(tgt.id)[1]
    p_ref, p_rot = lookup(prj.id)[0], lookup(prj.id)[1]

    def state(body: PairBody, position: Vec, velocity: Vec, ref: Optional[MaterialRef], rotation: Optional[RotationState]) -> BodyImpactState:
        return BodyImpactState(
            id=body.id, mass_kg=body.mass, radius_m=body.radius, position_m=Vec3.of(position), velocity_m_per_s=Vec3.of(velocity),
            representation="body" if representation_of is None else representation_of(body.id),
            spin_rad_per_s=None if rotation is None else rotation.omega_rad_per_s,
            orientation=None if rotation is None else Orientation(rot.orientation_at(rotation, t_contact), t_contact),
            material_profile=resolved_profile(ref))

    def local(rotation: Optional[RotationState], direction: Sequence[float]) -> Vec3:
        return Vec3.of(direction if rotation is None else rot.to_local(rotation, t_contact, direction))

    lat_lon = None if t_rot is None else site_latitude_longitude_deg(t_rot, t_contact, normal)
    axis_angle = None
    if t_rot is not None and p_rot is not None:
        w_t, w_p = list(t_rot.omega_rad_per_s.as_tuple()), list(p_rot.omega_rad_per_s.as_tuple())
        n_t, n_p = _norm(w_t), _norm(w_p)
        if n_t > 0.0 and n_p > 0.0:
            axis_angle = math.degrees(math.acos(max(-1.0, min(1.0, _dot(w_t, w_p) / (n_t * n_p)))))

    impact = ImpactState(
        detection_time_s=t_detect, contact_time_s=t_contact, contact_time_estimated=estimated, rewind_s=tau,
        target=state(tgt, x_t, v_t, t_ref, t_rot), projectile=state(prj, x_p, v_p, p_ref, p_rot), relative_velocity_m_per_s=Vec3.of(u),
        impact_speed_m_per_s=speed, contact_point_m=Vec3.of(contact_point), contact_normal=Vec3.of(normal),
        contact_point_local=ContactPointLocal(local(t_rot, normal), local(p_rot, _scale(normal, -1.0))),
        contact_lat_lon_deg=ContactLatLon(lat_lon), impact_angle_deg=math.degrees(math.asin(b)), impact_parameter=b,
        spin_axis_angle_deg=axis_angle, total_mass_kg=total, reduced_mass_kg=mu, mass_ratio=prj.mass / tgt.mass,
        mutual_escape_speed_m_per_s=MutualEscapeSpeed(math.sqrt(2.0 * g * total / r_c1),
                                                      math.sqrt(2.0 * g * total / contact_dist)),
        specific_impact_energy_j_per_kg=ke_com / total, pair_momentum_kg_m_per_s=Vec3.of(momentum),
        pair_kinetic_energy_com_j=ke_com, pair_orbital_angular_momentum_com_kg_m2_per_s=Vec3.of(angular),
        environment=environment((tgt, prj), others, g), chunk_criterion_satisfied=chunk_criterion_satisfied,
        contact_state_method=method, detection_relative_speed_m_per_s=_norm(u_d), contact_separation_residual_rel=residual)
    return impact, warnings
