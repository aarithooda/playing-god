"""Realisation and atomic application of a collision outcome (plan 3.7, 4.6, 9.3). Stage 4a: remnants only; the debris mass of an event is
ONE parcel (full fragmentation is Stage 5). Scientific content PROVISIONAL (D-038); the launch speed of the parcel is a placeholder (D-043).

`realise(data, spec, ...)` is PURE: from the frozen `ImpactState` and the model's `OutcomeSpec` it builds a `CollisionResult` with the
conservation report; nothing is mutated and no random numbers are drawn, so a replay gives the same result bit for bit.
`validate_result` checks the whole result BEFORE anything is changed; `apply_result` then changes the engine state, and any exception
after the first change makes the service roll the whole step back (transactional step).

Geometry of the products (all in the pair's centre-of-mass frame at the contact time, then moved to the detection time):
- single remnant (merge-like outcomes): at the COM with the COM velocity; its spin is the whole angular momentum about the COM, orbital
  plus both spins (S = I omega); a remnant without a sourced moment of inertia books it in the service's booked-spin ledger and the
  report says `angular momentum unmodelled`.
- remnant + parcel (accretion, erosion, disruption): both lie on a line through the COM along the downrange direction e (the projectile's
  relative velocity), separated by (R1 + R_d)(1 + eps) (rule E-12), with relative speed w = 1.1 v_esc, a PLACEHOLDER from the practice of
  Chambers (2013) / Childs & Steffen (2022), "somewhat arbitrary" (DQ-6, replaced in Stage 5). Collinear positions and velocities carry
  no orbital angular momentum, so the remnant's spin closes the budget exactly.
- hit-and-run: the normal component of the relative velocity is removed (inelastic contact, tangential motion kept), the pair is
  separated by (1 + eps) along the normal and the tangential speed is divided by (1 + eps): momentum and angular momentum are
  conserved exactly and the removed normal kinetic energy is dissipated. The target remnant keeps its spin angular momentum, the
  projectile is unchanged (its erosion is not modelled, warning from the model), the target's lost mass is a parcel.
"""
import math
import random
from dataclasses import dataclass
from typing import Callable, Optional

from backend.collisions import add_named_particle
from backend.errors import CodedError
from backend.impact import conservation as cons
from backend.impact import damage
from backend.impact import fragments as frag
from backend.impact import rotation as rot
from backend.impact.contracts import (BodyImpactState, BodyPost, CollisionInput, CollisionResult, DebrisDescriptor, Fidelity, MassLedger,
                                      MaterialProfile, MaterialRef, OutcomeSpec, ParcelPost, RotationState, SizeDistribution, Vec3)
from backend.impact.materials import get_profile
from backend.impact.models.ls12 import BETA

DEBRIS_LAUNCH_FACTOR = 1.1  # placeholder relative speed of the parcel in units of the mutual escape speed (D-043, DQ-6 choice (a))
MASS_FLOOR = 1.0e-15  # a debris mass below this fraction of the total is numerical noise and is folded into the remnant
SINGLE_REMNANT = frozenset({"perfect_merge", "graze_and_merge", "envelope_deposition", "envelope_merge_approximation", "cratering"})
KEEPS_TARGET_ID = frozenset({"partial_accretion", "partial_erosion"})
NEW_REMNANT = frozenset({"catastrophic_disruption", "super_catastrophic_disruption"})

Vec = tuple[float, float, float]


# ------------------------------------------------------------------------------------------------ small vector helpers
def _add(a, b) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _sub(a, b) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _scale(a, s: float) -> Vec:
    return (a[0] * s, a[1] * s, a[2] * s)


def _dot(a, b) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a) -> float:
    return math.sqrt(_dot(a, a))


def _unit(a) -> Vec:
    n = _norm(a)
    return (a[0] / n, a[1] / n, a[2] / n)


def _sphere_radius(mass: float, density: float) -> float:
    return (3.0 * mass / (4.0 * math.pi * density)) ** (1.0 / 3.0)


