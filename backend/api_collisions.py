"""Read routes of the collision engine (plan 3.1). Stage 2: the material registry. Stage 6: the surface of a body (impact sites and the
reduced-order disturbance front). Later stages add collision records and dry-run replay here."""
import math

from fastapi import APIRouter, Depends, Query

from backend.errors import CodedError
from backend.impact import damage
from backend.impact.contracts import SCHEMA_VERSION
from backend.impact.materials import list_profiles
from backend.impact.records import MAX_COLLISION_RECORDS, find_record, summarise
from backend.impact.replay import replay
from backend.impact.visual import describe_visual
from backend.simulation import G_SI
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


# ------------------------------------------------------------------------------------------------ records (Stage 8)
def _record_or_404(engine, event_id: str):
    record = find_record(engine.collision_records(), event_id)
    if record is None:
        raise CodedError(f"no collision record for {event_id}: it never existed in this universe, or it was dropped (at most "
                         f"{MAX_COLLISION_RECORDS} records are kept)", code="collision_record_not_found", status=404)
    return record


@router.get("/universes/{universe_id}/collisions")
def list_collisions(universe_id: str, limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0),
                    rootEventId: str | None = Query(default=None, min_length=1, max_length=64),
                    parentEventId: str | None = Query(default=None, min_length=1, max_length=64),
                    reg: UniverseRegistry = Depends(get_registry)) -> dict:
    """Summaries of the collision records of a universe, oldest first (bounded; read-only). Legacy-merge universes have none."""
    records = reg.get(universe_id).engine.collision_records()
    if rootEventId is not None:
        records = [r for r in records if r.root_event_id == rootEventId]
    if parentEventId is not None:
        records = [r for r in records if r.parent_event_id == parentEventId]
    page = records[offset:offset + limit]
    return {"schemaVersion": SCHEMA_VERSION, "universeId": universe_id, "total": len(records), "offset": offset, "limit": limit,
            "maxRecords": MAX_COLLISION_RECORDS, "records": [summarise(r) for r in page]}


@router.get("/universes/{universe_id}/collisions/{event_id}")
def get_collision(universe_id: str, event_id: str, reg: UniverseRegistry = Depends(get_registry)) -> dict:
    """The full record of one event (spec 10.2: input state, geometry, materials, model and version, result, residuals, energy,
    warnings and fidelity), its lineage, and what became of its products now (a classification of the present state)."""
    engine = reg.get(universe_id).engine
    record = _record_or_404(engine, event_id)
    state, _ = engine.published()
    live = {b.id: b for b in state.bodies}
    products = []
    if record.result is not None:
        posts = [*record.result.transformed, *record.result.created, *record.result.debris_parcels]
        for post in posts:
            body = live.get(post.id)
            products.append({"bodyId": post.id, "representation": getattr(post, "representation", "debris-parcel"),
                             "massKgAtEvent": post.mass_kg, "exists": body is not None,
                             "fragmentClass": None if body is None else body.fragmentClass,
                             "massKgNow": None if body is None else body.massKg})
        products.sort(key=lambda p: p["bodyId"])
    records = engine.collision_records()
    children = [r.event_id for r in records if r.parent_event_id == record.event_id]
    escaped = state.diagnostics.escaped
    return {"schemaVersion": SCHEMA_VERSION, "universeId": universe_id, "record": record.to_dict(),
            "childEventIds": children, "products": products,
            "escapedLedger": None if escaped is None else escaped.model_dump(),
            "note": "Fidelity labels state how each quantity was obtained; 'approximation', 'statistical' and 'unsupported' are not computed results. "
                    "The science is provisional (CP-SCI-1 is not signed off)."}


@router.post("/universes/{universe_id}/collisions/{event_id}/replay")
def replay_collision(universe_id: str, event_id: str, reg: UniverseRegistry = Depends(get_registry)) -> dict:
    """Dry-run replay: recompute the event from its recorded input and compare digests. Never changes the universe (no revision bump)."""
    record = _record_or_404(reg.get(universe_id).engine, event_id)
    return {"schemaVersion": SCHEMA_VERSION, "universeId": universe_id, **replay(record, G_SI)}


@router.get("/universes/{universe_id}/collisions/{event_id}/visual")
def get_collision_visual(universe_id: str, event_id: str, reg: UniverseRegistry = Depends(get_registry)) -> dict:
    """The `VisualEventDescription` of an event, built only from its recorded, validated result (the renderer reads this and body states).
    A legacy merge has no result and so no description (404 `collision_visual_unavailable`)."""
    description = describe_visual(_record_or_404(reg.get(universe_id).engine, event_id))
    if description is None:
        raise CodedError(f"{event_id} has no recorded result (a legacy merge): there is no visual description", code="collision_visual_unavailable", status=404)
    return {"universeId": universe_id, **description.to_dict()}
