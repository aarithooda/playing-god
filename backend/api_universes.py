"""Universe-scoped routes (plan section 12.2). Mutations name their universe in the path and the activation epoch in
the query; reads take no epoch and work on any universe."""
from fastapi import APIRouter, Depends, Query, Response

from backend.lab_models import (ActivationResult, CreateUniverseRequest, UniverseList, UniverseState,
                                UniverseStepResponse, UniverseSummary)
from backend.models import Body, BodyCreate, BodyUpdate, EventList, StepRequest
from backend.universes import Universe, UniverseRegistry, get_registry
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


@router.get("", response_model=UniverseList)
def list_universes(reg: UniverseRegistry = Depends(get_registry)) -> UniverseList:
    with reg._lock:  # one consistent view of the list, the active id and the epoch
        return UniverseList(universes=[summary(reg, u) for u in reg.list()], activeUniverseId=reg.active_id,
                            activationEpoch=reg.epoch)


@router.post("", response_model=UniverseSummary, status_code=201)
def create_universe(req: CreateUniverseRequest, reg: UniverseRegistry = Depends(get_registry)) -> UniverseSummary:
    if req.source.kind == "preset":
        raise CodedError(f"unknown preset: {req.source.presetId}", code="preset_not_found", status=404)
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