# ------------------------------------------------------------------------------------------------ body helpers
def ref_from_profile(profile: Optional[MaterialProfile]) -> Optional[MaterialRef]:
    """The MaterialRef that resolves to `profile` (layer overrides kept), or None."""
    if profile is None:
        return None
    registry = get_profile(profile.id)
    layers = None if registry is not None and registry.layers == profile.layers else profile.layers
    return MaterialRef(profile.id, layers)


def _inertia(body: BodyImpactState, mass: Optional[float] = None, radius: Optional[float] = None) -> Optional[float]:
    p = body.material_profile
    if p is None or p.moment_of_inertia_factor is None:
        return None
    return p.moment_of_inertia_factor * (body.mass_kg if mass is None else mass) * (body.radius_m if radius is None else radius) ** 2


def _spin_vector(body: BodyImpactState) -> Vec:
    if body.spin_rad_per_s is None:
        return (0.0, 0.0, 0.0)
    i = _inertia(body)
    return _scale(body.spin_rad_per_s.as_tuple(), i if i is not None else 0.0)


def _state_before(body: BodyImpactState) -> cons.State:
    return cons.State(body.mass_kg, body.position_m.as_tuple(), body.velocity_m_per_s.as_tuple(), body.radius_m, _spin_vector(body),
                      _inertia(body) if body.spin_rad_per_s is not None else None)


def _orientation_at(body: BodyImpactState, t_s: float) -> rot.Quat:
    if body.orientation is None or body.spin_rad_per_s is None:
        return rot.IDENTITY
    state = RotationState(body.spin_rad_per_s, body.orientation.quaternion, body.orientation.epoch_s, 1.0)
    return rot.orientation_at(state, t_s)


def _rotation_post(spin: Vec, inertia: Optional[float], q0: rot.Quat, t_s: float, had_rotation: bool = True) -> Optional[RotationState]:
    """A rotation state for the product, or None: no sourced moment of inertia (angular momentum is then booked), or nothing to
    represent (zero spin and the body did not rotate before: no state is invented)."""
    if inertia is None or (not had_rotation and _norm(spin) == 0.0):
        return None
    return RotationState(Vec3.of(_scale(spin, 1.0 / inertia)), q0, t_s, inertia)


# ------------------------------------------------------------------------------------------------ realisation
REPLAY_KEYS = ("replayParcelAllowed", "replayRepresentSpin", "replayBudgetFragments", "replayBudgetParcels", "replayMinMassFraction")
# warnings the ENGINE adds around `realise` (not the model): a replay passes them back so the realisation is the same
ENGINE_WARNINGS = ("model_failed_fallback", "spin_not_represented_fallback", "cascade_limit_reached")


def replay_parameters(parcel_allowed: bool, represent_spin: bool, budget: "Optional[frag.FragmentBudget]") -> dict:
    """The live-state inputs of `realise` that are not in the frozen impact (body budget, tier), recorded so a dry-run can reproduce it."""
    out = {"replayParcelAllowed": 1.0 if parcel_allowed else 0.0, "replayRepresentSpin": 1.0 if represent_spin else 0.0}
    if budget is not None:
        out["replayBudgetFragments"] = float(budget.max_fragments)
        out["replayBudgetParcels"] = float(budget.max_parcels)
        out["replayMinMassFraction"] = -1.0 if budget.min_mass_fraction is None else float(budget.min_mass_fraction)
    return out


def frag_size_distribution(beta: float, d_max: float):
    """Descriptor of an untracked population: power law with the LS12 exponent between a provisional lower cut and its upper cut."""
    return SizeDistribution("power-law", beta, frag.PARCEL_DMIN_RATIO * d_max, d_max)


