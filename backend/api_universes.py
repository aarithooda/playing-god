"""Universe-scoped routes (plan section 12.2). Mutations name their universe in the path and the activation epoch in
the query; reads take no epoch and work on any universe."""
from fastapi import APIRouter, Depends, Query, Response

from backend.history import MAX_PAGE_SAMPLES
from backend.lab_models import (ActivationResult, CreateUniverseRequest, HistoryPage, SnapshotCreate, SnapshotList,
                                SnapshotSummary, UniverseList, UniverseProvenance, UniverseState, UniverseStepResponse, UniverseSummary)
from backend.models import Body, BodyCreate, BodyUpdate, EventList, StepRequest
from backend.presets.loader import PresetDataError, UnknownPresetError, load_preset
from backend.simulation import SimulationService
from backend.universes import StoredSnapshot, Universe, UniverseRegistry, get_registry
from backend.errors import CodedError

router = APIRouter(prefix="/api/v1/universes")

Epoch = Query(..., alias="activationEpoch", ge=0)
ExpectedRevision = Query(None, alias="expectedRevision", ge=0)


def summary(reg: UniverseRegistry, u: Universe) -> UniverseSummary:
    state, revision = u.engine.published()
    return UniverseSummary(
        id=u.id, name=u.name, role=u.role, presetId=u.preset_id, experimentId=u.experiment_id,
        active=u.id == reg.active_id, simulationTimeS=state.simulationTimeS, bodyCount=len(state.bodies),
        revision=revision, status="mutating" if u.engine.is_busy() else "idle", lastFailure=u.engine.last_failure,
        createdAtIso=u.created_at, epochLabel=(u.provenance or {}).get("epoch"), historyMode=u.engine.history_mode)


def create_preset_universe(reg: UniverseRegistry, preset_id: str, name: str | None, activate: bool) -> Universe:
    """A preset always becomes a new universe (nothing existing is replaced). Any data problem aborts before the
    universe exists, so a failed load creates nothing."""
    try:
        preset = load_preset(preset_id)
    except UnknownPresetError:
        raise CodedError(f"unknown preset: {preset_id}", code="preset_not_found", status=404) from None
    except PresetDataError as exc:
        raise CodedError(f"preset {preset_id} cannot be loaded: {exc}", code="preset_invalid", status=500) from exc
    engine = SimulationService()
    try:
        engine.load_bodies(preset.bodies, history_mode=preset.history_mode, sample_interval_s=preset.sample_interval_s)
    except Exception as exc:  # noqa: BLE001
        raise CodedError(f"preset {preset_id} cannot be initialised: {exc}", code="preset_invalid", status=500) from exc
    data = preset.provenance
    provenance = {"sourceKind": "preset", "presetId": preset_id, "presetDataVersion": data["dataVersion"],
                  "epoch": data["epoch"]["label"], "epochDetail": data["epoch"], "frame": data["frame"],
                  "origin": data["origin"], "units": data["units"], "initialStateDigest": engine.initial_state_digest,
                  "derivedFrom": None, "modification": None}
    return reg.create(name or preset.summary["name"][:64], role="preset", engine=engine, provenance=provenance,
                      preset_id=preset_id, activate=activate)


@router.get("", response_model=UniverseList)
def list_universes(reg: UniverseRegistry = Depends(get_registry)) -> UniverseList:
    with reg._lock:  # one consistent view of the list, the active id and the epoch
        return UniverseList(universes=[summary(reg, u) for u in reg.list()], activeUniverseId=reg.active_id,
                            activationEpoch=reg.epoch)


@router.post("", response_model=UniverseSummary, status_code=201)
def create_universe(req: CreateUniverseRequest, reg: UniverseRegistry = Depends(get_registry)) -> UniverseSummary:
    if req.source.kind == "preset":
        return summary(reg, create_preset_universe(reg, req.source.presetId, req.name, req.activate))
    u = reg.create(req.name, role="sandbox", activate=req.activate)
    return summary(reg, u)


