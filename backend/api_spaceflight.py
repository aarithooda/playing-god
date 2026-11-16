"""Space Mission Design routes (universe-scoped; mutations carry the activation epoch like the body routes).

Spacecraft are bodies of the universe: they appear in `/state` and `/step` (kind "spacecraft", with a `spacecraft` block), and are
moved, renamed and deleted through the ordinary body routes. These routes add what is specific to them: placing one into an orbit,
its propulsion, manoeuvre nodes, and missions. Reads take no epoch.
"""
from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel

from backend.models import Body
from backend.spaceflight.requests import (ManeuverCreate, MissionCreate, MissionPlanRequest, OrbitPreviewRequest, SpacecraftCreate,
                                          SpacecraftUpdate)
from backend.spaceflight.schemas import ManeuverOut, ManeuverPreviewOut, MissionOut, OrbitPreviewOut, TrajectoryOut
from backend.universes import UniverseRegistry, get_registry

router = APIRouter(prefix="/api/v1/universes", tags=["spaceflight"])

Epoch = Query(..., alias="activationEpoch", ge=0)


class SpacecraftCreatedOut(BaseModel):
    body: Body
    warnings: list[str]


@router.post("/{universe_id}/spacecraft", response_model=SpacecraftCreatedOut, status_code=201)
def create_spacecraft(universe_id: str, data: SpacecraftCreate, epoch: int = Epoch,
                      reg: UniverseRegistry = Depends(get_registry)) -> SpacecraftCreatedOut:
    u, guard = reg.prepare(universe_id, epoch, "body")
    body, warnings = u.engine.add_spacecraft(data, guard=guard)
    return SpacecraftCreatedOut(body=body, warnings=warnings)


@router.post("/{universe_id}/spacecraft/orbit-preview", response_model=OrbitPreviewOut)
def preview_orbit(universe_id: str, req: OrbitPreviewRequest, reg: UniverseRegistry = Depends(get_registry)) -> OrbitPreviewOut:
    """What an orbit request would give (state vector, period, speeds), without creating anything."""
    return reg.get(universe_id).engine.preview_orbit(req.orbit, req.massKg, req.radiusM)


@router.patch("/{universe_id}/spacecraft/{craft_id}", response_model=Body)
def update_spacecraft(universe_id: str, craft_id: str, patch: SpacecraftUpdate, epoch: int = Epoch,
                      reg: UniverseRegistry = Depends(get_registry)) -> Body:
    u, guard = reg.prepare(universe_id, epoch, "body")
    return u.engine.update_spacecraft(craft_id, patch, guard=guard)


@router.post("/{universe_id}/spacecraft/{craft_id}/maneuvers", response_model=ManeuverOut, status_code=201)
def create_maneuver(universe_id: str, craft_id: str, data: ManeuverCreate, epoch: int = Epoch,
                    reg: UniverseRegistry = Depends(get_registry)) -> ManeuverOut:
    """Schedule a manoeuvre node. An impulsive node at the present time executes in this request."""
    u, guard = reg.prepare(universe_id, epoch, "body")
    return u.engine.add_maneuver(craft_id, data, guard=guard)


@router.post("/{universe_id}/spacecraft/{craft_id}/maneuvers/preview", response_model=ManeuverPreviewOut)
def preview_maneuver(universe_id: str, craft_id: str, data: ManeuverCreate,
                     reg: UniverseRegistry = Depends(get_registry)) -> ManeuverPreviewOut:
    return reg.get(universe_id).engine.preview_maneuver(craft_id, data)


@router.delete("/{universe_id}/maneuvers/{maneuver_id}", status_code=204)
def delete_maneuver(universe_id: str, maneuver_id: str, epoch: int = Epoch, reg: UniverseRegistry = Depends(get_registry)) -> Response:
    u, guard = reg.prepare(universe_id, epoch, "body")
    u.engine.delete_maneuver(maneuver_id, guard=guard)
    return Response(status_code=204)


@router.post("/{universe_id}/missions", response_model=MissionOut, status_code=201)
def create_mission(universe_id: str, data: MissionCreate, epoch: int = Epoch, reg: UniverseRegistry = Depends(get_registry)) -> MissionOut:
    u, guard = reg.prepare(universe_id, epoch, "body")
    return u.engine.create_mission(data, guard=guard)


@router.post("/{universe_id}/missions/{mission_id}/plan", response_model=MissionOut)
def plan_mission(universe_id: str, mission_id: str, req: MissionPlanRequest = MissionPlanRequest(), epoch: int = Epoch,
                 reg: UniverseRegistry = Depends(get_registry)) -> MissionOut:
    """Design the transfer (a prediction; nothing is scheduled). The answer's `status` says planned, unsupported, or draft (no
    transfer found), with reasons."""
    u, guard = reg.prepare(universe_id, epoch, "body")
    return u.engine.plan_mission(mission_id, req, guard=guard)


@router.post("/{universe_id}/missions/{mission_id}/commit", response_model=MissionOut)
def commit_mission(universe_id: str, mission_id: str, epoch: int = Epoch, reg: UniverseRegistry = Depends(get_registry)) -> MissionOut:
    """Schedule the designed manoeuvre nodes: the mission is then flown by the simulation as it advances."""
    u, guard = reg.prepare(universe_id, epoch, "body")
    return u.engine.commit_mission(mission_id, guard=guard)


@router.post("/{universe_id}/missions/{mission_id}/abort", response_model=MissionOut)
def abort_mission(universe_id: str, mission_id: str, epoch: int = Epoch, reg: UniverseRegistry = Depends(get_registry)) -> MissionOut:
    u, guard = reg.prepare(universe_id, epoch, "body")
    return u.engine.abort_mission(mission_id, guard=guard)


@router.delete("/{universe_id}/missions/{mission_id}", status_code=204)
def delete_mission(universe_id: str, mission_id: str, epoch: int = Epoch, reg: UniverseRegistry = Depends(get_registry)) -> Response:
    u, guard = reg.prepare(universe_id, epoch, "body")
    u.engine.delete_mission(mission_id, guard=guard)
    return Response(status_code=204)


@router.get("/{universe_id}/missions/{mission_id}/trajectory", response_model=TrajectoryOut)
def mission_trajectory(universe_id: str, mission_id: str, reg: UniverseRegistry = Depends(get_registry)) -> TrajectoryOut:
    """The PLANNED trajectory (a prediction). The actual one is the recorded history of the universe."""
    return reg.get(universe_id).engine.mission_trajectory(mission_id)
