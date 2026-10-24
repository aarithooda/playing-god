"""Stage 6: body-local impact sites and the reduced-order disturbance front (plan 3.8, 4.7, 4.8; decision D-050). Pure functions.

SCIENTIFIC STATUS: PROVISIONAL / APPROXIMATION (D-038, D-050). CP-SCI-1 is not signed off.

What a site is. An `ImpactSite` records WHERE (a unit vector in the body's own frame, so it stays attached to the surface as the body
rotates), WHEN and with what energy a body was hit. It changes no mass, momentum or energy of the simulation (F3-AC-5): it is a record
that renderers and the inspector read.

What is NOT modelled (no source, so nothing is invented):
- crater radius and transient depth: the cratering model is Unsupported for every shipped profile (D-048 (2)); both are 0 and the result
  carries the warning `site_crater_size_unmodelled`;
- ejecta directions: the cone is the whole hemisphere above the local horizon (half angle 90 deg), i.e. no directional claim;
- absolute damage: the local falloff exponent is a provisional placeholder (`DMG-falloff-exponent`) of a qualitative profile.

Propagation (an approximation, NEVER a resolved shock). A site propagates only if the body's material profile carries a wave speed with
provenance (D-050): then the front reaches angular distance D at t_site + R D / c, and the relative geometric spreading factor
sqrt(sin D_ref / sin_reg(D)) (surface waves on a sphere, antipodal focusing; Schultz & Gault 1975, Meschede et al. 2011 as cited in the
plan, unread) is reported. No profile of the registry has a verified wave speed, so every shipped profile uses the STATIC fallback: the site
exists, `propagation.waveSpeedMPerS` is null, no front is computed, and the limitation is stated (`propagation_disabled_no_wave_speed`).
"""
import math
from dataclasses import dataclass
from typing import Optional

from backend.impact.contracts import (CollisionInput, DamageProfile, EjectaCone, Fidelity, ImpactSite, MaterialProfile, Propagation,
                                      Vec3)
from backend.impact.models.provisional import provisional

MAX_SITES_PER_BODY = 64
DAMAGE_FALLOFF_EXPONENT = 1.0  # PROVISIONAL (DMG-falloff-exponent): qualitative local falloff, no source
REGULARISATION_RAD = 0.05  # PROVISIONAL (PROP-regularisation): keeps the spreading factor finite at the site and its antipode

STATIC_WARNING = "propagation_disabled_no_wave_speed"
INVALID_WARNING = "propagation_disabled_invalid_wave_speed"
CRATER_WARNING = "site_crater_size_unmodelled"
PROFILE_WARNING = "site_damage_profile_provisional"

# bodies whose material is gas have no solid surface to mark
NO_SURFACE_CATEGORIES = frozenset({"gas"})
# outcomes that leave the TARGET's identity in place and so keep a site on it; disruption supersedes sites (L-SP-GLOBAL)
SITE_OUTCOMES = frozenset({"perfect_merge", "graze_and_merge", "partial_accretion", "partial_erosion", "hit_and_run", "cratering"})


@dataclass(frozen=True)
class PropagationSupport:
    supported: bool
    wave_speed_m_per_s: Optional[float]
    reason: str  # why it is static, or what the speed rests on


def propagation_support(profile: Optional[MaterialProfile]) -> PropagationSupport:
    """Supported only with a finite positive wave speed that the registry has given a provenance entry (it refuses a profile without
    one). Everything else is the static fallback, with the reason."""
    if profile is None:
        return PropagationSupport(False, None, "no material profile")
    speed = profile.wave_speed_m_per_s
    if speed is None:
        return PropagationSupport(False, None, "the profile has no sourced wave speed (static fallback)")
    if not (isinstance(speed, (int, float)) and math.isfinite(speed) and speed > 0.0):
        return PropagationSupport(False, None, "the wave speed is not a finite positive number (static fallback)")
    if not any(p.quantity == "waveSpeedMPerS" and p.basis in ("measured", "literature") and p.value == speed for p in profile.provenance):
        return PropagationSupport(False, None, "the wave speed has no measured/literature provenance entry matching it (static fallback)")
    return PropagationSupport(True, float(speed), "wave speed with provenance in the profile")


def _surface_profile(profile: Optional[MaterialProfile]) -> bool:
    return profile is not None and profile.category not in NO_SURFACE_CATEGORIES


def build_sites(data: CollisionInput, outcome: str, target_profile: Optional[MaterialProfile], projectile_profile: Optional[MaterialProfile],
                target_survives: bool, projectile_survives: bool) -> tuple[tuple[ImpactSite, ...], tuple[str, ...]]:
    """The sites an event leaves, with the warnings that state their limits. Pure; uses only the frozen impact."""
    if outcome not in SITE_OUTCOMES:
        return (), ()
    imp = data.impact
    seq = data.event_id.split("-", 1)[1]
    sites: list[ImpactSite] = []
    warnings: list[str] = []
    for body, local, profile, survives, other in (
            (imp.target, imp.contact_point_local.target, target_profile, target_survives, imp.projectile),
            (imp.projectile, imp.contact_point_local.projectile, projectile_profile, projectile_survives, imp.target)):
        if not survives or not _surface_profile(profile):
            continue
        support = propagation_support(profile)
        if not support.supported:
            warnings.append(INVALID_WARNING if "not a finite" in support.reason else STATIC_WARNING)
        sites.append(ImpactSite(
            site_id=f"site-{seq}-{len(sites)}", body_id=body.id, event_id=data.event_id, time_s=imp.contact_time_s,
            center_local=local, crater_radius_m=0.0, transient_depth_m=0.0,
            damage_profile=DamageProfile("power-law-falloff", other.radius_m, DAMAGE_FALLOFF_EXPONENT),
            ejecta_cone=EjectaCone(local, 90.0), energy_j=imp.pair_kinetic_energy_com_j,
            propagation=Propagation("geodesic-front-v1", support.wave_speed_m_per_s, None, support.supported),
            fidelity=Fidelity.APPROXIMATION))
    if sites:
        warnings += [CRATER_WARNING, PROFILE_WARNING]
    return tuple(sites), tuple(dict.fromkeys(warnings))