def realise(data: CollisionInput, spec: OutcomeSpec, g: float, parcel_allowed: bool = True, extra_warnings: tuple[str, ...] = (),
            represent_spin: bool = True, budget: "Optional[frag.FragmentBudget]" = None) -> CollisionResult:
    """Build the validated-by-construction `CollisionResult` of `spec` for the frozen impact. Pure. With `represent_spin=False` no product
    gets a rotation state (the angular momentum is booked in the ledger and reported unmodelled): the last-resort fallback that cannot fail.
    With a `budget` (Stage 5) the debris of a non-hit-and-run outcome is realised into tracked fragments and parcels (`fragments.py`);
    without one it is ONE parcel (the Stage 4a placeholder, kept for the pure-model tests and the hit-and-run outcome)."""
    imp, cfg = data.impact, data.config
    tgt, prj = imp.target, imp.projectile
    seq = data.event_id.split("-", 1)[1]
    m_t, m_p, m_tot = tgt.mass_kg, prj.mass_kg, imp.total_mass_kg
    t_td = imp.detection_time_s
    tau = imp.rewind_s
    warnings = list(dict.fromkeys((*spec.warnings, *extra_warnings)))
    fidelity = dict(spec.fidelity)
    fidelity["placement"] = Fidelity.APPROXIMATION

    before = [_state_before(tgt), _state_before(prj)]
    x_c, v_c = cons.centre_of_mass(before)
    x_c_td = _add(x_c, _scale(v_c, tau))  # the COM moves uniformly between the contact and the detection time
    l_orb = cons.orbital_angular_momentum(before, x_c, v_c)
    spin_total = cons.spin_angular_momentum(before)
    s_budget = _add(l_orb, spin_total)

    outcome = spec.outcome
    m1 = spec.largest_remnant.mass_kg
    debris = spec.debris_mass_kg
    if outcome != "hit_and_run" and abs(m1 + debris - m_tot) > 1e-12 * m_tot:
        raise ValueError(f"the outcome spec does not conserve mass: {m1} + {debris} != {m_tot}")
    returned = 0.0
    if debris > 0.0 and (debris < MASS_FLOOR * m_tot or not parcel_allowed):
        returned = debris
        if outcome != "hit_and_run":
            m1, debris = m_tot, 0.0
        else:
            m1, debris = m1 + debris, 0.0
        warnings.append("debris_returned_to_remnant")
    rho_bulk = m_tot / (4.0 / 3.0 * math.pi * (tgt.radius_m ** 3 + prj.radius_m ** 3))
    rho_target = m_t / (4.0 / 3.0 * math.pi * tgt.radius_m ** 3)
    u = imp.relative_velocity_m_per_s.as_tuple()
    n_hat = imp.contact_normal.as_tuple()
    speed = imp.impact_speed_m_per_s
    v_esc = imp.mutual_escape_speed_m_per_s.physical_radii
    eps = cfg.separation_epsilon

    material_t, material_p = ref_from_profile(tgt.material_profile), ref_from_profile(prj.material_profile)
    kept_profile = tgt.material_profile if (material_t == material_p) else None
    k_kept = None if kept_profile is None else kept_profile.moment_of_inertia_factor

    recoil_report = 0.0
    transformed: list[BodyPost] = []
    created: list[BodyPost] = []
    parcels: list[ParcelPost] = []
    removed: list[str] = []
    after: list[cons.State] = []
    unmodelled: Optional[str] = None
    q_td = _orientation_at(tgt, t_td)
    descriptor_seed = data.seed

    def parcel_post(mass: float, radius: float, pos: Vec, vel: Vec) -> ParcelPost:
        desc = DebrisDescriptor(total_mass_kg=mass, size_distribution=None, velocity_dispersion_m_per_s=0.0,
                                material_profile_id=None if tgt.material_profile is None else tgt.material_profile.id, sample_seed=descriptor_seed)
        return ParcelPost(id=f"debris-{seq}-0", mass_kg=mass, radius_m=radius, position_m=Vec3.of(pos), velocity_m_per_s=Vec3.of(vel),
                          debris=desc, origin_event_id=data.event_id)

    if outcome == "hit_and_run":
        # --- two remnants (+ parcel). Normal relative velocity removed, tangential kept, separated along the normal.
        r_rel_t = _sub(tgt.position_m.as_tuple(), x_c)
        r_rel_p = _sub(prj.position_m.as_tuple(), x_c)
        r_vec = _sub(r_rel_p, r_rel_t)  # projectile - target at contact, |r| = R_t + R_p
        u_n = _scale(n_hat, _dot(u, n_hat))
        u_tan = _sub(u, u_n)
        m_g = m_t  # the target group (remnant + parcel) keeps the target's total mass
        rem1_mass = m1
        r1 = _sphere_radius(rem1_mass, rho_target)
        i1 = None if tgt.material_profile is None or tgt.material_profile.moment_of_inertia_factor is None or not represent_spin else tgt.material_profile.moment_of_inertia_factor * rem1_mass * r1 * r1
        s_t, s_p = _spin_vector(tgt), _spin_vector(prj)
        i2 = _inertia(prj) if represent_spin else None
        if not represent_spin:
            if _norm(_add(s_t, s_p)) > 0.0:
                unmodelled = "rotation states are not represented in this fallback: the spin angular momentum is booked in the spin ledger"
            s_t = s_p = (0.0, 0.0, 0.0)
        have_parcel = debris > 0.0
        if have_parcel:
            rd = _sphere_radius(debris, rho_target)
            e_hat = _unit(u_tan) if _norm(u_tan) > 0.0 else _unit(u)
            s_sep = (r1 + rd) * (1.0 + eps)
            reach = max(s_sep * debris / m_g + r1, s_sep * rem1_mass / m_g + rd)  # how far the target group extends from its COM
        else:
            reach = r1
        # separation factor kappa >= 1 + eps: the projectile must clear the group. r' = kappa r and u' = u_tan / kappa keep r x u
        # (angular momentum) exactly; the extra slowing is dissipated.
        kappa = max(1.0 + eps, (reach + prj.radius_m) * (1.0 + eps) / _norm(r_vec))
        new_r = _scale(r_vec, kappa)
        new_u = _scale(u_tan, 1.0 / kappa)
        v_g = _sub(v_c, _scale(new_u, m_p / m_tot))
        v_2 = _add(v_c, _scale(new_u, m_g / m_tot))
        x_g = _sub((0.0, 0.0, 0.0), _scale(new_r, m_p / m_tot))
        x_2 = _scale(new_r, m_g / m_tot)
        if have_parcel:
            w = DEBRIS_LAUNCH_FACTOR * v_esc
            pos1 = _sub(x_g, _scale(e_hat, s_sep * debris / m_g))
            posd = _add(x_g, _scale(e_hat, s_sep * rem1_mass / m_g))
            vel1 = _sub(v_g, _scale(e_hat, w * debris / m_g))
            veld = _add(v_g, _scale(e_hat, w * rem1_mass / m_g))
            warnings.append("debris_launch_speed_placeholder")
        else:
            pos1, vel1 = x_g, v_g
        w_target = _rotation_post(s_t, i1, q_td, t_td, tgt.spin_rad_per_s is not None)
        w_proj = _rotation_post(s_p, i2, _orientation_at(prj, t_td), t_td, prj.spin_rad_per_s is not None)
        absolute = lambda rel: _add(x_c_td, rel)  # noqa: E731
        transformed.append(BodyPost(id=tgt.id, mass_kg=rem1_mass, radius_m=r1, position_m=Vec3.of(absolute(pos1)), velocity_m_per_s=Vec3.of(vel1 if have_parcel else v_g),
                                    material=material_t, rotation=w_target, origin_event_id=None))
        transformed.append(BodyPost(id=prj.id, mass_kg=m_p, radius_m=prj.radius_m, position_m=Vec3.of(absolute(x_2)), velocity_m_per_s=Vec3.of(v_2),
                                    material=material_p, rotation=w_proj))
        after = [cons.State(rem1_mass, _add(x_c, pos1), vel1 if have_parcel else v_g, r1, s_t, i1),
                 cons.State(m_p, _add(x_c, x_2), v_2, prj.radius_m, s_p, i2)]
        if have_parcel:
            parcels.append(parcel_post(debris, rd, absolute(posd), veld))
            after.append(cons.State(debris, _add(x_c, posd), veld, rd, self_bound=False))
        if unmodelled is None and i1 is None and any(c != 0.0 for c in s_t):
            unmodelled = "the target remnant has no moment of inertia: its spin angular momentum is booked in the spin ledger"
        warnings.append("hit_and_run_inelastic_normal_contact")
        # energy test reference: the removed normal kinetic energy is dissipated by construction
    else:
        # --- one largest remnant + (Stage 5) tracked fragments and parcels on a ring, or (4a placeholder) ONE parcel on a line through the COM
        staged = budget is not None and debris > 0.0
        fragment_posts: list[BodyPost] = []
        if staged:
            rng = random.Random(data.seed)
            split = frag.split_masses(debris, m1, m_tot, BETA, budget.max_fragments, budget.min_mass_fraction, rng)
            tail = split.tail_kg
            if tail > 0.0 and (budget.max_parcels <= 0 or tail < MASS_FLOOR * m_tot):
                # D-047: no parcel may exist (or the tail is numerical noise): the untracked mass goes to the largest remnant, momentum closed below
                returned += tail
                m1 += tail
                debris -= tail
                tail = 0.0
                warnings.append("debris_returned_to_remnant")
            n_par = 0 if tail <= 0.0 else max(1, min(budget.max_parcels, 4))
            parcel_masses = [tail / n_par] * n_par if n_par else []
            if n_par:
                parcel_masses[-1] = tail - math.fsum(parcel_masses[:-1])
            have_parcel = bool(split.tracked) or n_par > 0
            warnings.extend(("ejection_speed_provisional", "provisional:CP-SCI-1", "debris_realised_as_fragments"))
            fidelity["fragments"] = Fidelity.APPROXIMATION
            fidelity["debrisParcels"] = Fidelity.STATISTICAL
        else:
            have_parcel = debris > 0.0
        rem_radius = _sphere_radius(m1, rho_bulk)
        i1 = None if (k_kept is None or not represent_spin) else k_kept * m1 * rem_radius ** 2
        e_hat = _unit(u) if speed > 0.0 else n_hat
        products_after: list[cons.State] = []
        recoil = 0.0
        if staged and have_parcel:
            masses = [*split.tracked, *parcel_masses]
            radii = [_sphere_radius(m, rho_bulk) for m in masses]
            lay = frag.ring_layout(m1, rem_radius, masses, radii, frag.plane_basis(u if speed > 0.0 else n_hat, n_hat), v_esc, eps, g, rng)
            pos1, vel1 = lay.remnant_position, _add(v_c, lay.remnant_velocity)
            recoil = lay.recoil_m_per_s
            for k, (mass, radius, pos, vel) in enumerate(zip(masses, radii, lay.positions, lay.velocities)):
                abs_vel = _add(v_c, vel)
                if k < len(split.tracked):
                    fragment_posts.append(BodyPost(id=f"frag-{seq}-{k}", mass_kg=mass, radius_m=radius, position_m=Vec3.of(_add(x_c_td, pos)),
                                                   velocity_m_per_s=Vec3.of(abs_vel), representation="fragment",
                                                   material=None if kept_profile is None else ref_from_profile(kept_profile),
                                                   origin_event_id=data.event_id))
                    products_after.append(cons.State(mass, _add(x_c, pos), abs_vel, radius))
                else:
                    index = k - len(split.tracked)
                    desc = DebrisDescriptor(
                        total_mass_kg=mass, size_distribution=frag_size_distribution(BETA, 2.0 * radius),
                        velocity_dispersion_m_per_s=(frag.EJECTION_FACTOR_RANGE[1] - frag.EJECTION_FACTOR_RANGE[0]) * v_esc,
                        material_profile_id=None if tgt.material_profile is None else tgt.material_profile.id, sample_seed=descriptor_seed)
                    parcels.append(ParcelPost(id=f"debris-{seq}-{index}", mass_kg=mass, radius_m=radius, position_m=Vec3.of(_add(x_c_td, pos)),
                                              velocity_m_per_s=Vec3.of(abs_vel), debris=desc, origin_event_id=data.event_id))
                    products_after.append(cons.State(mass, _add(x_c, pos), abs_vel, radius, self_bound=False))
        elif have_parcel:
            rd = _sphere_radius(debris, rho_bulk)
            s_sep = (rem_radius + rd) * (1.0 + eps)
            w = DEBRIS_LAUNCH_FACTOR * v_esc
            pos1 = _scale(e_hat, -s_sep * debris / m_tot)
            posd = _scale(e_hat, s_sep * m1 / m_tot)
            vel1 = _sub(v_c, _scale(e_hat, w * debris / m_tot))
            veld = _add(v_c, _scale(e_hat, w * m1 / m_tot))
            warnings.append("debris_launch_speed_placeholder")
            parcels.append(parcel_post(debris, rd, _add(x_c_td, posd), veld))
            products_after.append(cons.State(debris, _add(x_c, posd), veld, rd, self_bound=False))
        else:
            pos1, vel1 = (0.0, 0.0, 0.0), v_c
        if staged and have_parcel:
            # products off the line: their orbital angular momentum about the COM is not zero, so the remnant's spin is what is left
            orbital_products = cons.orbital_angular_momentum([cons.State(m1, _add(x_c, pos1), vel1, rem_radius), *products_after], x_c, v_c)
            s_remnant_budget = _sub(s_budget, orbital_products)
        else:
            s_remnant_budget = s_budget
        if i1 is not None:
            spin1 = s_remnant_budget
            if have_parcel:
                # DQ-13 (D-043, provisional): a remnant cannot spin faster than break-up. With debris present the excess angular
                # momentum is carried by the dispersed debris (its internal rotation is not tracked): booked in the ledger, reported.
                cap = i1 * math.sqrt(g * m1 / rem_radius ** 3)
                if _norm(spin1) > cap:
                    spin1 = _scale(spin1, cap / _norm(spin1))
                    unmodelled = "the angular momentum above the remnant's break-up spin is carried by the debris population (not tracked): booked in the spin ledger"
                    warnings.append("remnant_spin_capped_at_breakup")
        else:
            spin1 = (0.0, 0.0, 0.0)
            if _norm(s_remnant_budget) > 0.0:
                unmodelled = "the remnant has no sourced moment of inertia: the angular momentum is booked in the spin ledger, not in a spin state"
        keeps = outcome in SINGLE_REMNANT or outcome in KEEPS_TARGET_ID
        remnant_id = tgt.id if keeps else f"rem-{seq}-0"
        post = BodyPost(id=remnant_id, mass_kg=m1, radius_m=rem_radius, position_m=Vec3.of(_add(x_c_td, pos1)), velocity_m_per_s=Vec3.of(vel1),
                        material=None if kept_profile is None else ref_from_profile(kept_profile), rotation=_rotation_post(spin1, i1, q_td, t_td, tgt.spin_rad_per_s is not None or prj.spin_rad_per_s is not None),
                        origin_event_id=None if keeps else data.event_id)
        (transformed if keeps else created).append(post)
        created.extend(fragment_posts)
        recoil_report = recoil
        removed = [prj.id] if keeps else [tgt.id, prj.id]
        after = [cons.State(m1, _add(x_c, pos1), vel1, rem_radius, spin1, i1), *products_after]
        if i1 is not None and rem_radius > 0.0 and m1 > 0.0:
            omega = _norm(spin1) / i1
            if omega > math.sqrt(g * m1 / rem_radius ** 3):
                warnings.append("remnant_spin_supercritical")  # DQ-13: kept and reported (D-043); no shedding model in v1

    # angular momentum scale of the residual: the larger of |L_before| and mu R v
    scale = imp.reduced_mass_kg * (tgt.radius_m + prj.radius_m) * speed
    report, shift = cons.build_report(before, after, g, cfg.tolerances, scale, unmodelled)
    ledger = MassLedger(consumed_bodies_kg=m_tot, remnants_kg=math.fsum(p.mass_kg for p in (*transformed, *created) if p.representation == "body"),
                        fragments_kg=math.fsum(p.mass_kg for p in created if p.representation == "fragment"),
                        parcels_kg=math.fsum(p.mass_kg for p in parcels), escaped_kg=0.0, returned_to_remnant_kg=returned)
    surviving = {p.id for p in (*transformed, *created)}
    sites, site_warnings = damage.build_sites(data, outcome, tgt.material_profile, prj.material_profile,
                                              tgt.id in surviving, prj.id in surviving)
    warnings.extend(site_warnings)
    if sites:
        fidelity["siteCraterSize"] = Fidelity.UNSUPPORTED
        fidelity["sitePropagation"] = Fidelity.APPROXIMATION if any(s.propagation.wave_speed_m_per_s for s in sites) else Fidelity.UNSUPPORTED
    result = CollisionResult(
        event_id=data.event_id, outcome=outcome, removed_body_ids=tuple(removed), transformed=tuple(transformed), created=tuple(created),
        debris_parcels=tuple(parcels), impact_sites=sites, mass_ledger=ledger, conservation=report, warnings=tuple(dict.fromkeys(warnings)),
        fidelity=fidelity, fields_extra={"placementShiftJ": shift, "momentumClosureRecoilMPerS": recoil_report,
                                                                  **replay_parameters(parcel_allowed, represent_spin, budget)})
    return CollisionResult.from_dict({**result.to_dict(), "resultDigest": result.compute_digest()})