@router.get("/{universe_id}", response_model=UniverseSummary)
def get_universe(universe_id: str, reg: UniverseRegistry = Depends(get_registry)) -> UniverseSummary:
    return summary(reg, reg.get(universe_id))


@router.delete("/{universe_id}", status_code=204)
def delete_universe(universe_id: str, reg: UniverseRegistry = Depends(get_registry)) -> Response:
    u = reg.get(universe_id)
    if u.role in ("baseline", "modified"):
        raise CodedError(f"universe {universe_id} belongs to an Orbit Lab experiment; delete the experiment instead",
                         code="baseline_protected")
    reg.delete(universe_id)
    return Response(status_code=204)


@router.post("/{universe_id}/activate", response_model=ActivationResult)
def activate_universe(universe_id: str, reg: UniverseRegistry = Depends(get_registry)) -> ActivationResult:
    return ActivationResult(**reg.activate(universe_id))


@router.get("/{universe_id}/state", response_model=UniverseState)
def get_state(universe_id: str, reg: UniverseRegistry = Depends(get_registry)) -> UniverseState:
    state, revision = reg.get(universe_id).engine.published()
    return UniverseState(**state.model_dump(), universeId=universe_id, revision=revision)


@router.get("/{universe_id}/events", response_model=EventList)
def get_events(universe_id: str, reg: UniverseRegistry = Depends(get_registry)) -> EventList:
    return EventList(events=reg.get(universe_id).engine.events())


@router.post("/{universe_id}/bodies", response_model=Body, status_code=201)
def create_body(universe_id: str, data: BodyCreate, epoch: int = Epoch, expected: int | None = ExpectedRevision,
                reg: UniverseRegistry = Depends(get_registry)) -> Body:
    u, guard = reg.prepare(universe_id, epoch, "body", expected)
    return u.engine.add_body(data, guard=guard)


@router.patch("/{universe_id}/bodies/{body_id}", response_model=Body)
def update_body(universe_id: str, body_id: str, patch: BodyUpdate, epoch: int = Epoch,
                expected: int | None = ExpectedRevision, reg: UniverseRegistry = Depends(get_registry)) -> Body:
    u, guard = reg.prepare(universe_id, epoch, "body", expected)
    return u.engine.update_body(body_id, patch, guard=guard)


@router.delete("/{universe_id}/bodies/{body_id}", status_code=204)
def delete_body(universe_id: str, body_id: str, epoch: int = Epoch, expected: int | None = ExpectedRevision,
                reg: UniverseRegistry = Depends(get_registry)) -> Response:
    u, guard = reg.prepare(universe_id, epoch, "body", expected)
    u.engine.delete_body(body_id, guard=guard)
    return Response(status_code=204)


@router.post("/{universe_id}/step", response_model=UniverseStepResponse)
def step(universe_id: str, req: StepRequest, epoch: int = Epoch, expected: int | None = ExpectedRevision,
         reg: UniverseRegistry = Depends(get_registry)) -> UniverseStepResponse:
    u, guard = reg.prepare(universe_id, epoch, "step", expected)
    with u.engine.locked():  # the revision read below belongs to exactly this step
        result = u.engine.step(req.dtS, guard=guard)
        revision = u.engine.revision
    return UniverseStepResponse(**result.model_dump(), universeId=universe_id, revision=revision)


@router.post("/{universe_id}/reset", response_model=UniverseState)
def reset(universe_id: str, epoch: int = Epoch, expected: int | None = ExpectedRevision,
          reg: UniverseRegistry = Depends(get_registry)) -> UniverseState:
    u, guard = reg.prepare(universe_id, epoch, "reset", expected)
    with u.engine.locked():
        state = u.engine.reset(guard=guard)
        revision = u.engine.revision
    return UniverseState(**state.model_dump(), universeId=universe_id, revision=revision)


