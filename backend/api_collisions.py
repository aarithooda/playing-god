"""Read routes of the collision engine (plan 3.1). Stage 2: the material registry. Stage 6: the surface of a body (impact sites and the
reduced-order disturbance front). Later stages add collision records and dry-run replay here."""
import math

from fastapi import APIRouter, Depends, Query

from backend.impact import damage
from backend.impact.contracts import SCHEMA_VERSION
from backend.impact.materials import list_profiles
from backend.universes import UniverseRegistry, get_registry

router = APIRouter(prefix="/api/v1", tags=["collisions"])

SURFACE_LABEL = ("Reduced-order disturbance model (approximation): geometry of a front travelling over the surface at a profile's wave "
                 "speed. It is not a resolved shock and says nothing about absolute damage.")


@router.get("/materials")
def get_materials() -> dict:
    """The immutable registry of material profiles. Each number carries provenance; quantities without a defensible source are
    absent and named in `incomplete` (never guessed). `propagation` states, per profile, whether the surface disturbance front is
    supported (a wave speed with provenance) or static (no applicable sourced wave speed)."""
    profiles = list_profiles()
    support = {}
    for p in profiles:
        s = damage.propagation_support(p)
        support[p.id] = {"supported": s.supported, "waveSpeedMPerS": s.wave_speed_m_per_s, "reason": s.reason}
    return {"schemaVersion": SCHEMA_VERSION, "profiles": [p.to_dict() for p in profiles], "propagation": support}


@router.get("/universes/{universe_id}/bodies/{body_id}/surface")
def get_surface(universe_id: str, body_id: str, atTimeS: float | None = Query(default=None, allow_inf_nan=False),
                reg: UniverseRegistry = Depends(get_registry)) -> dict:
    """The impact sites of a body (body-local directions, stable under rotation) and, for sites whose profile has a sourced wave speed,
    the disturbance front at `atTimeS` (default: the committed simulation time). Static sites state that propagation is disabled."""
    radius, now, sites = reg.get(universe_id).engine.surface(body_id)
    t = now if atTimeS is None else atTimeS
    rows = []
    for site in sites:
        front = damage.front_angle_rad(site, radius, t)
        supported = site.propagation.wave_speed_m_per_s is not None
        rows.append({
            "site": site.to_dict(),
            "propagation": {
                "supported": supported,
                "state": "static" if not supported else ("not_yet" if t < site.time_s else ("completed" if front >= math.pi else "propagating")),
                "frontAngleRad": front,
                "antipodeArrivalTimeS": damage.arrival_time_s(site, radius, math.pi),
                "note": "propagation disabled: the profile has no sourced, applicable wave speed" if not supported
                else "approximation: geodesic front at the profile's wave speed",
            }})
    return {"schemaVersion": SCHEMA_VERSION, "universeId": universe_id, "bodyId": body_id, "bodyRadiusM": radius, "simulationTimeS": now,
            "evaluatedAtS": t, "label": SURFACE_LABEL, "sites": rows}