# ------------------------------------------------------------------------------------------------ propagation
def _angle_between(a: Vec3, b: Vec3) -> float:
    x, y = a.as_tuple(), b.as_tuple()
    dot = max(-1.0, min(1.0, x[0] * y[0] + x[1] * y[1] + x[2] * y[2]))
    return math.acos(dot)


def sin_regularised(angle: float) -> float:
    """sin D with the singular points D = 0 and D = pi smoothed: sqrt(sin^2 D + e^2)."""
    return math.sqrt(math.sin(angle) ** 2 + REGULARISATION_RAD ** 2)


@provisional("PROP-geodesic-front")
def arrival_time_s(site: ImpactSite, body_radius_m: float, angle_rad: float) -> Optional[float]:
    """Time the front reaches angular distance `angle_rad` (t_site + R D / c); None for a static site."""
    c = site.propagation.wave_speed_m_per_s
    if c is None:
        return None
    return site.time_s + body_radius_m * angle_rad / c


@provisional("PROP-geodesic-front")
def front_angle_rad(site: ImpactSite, body_radius_m: float, t_s: float) -> Optional[float]:
    """Angular radius the front has reached at `t_s`, clipped to [0, pi]; None for a static site, 0 before the event."""
    c = site.propagation.wave_speed_m_per_s
    if c is None:
        return None
    return min(max(c * (t_s - site.time_s) / body_radius_m, 0.0), math.pi)


@provisional("PROP-geodesic-front")
def spreading_factor(site: ImpactSite, body_radius_m: float, angle_rad: float) -> float:
    """Relative geometric spreading sqrt(sin_reg(D_ref) / sin_reg(D)), 1 at the footprint edge D_ref = inner radius / R. A dimensionless
    geometric factor, NOT a damage or a pressure; attenuation is not modelled (the profile has no attenuation length)."""
    d_ref = min(site.damage_profile.inner_radius_m / body_radius_m, math.pi / 2)
    return math.sqrt(sin_regularised(d_ref) / sin_regularised(angle_rad))


def local_falloff(site: ImpactSite, body_radius_m: float, angle_rad: float) -> float:
    """Qualitative local damage proxy in [0, 1]: 1 inside the footprint, (r / r_inner)^-exponent outside (provisional exponent)."""
    r = body_radius_m * angle_rad
    inner = site.damage_profile.inner_radius_m
    return 1.0 if r <= inner else (inner / r) ** site.damage_profile.exponent


def sample_surface(site: ImpactSite, body_radius_m: float, direction_local: Vec3, t_s: float) -> dict:
    """What the model says at one surface point (`direction_local`, unit) at time `t_s`. Before the event nothing exists; for a static
    site only the local proxy is given (no front, no propagated factor)."""
    if t_s < site.time_s:
        return {"state": "not_yet", "angleRad": None, "localProxy": 0.0, "front": None, "arrived": None, "spreadingFactor": None}
    angle = _angle_between(site.center_local, direction_local)
    out = {"angleRad": angle, "localProxy": local_falloff(site, body_radius_m, angle)}
    front = front_angle_rad(site, body_radius_m, t_s)
    if front is None:
        out.update(state="static", front=None, arrived=None, spreadingFactor=None)
        return out
    arrived = angle <= front
    out.update(state="propagating" if front < math.pi else "completed", front=front, arrived=arrived,
               spreadingFactor=spreading_factor(site, body_radius_m, angle) if arrived else 0.0)
    return out


def merge_sites(sites: list[ImpactSite], new_id: str) -> list[ImpactSite]:
    """Bound a body's site list (plan 4.7): beyond MAX_SITES_PER_BODY the two lowest-energy sites are merged into one labelled aggregate
    ('cratered terrain'): the energy-weighted mean direction, summed energy, the later time, the larger footprint. Static, approximate."""
    out = list(sites)
    while len(out) > MAX_SITES_PER_BODY:
        out.sort(key=lambda s: (s.energy_j, s.time_s, s.site_id))
        a, b = out[0], out[1]
        wa, wb = max(a.energy_j, 1.0e-300), max(b.energy_j, 1.0e-300)
        v = [(wa * x + wb * y) for x, y in zip(a.center_local.as_tuple(), b.center_local.as_tuple())]
        n = math.sqrt(sum(c * c for c in v))
        centre = a.center_local if n < 1.0e-12 else Vec3(v[0] / n, v[1] / n, v[2] / n)
        merged = ImpactSite(
            site_id=new_id, body_id=a.body_id, event_id=max(a.event_id, b.event_id), time_s=max(a.time_s, b.time_s), center_local=centre,
            crater_radius_m=max(a.crater_radius_m, b.crater_radius_m), transient_depth_m=max(a.transient_depth_m, b.transient_depth_m),
            damage_profile=DamageProfile("power-law-falloff", max(a.damage_profile.inner_radius_m, b.damage_profile.inner_radius_m),
                                         DAMAGE_FALLOFF_EXPONENT),
            ejecta_cone=EjectaCone(centre, 90.0), energy_j=a.energy_j + b.energy_j,
            propagation=Propagation("geodesic-front-v1", None, None, False), fidelity=Fidelity.APPROXIMATION)
        out = out[2:] + [merged]
    return out