# ---------- history (recorded by the engine, read without its lock) ----------
@router.get("/{universe_id}/history", response_model=HistoryPage)
def get_history(universe_id: str, generation: int | None = Query(None, ge=0), from_index: int = Query(0, alias="fromIndex", ge=0),
                body_ids: str | None = Query(None, alias="bodyIds"),
                limit: int = Query(1000, ge=1, le=MAX_PAGE_SAMPLES),
                reg: UniverseRegistry = Depends(get_registry)) -> HistoryPage:
    ids = {b for b in body_ids.split(",") if b} if body_ids else None
    page = reg.get(universe_id).engine.history.page(generation, from_index, ids, limit)
    return HistoryPage(universeId=universe_id, **page)


# ---------- snapshots ----------
def snapshot_summary(s: StoredSnapshot) -> SnapshotSummary:
    return SnapshotSummary(id=s.id, name=s.name, createdAtIso=s.created_at, simulationTimeS=s.snap.simulation_time_s,
                           bodyCount=s.snap.body_count, revision=s.snap.revision, controlled=s.snap.controlled)


@router.get("/{universe_id}/snapshots", response_model=SnapshotList)
def list_snapshots(universe_id: str, reg: UniverseRegistry = Depends(get_registry)) -> SnapshotList:
    u = reg.get(universe_id)
    with reg._lock:
        return SnapshotList(snapshots=[snapshot_summary(s) for s in u.snapshots.values()])


@router.post("/{universe_id}/snapshots", response_model=SnapshotSummary, status_code=201)
def create_snapshot(universe_id: str, req: SnapshotCreate = SnapshotCreate(), epoch: int = Epoch,
                    reg: UniverseRegistry = Depends(get_registry)) -> SnapshotSummary:
    u, guard = reg.prepare(universe_id, epoch, "snapshot")
    reg.check_snapshot_room(u)
    snap = u.engine.capture_snapshot()
    guard()  # the universe may have been deactivated while the copy was made
    return snapshot_summary(reg.add_snapshot(u, req.name, snap))


@router.post("/{universe_id}/snapshots/{snapshot_id}/restore", response_model=UniverseState)
def restore_snapshot(universe_id: str, snapshot_id: str, epoch: int = Epoch, expected: int | None = ExpectedRevision,
                     reg: UniverseRegistry = Depends(get_registry)) -> UniverseState:
    u, guard = reg.prepare(universe_id, epoch, "snapshot", expected)
    stored = reg.get_snapshot(u, snapshot_id)
    with u.engine.locked():
        state = u.engine.restore_snapshot(stored.snap, guard=guard)
        revision = u.engine.revision
    return UniverseState(**state.model_dump(), universeId=universe_id, revision=revision)


@router.delete("/{universe_id}/snapshots/{snapshot_id}", status_code=204)
def delete_snapshot(universe_id: str, snapshot_id: str, epoch: int = Epoch,
                    reg: UniverseRegistry = Depends(get_registry)) -> Response:
    u, _ = reg.prepare(universe_id, epoch, "snapshot")
    reg.delete_snapshot(u, snapshot_id)
    return Response(status_code=204)


@router.get("/{universe_id}/provenance", response_model=UniverseProvenance)
def get_provenance(universe_id: str, reg: UniverseRegistry = Depends(get_registry)) -> UniverseProvenance:
    u = reg.get(universe_id)
    base = {"sourceKind": "sandbox", "presetId": None, "presetDataVersion": None, "epoch": None, "frame": None,
            "origin": None, "units": "SI: m, kg, s, m/s", "initialStateDigest": u.engine.initial_state_digest,
            "derivedFrom": None, "modification": None}
    base.update({k: v for k, v in (u.provenance or {}).items() if k != "epochDetail"})
    with u.engine.locked():
        live = {"controlled": u.engine.controlled, "firstUncontrolledAtS": u.engine.first_uncontrolled_at_s,
                "audit": list(u.engine.audit)}
    return UniverseProvenance(**base, **live)
