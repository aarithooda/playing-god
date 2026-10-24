"""Orbit Lab routes (plan section 12.2). Creating a run does not activate it; switching uses the universes API."""
from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, Field

from backend.orbit_lab import OrbitLab, get_orbit_lab

router = APIRouter(prefix="/api/v1/orbit-lab")


class CreateExperimentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    systemId: str = Field(min_length=1, max_length=64)


class ModifiedRunRequest(BaseModel):
    """Exactly one modification kind: scale one body's speed by an allowed factor. Anything else is refused."""

    model_config = ConfigDict(extra="forbid")
    bodyId: str = Field(max_length=64)
    speedFactor: float = Field(allow_inf_nan=False)
    replaceExisting: bool = False


@router.get("/systems")
def systems(lab: OrbitLab = Depends(get_orbit_lab)) -> dict:
    return {"systems": lab.list_systems()}


@router.post("/experiments", status_code=201)
def create_experiment(req: CreateExperimentRequest, lab: OrbitLab = Depends(get_orbit_lab)) -> dict:
    return lab.create_experiment(req.systemId)


@router.get("/experiments")
def list_experiments(lab: OrbitLab = Depends(get_orbit_lab)) -> dict:
    return {"experiments": lab.list_experiments()}


@router.get("/experiments/{experiment_id}")
def get_experiment(experiment_id: str, lab: OrbitLab = Depends(get_orbit_lab)) -> dict:
    return lab.get(experiment_id)


@router.delete("/experiments/{experiment_id}", status_code=204)
def delete_experiment(experiment_id: str, lab: OrbitLab = Depends(get_orbit_lab)) -> Response:
    lab.delete(experiment_id)
    return Response(status_code=204)


@router.post("/experiments/{experiment_id}/modified-run", status_code=201)
def create_modified_run(experiment_id: str, req: ModifiedRunRequest, lab: OrbitLab = Depends(get_orbit_lab)) -> dict:
    return lab.create_modified_run(experiment_id, req.bodyId, req.speedFactor, req.replaceExisting)


@router.get("/experiments/{experiment_id}/initial-differences")
def initial_differences(experiment_id: str, lab: OrbitLab = Depends(get_orbit_lab)) -> dict:
    return lab.initial_differences(experiment_id)


@router.get("/experiments/{experiment_id}/comparison")
def comparison(experiment_id: str, body_id: str = Query(..., alias="bodyId"), lab: OrbitLab = Depends(get_orbit_lab)) -> dict:
    return lab.comparison(experiment_id, body_id)
