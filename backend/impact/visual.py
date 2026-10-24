"""The `VisualEventDescription` of a recorded collision (plan 3.12, 4.10; decision D-055). Pure.

Built ONLY from a validated, committed result (a record with a `result`): a legacy merge has none, so it has no description. The renderer
reads this description and body states; it derives no outcome.

What is physical and what is not:
- the impact site, the fragment and parcel ids, the ejecta mass and speed range, and the cloud's radius and speed are taken from the
  result (computed quantities); the cloud is a visual of the parcels' statistical mass (radius = the largest parcel radius, speed = the
  mean parcel speed relative to the pair's centre of mass), labelled so in `fidelity_notes`;
- phases of material (contact, ejecta, separation, cloud-expansion, aftermath) are `simulation-time`: they start at a recorded time and end
  at null, because they follow body states; their DURATIONS ARE NOT MODELLED and none is invented;
- the flash is the only visual-only effect (`visual-wall-clock`): its lifetime (`FLASH_LIFETIME_WALL_S`) and its intensity (the dissipated
  fraction of the pair's centre-of-mass kinetic energy, clamped) have NO physical meaning (DQ-12). `VisualOnlyEffect` has no mass field.
Cratering never gets separation or cloud phases and a disruption never gets a cratering phase (V-EVT: the sequence follows the outcome).
"""
import math
from typing import Optional

from backend.impact.contracts import (CollisionRecord, DebrisCloud, EjectaSource, Fidelity, VisualEventDescription, VisualImpactSite, VisualOnlyEffect,
                                      VisualPhase, Vec3)

FLASH_LIFETIME_WALL_S = 0.8  # visual constant, no physical meaning
MIN_FLASH_INTENSITY = 0.05

MERGE_LIKE = frozenset({"perfect_merge", "graze_and_merge", "envelope_deposition", "envelope_merge_approximation"})
DISRUPTION = frozenset({"catastrophic_disruption", "super_catastrophic_disruption"})


def phase_names(outcome: str, has_debris: bool, has_parcels: bool, two_remnants: bool) -> list[str]:
    """The phases an outcome can show, in order. Cratering has a crater and ejecta but never separation or a cloud."""
    names = ["contact", "flash"]
    if outcome == "cratering":
        names += ["cratering", "ejecta"]
    else:
        if has_debris:
            names.append("ejecta")
        if outcome in DISRUPTION or two_remnants:
            names.append("separation")
        if has_parcels and (outcome in DISRUPTION):
            names.append("cloud-expansion")
    names.append("aftermath")
    return names


def _speed(v, v_ref) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(v, v_ref)))


def describe_visual(record: CollisionRecord) -> Optional[VisualEventDescription]:
    result, spec = record.result, record.outcome_spec
    if result is None or spec is None:
        return None
    imp = record.input.impact
    outcome = result.outcome
    fragments = [p for p in result.created if p.representation == "fragment"]
    parcels = list(result.debris_parcels)
    debris_posts = [*fragments, *parcels]
    two_remnants = len(result.transformed) + len([p for p in result.created if p.representation == "body"]) >= 2
    names = phase_names(outcome, bool(debris_posts), bool(parcels), two_remnants)
    t_c, t_d = imp.contact_time_s, imp.detection_time_s
    phases = []
    for name in names:
        if name == "contact":
            phases.append(VisualPhase("contact", t_c, t_d, "simulation-time"))
        elif name == "flash":
            phases.append(VisualPhase("flash", t_c, None, "visual-wall-clock", FLASH_LIFETIME_WALL_S))
        elif name == "aftermath":
            phases.append(VisualPhase("aftermath", t_d, None, "simulation-time"))
        else:
            phases.append(VisualPhase(name, t_c, None, "simulation-time"))  # follows body states; no duration is modelled
    target_id = imp.target.id
    local = imp.contact_point_local.target
    site = VisualImpactSite(target_id, local, imp.contact_point_m, imp.contact_normal)
    m_total = imp.total_mass_kg
    v_com = tuple(c / m_total for c in imp.pair_momentum_kg_m_per_s.as_tuple())
    speeds = [_speed(p.velocity_m_per_s.as_tuple(), v_com) for p in debris_posts]
    debris_mass = math.fsum(p.mass_kg for p in debris_posts)
    ejecta: list[EjectaSource] = []
    if debris_posts:
        for s in result.impact_sites:
            ejecta.append(EjectaSource(s.body_id, s.ejecta_cone.axis_local, s.ejecta_cone.half_angle_deg, debris_mass, (min(speeds), max(speeds))))
    cloud = None
    if parcels and "cloud-expansion" in names:
        appearance = imp.target.material_profile.appearance if imp.target.material_profile is not None else "dust"
        cloud = DebrisCloud(max(p.radius_m for p in parcels), math.fsum(_speed(p.velocity_m_per_s.as_tuple(), v_com) for p in parcels) / len(parcels), appearance)
    energy = result.conservation.energy
    reference = max(imp.pair_kinetic_energy_com_j, 1.0e-300)
    intensity = min(1.0, max(MIN_FLASH_INTENSITY, energy.dissipated_j / reference))
    visual_only = (VisualOnlyEffect("flash", intensity, FLASH_LIFETIME_WALL_S),)
    appearance_of: dict[str, str] = {}
    for body, profile in ((imp.target, imp.target.material_profile), (imp.projectile, imp.projectile.material_profile)):
        if profile is not None:
            appearance_of[body.id] = profile.appearance
    base = appearance_of.get(target_id)
    for p in (*result.created, *parcels):
        if base is not None:
            appearance_of[p.id] = base
    notes = [
        "The flash is a visual-only effect with no physical meaning: its duration and intensity are display constants.",
        "The durations of the material phases are not modelled: they follow the simulated body states.",
        "The impact site marks where the bodies touched; crater size and ejecta directions are not modelled (cratering is unsupported).",
    ]
    if parcels:
        notes.append("Debris parcels are statistical aggregates; any particle drawn for them is a visual sample that carries no mass.")
    if cloud is not None:
        notes.append("The cloud is a visual of the parcels' mass: radius = the largest parcel radius, speed = the mean parcel speed relative to the centre of mass.")
    notes += [f"{k}: {v.value}" for k, v in sorted(record.fidelity.items()) if v in (Fidelity.APPROXIMATION, Fidelity.STATISTICAL, Fidelity.UNSUPPORTED)]
    notes.append("The science is provisional (CP-SCI-1 is not signed off).")
    return VisualEventDescription(
        event_id=record.event_id, outcome=outcome, time_s=t_c, impact_site=site, phases=tuple(phases), ejecta_sources=tuple(ejecta),
        fragment_body_ids=tuple(p.id for p in fragments), debris_parcel_ids=tuple(p.id for p in parcels), cloud=cloud, visual_only=visual_only,
        material_appearance=appearance_of, fidelity_notes=tuple(notes))