# ------------------------------------------------------------------------------------------------ validation and application
class ResultInvalid(ValueError):
    """The result failed validation; nothing was changed."""


def validate_result(result: CollisionResult, live_ids: set[str], data: CollisionInput) -> None:
    """Whole-result checks that need the live engine, run BEFORE any mutation. Raises ResultInvalid."""
    if not result.conservation.within_tolerance:
        raise ResultInvalid("conservation residual outside tolerance: " + _why(result))
    for pid in result.removed_body_ids:
        if pid not in live_ids:
            raise ResultInvalid(f"removed body {pid} does not exist")
    for post in result.transformed:
        if post.id not in live_ids:
            raise ResultInvalid(f"transformed body {post.id} does not exist")
    for post in (*result.created, *result.debris_parcels):
        if post.id in live_ids:
            raise ResultInvalid(f"new body id {post.id} already exists (ids are never reused)")
    products = [(p.id, p.position_m.as_tuple(), p.radius_m) for p in (*result.transformed, *result.created, *result.debris_parcels)]
    for i in range(len(products)):
        for j in range(i + 1, len(products)):
            d = _norm(_sub(products[i][1], products[j][1]))
            if d < (products[i][2] + products[j][2]) * (1.0 - 1.0e-12):
                raise ResultInvalid(f"products {products[i][0]} and {products[j][0]} overlap ({d:.6g} m < {products[i][2] + products[j][2]:.6g} m)")
    site_ids = [s.site_id for s in result.impact_sites]
    if len(set(site_ids)) != len(site_ids):
        raise ResultInvalid("duplicate impact site ids")
    survivors = {p.id for p in (*result.transformed, *result.created)}
    for s in result.impact_sites:
        if s.body_id not in survivors:
            raise ResultInvalid(f"impact site {s.site_id} is on {s.body_id}, which does not survive the event")
    if abs(result.mass_ledger.consumed_bodies_kg - data.impact.total_mass_kg) > 1e-12 * data.impact.total_mass_kg:
        raise ResultInvalid("the mass ledger does not match the impact")


