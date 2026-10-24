"""Pydantic models of the universe / lab API (plan section 12). SI units throughout."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.models import SimulationState, StepResponse

UniverseRole = Literal["sandbox", "preset", "baseline", "modified"]


class LastFailure(BaseModel):
    kind: Literal["step_failed", "step_timeout", "deactivated_during_step", "busy", "restore_failed"]
    message: str
    atSimulationTimeS: float
    atIso: str


class UniverseSummary(BaseModel):
    id: str
    name: str
    role: UniverseRole
    presetId: str | None
    experimentId: str | None
    active: bool
    simulationTimeS: float
    bodyCount: int
    revision: int
    status: Literal["idle", "mutating"]
    lastFailure: LastFailure | None
    createdAtIso: str
    epochLabel: str | None
    historyMode: Literal["grid", "step"]


class UniverseList(BaseModel):
    universes: list[UniverseSummary]
    activeUniverseId: str
    activationEpoch: int


class EmptySource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["empty"]


class PresetSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["preset"]
    presetId: str = Field(min_length=1, max_length=64)


class CreateUniverseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=64)
    source: Annotated[EmptySource | PresetSource, Field(discriminator="kind")]
    activate: bool = False


class PreviousUniverse(BaseModel):
    universeId: str
    simulationTimeS: float
    revision: int


class ActivationResult(BaseModel):
    activeUniverseId: str
    activationEpoch: int
    previous: PreviousUniverse | None


class UniverseState(SimulationState):
    universeId: str
    revision: int


class UniverseStepResponse(StepResponse):
    universeId: str
    revision: int