def _why(result: CollisionResult) -> str:
    c = result.conservation
    return (f"mass {c.mass_residual_rel:.3g}, momentum {c.momentum_residual_rel:.3g}, angular momentum {c.angular_momentum_residual_rel}, "
            f"dissipated {c.energy.dissipated_j:.6g} J (placement artefact {result.fields_extra.get('placementShiftJ', 0.0):.6g} J)")


@dataclass
class ApplyState:
    """What `apply_result` may change; the service builds it from its own tables at call time."""

    sim: object  # a REBOUND simulation
    meta: dict
    materials: dict
    rotations: dict
    products: dict  # body id -> (representation, origin event id, DebrisDescriptor | None) for bodies created by a collision
    ledger: object  # heat_J and spin (booked-spin ledger)
    make_meta: Callable[[object, str, str], object]  # (parent display metadata, new_id, role) -> display metadata
    bump_segment: Callable[[], None]
    sites: Optional[dict] = None  # body id -> tuple of ImpactSite (body-local); None = the caller keeps no site table


def apply_result(result: CollisionResult, state: ApplyState) -> None:
    """Change the engine state exactly as `result` says. Callers have validated; any exception here rolls the step back."""
    sim = state.sim
    by_name = {p.name: p for p in sim.particles}
    # the parent (display metadata source) of every new body is the target of this event: the first removed/transformed body id
    parent_id = (result.transformed[0].id if result.transformed else result.removed_body_ids[0])
    parent_meta = state.meta[parent_id]  # read before the parent may be removed
    spin_ledger = state.ledger.spin
    consumed_spin = [(0.0, 0.0, 0.0)]
    for pid in result.removed_body_ids:
        state.materials.pop(pid, None)
        if state.sites is not None:
            state.sites.pop(pid, None)  # a retired body takes its surface records with it
        old = state.rotations.pop(pid, None)
        if old is not None:
            consumed_spin.append(rot.spin_angular_momentum(old))
    for post in result.transformed:
        p = by_name[post.id]
        pos, vel = post.position_m, post.velocity_m_per_s
        p.x, p.y, p.z = pos.x, pos.y, pos.z
        p.vx, p.vy, p.vz = vel.x, vel.y, vel.z
        p.m, p.r = post.mass_kg, post.radius_m
        _set_tables(state, post)
    for pid in result.removed_body_ids:
        sim.remove(next(q.index for q in sim.particles if q.name == pid))
        state.meta.pop(pid, None)
        state.products.pop(pid, None)
    for post in result.created:
        add_named_particle(sim, post.id, m=post.mass_kg, r=post.radius_m, x=post.position_m.x, y=post.position_m.y, z=post.position_m.z,
                           vx=post.velocity_m_per_s.x, vy=post.velocity_m_per_s.y, vz=post.velocity_m_per_s.z)
        state.meta[post.id] = state.make_meta(parent_meta, post.id, "fragment" if post.representation == "fragment" else "remnant")
        state.products[post.id] = (post.representation, post.origin_event_id, None)
        _set_tables(state, post)
    for parcel in result.debris_parcels:
        add_named_particle(sim, parcel.id, m=parcel.mass_kg, r=parcel.radius_m, x=parcel.position_m.x, y=parcel.position_m.y,
                           z=parcel.position_m.z, vx=parcel.velocity_m_per_s.x, vy=parcel.velocity_m_per_s.y, vz=parcel.velocity_m_per_s.z)
        state.meta[parcel.id] = state.make_meta(parent_meta, parcel.id, "parcel")
        state.products[parcel.id] = ("debris-parcel", parcel.origin_event_id, parcel.debris)
    if state.sites is not None:
        for site in result.impact_sites:
            kept = list(state.sites.get(site.body_id, ()))
            kept.append(site)
            if len(kept) > damage.MAX_SITES_PER_BODY:
                kept = damage.merge_sites(kept, f"agg-{site.event_id.split('-', 1)[1]}-{site.body_id}")
            state.sites[site.body_id] = tuple(kept)
    # energy and angular momentum that no state represents go to the existing ledgers (nothing vanishes)
    c = result.conservation
    state.ledger.heat_J += max(c.energy.dissipated_j, 0.0)
    if c.angular_momentum_unmodelled:
        before, after = c.angular_momentum_before_kg_m2_per_s, c.angular_momentum_after_kg_m2_per_s
        booked = (before.x - after.x, before.y - after.y, before.z - after.z)  # what no state represents
        target_id = (result.transformed or result.created)[0].id
        old = spin_ledger.get(target_id, [0.0, 0.0, 0.0])
        spin_ledger[target_id] = [old[0] + booked[0], old[1] + booked[1], old[2] + booked[2]]
    state.bump_segment()


def _set_tables(state: ApplyState, post: BodyPost) -> None:
    for table, value in ((state.materials, post.material), (state.rotations, post.rotation)):
        if value is None:
            table.pop(post.id, None)
        else:
            table[post.id] = value


def collision_unresolvable(detail: str) -> CodedError:
    return CodedError(detail, code="collision_unresolvable", status=500)
