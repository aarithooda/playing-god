"""Request models of the spaceflight API. Bounds are request limits (like backend/models.py), not physical claims."""
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.models import MAX_MASS_KG, MAX_POSITION_M, MAX_SPEED_M_PER_S, Position3, Velocity3

MAX_DELTA_V_M_PER_S = 1.0e6
MAX_THRUST_N = 1.0e12
MAX_ISP_S = 1.0e6
MAX_CRAFT_RADIUS_M = 1.0e5
MAX_TIME_S = 1.0e15


class OrbitSpec(BaseModel):
    """An orbit about `centralBodyId`. Exactly one of `periapsisAltitudeM` (above the body's surface) and `semiMajorAxisM`."""

    model_config = ConfigDict(extra="forbid")

    centralBodyId: str = Field(min_length=1, max_length=64)
    periapsisAltitudeM: Optional[float] = Field(default=None, ge=0, le=MAX_POSITION_M, allow_inf_nan=False)
    semiMajorAxisM: Optional[float] = Field(default=None, ge=-MAX_POSITION_M, le=MAX_POSITION_M, allow_inf_nan=False)
    eccentricity: float = Field(default=0.0, ge=0, le=100, allow_inf_nan=False)
    inclinationDeg: float = Field(default=0.0, ge=0, le=180, allow_inf_nan=False)
    raanDeg: float = Field(default=0.0, ge=-360, le=360, allow_inf_nan=False)
    argPeriapsisDeg: float = Field(default=0.0, ge=-360, le=360, allow_inf_nan=False)
    trueAnomalyDeg: float = Field(default=0.0, ge=-360, le=360, allow_inf_nan=False)
    # Put the orbit in the plane of this body's orbit about the central body (inclination and node are then taken from it).
    matchPlaneOfBodyId: Optional[str] = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def _one_size(self) -> "OrbitSpec":
        if (self.periapsisAltitudeM is None) == (self.semiMajorAxisM is None):
            raise ValueError("give exactly one of periapsisAltitudeM and semiMajorAxisM")
        return self


class StateSpec(BaseModel):
    """A state vector, absolute or relative to a body."""

    model_config = ConfigDict(extra="forbid")

    positionM: Position3
    velocityMPerS: Velocity3
    relativeToBodyId: Optional[str] = Field(default=None, min_length=1, max_length=64)


class SpacecraftCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    colorHex: str = Field(default="#8fd3ff", pattern=r"^#[0-9a-fA-F]{6}$")
    radiusM: float = Field(default=5.0, gt=0, le=MAX_CRAFT_RADIUS_M, allow_inf_nan=False)  # collision radius
    dryMassKg: float = Field(gt=0, le=MAX_MASS_KG, allow_inf_nan=False)
    propellantKg: float = Field(default=0.0, ge=0, le=MAX_MASS_KG, allow_inf_nan=False)
    thrustN: float = Field(default=0.0, ge=0, le=MAX_THRUST_N, allow_inf_nan=False)
    ispS: float = Field(default=0.0, ge=0, le=MAX_ISP_S, allow_inf_nan=False)
    orbit: Optional[OrbitSpec] = None
    state: Optional[StateSpec] = None

    @model_validator(mode="after")
    def _one_placement(self) -> "SpacecraftCreate":
        if (self.orbit is None) == (self.state is None):
            raise ValueError("give exactly one of orbit and state")
        return self


class OrbitPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    orbit: OrbitSpec
    massKg: float = Field(default=1000.0, gt=0, le=MAX_MASS_KG, allow_inf_nan=False)
    radiusM: float = Field(default=5.0, gt=0, le=MAX_CRAFT_RADIUS_M, allow_inf_nan=False)


class SpacecraftUpdate(BaseModel):
    """Any non-empty subset. Position, velocity, name and colour are edited like any body's (PATCH .../bodies/{id})."""

    model_config = ConfigDict(extra="forbid")

    dryMassKg: Optional[float] = Field(default=None, gt=0, le=MAX_MASS_KG, allow_inf_nan=False)
    propellantKg: Optional[float] = Field(default=None, ge=0, le=MAX_MASS_KG, allow_inf_nan=False)
    thrustN: Optional[float] = Field(default=None, ge=0, le=MAX_THRUST_N, allow_inf_nan=False)
    ispS: Optional[float] = Field(default=None, ge=0, le=MAX_ISP_S, allow_inf_nan=False)

    @model_validator(mode="after")
    def _non_empty(self) -> "SpacecraftUpdate":
        if not self.model_fields_set or any(getattr(self, f) is None for f in self.model_fields_set):
            raise ValueError("give at least one field; fields must not be null")
        return self


class ManeuverCreate(BaseModel):
    """A manoeuvre node. `at`: "epoch" (absolute `epochS`), "now" (+ `delayS`), or the next "periapsis" / "apoapsis" of the osculating
    orbit about the reference body (a two-body estimate of when that is). VNB components or an inertial vector, not both."""

    model_config = ConfigDict(extra="forbid")

    at: Literal["epoch", "now", "periapsis", "apoapsis"] = "epoch"
    epochS: Optional[float] = Field(default=None, ge=-MAX_TIME_S, le=MAX_TIME_S, allow_inf_nan=False)
    delayS: float = Field(default=0.0, ge=0, le=MAX_TIME_S, allow_inf_nan=False)
    mode: Literal["impulsive", "finite"] = "impulsive"
    frame: Literal["vnb", "inertial"] = "vnb"
    referenceBodyId: Optional[str] = Field(default=None, min_length=1, max_length=64)
    progradeMPerS: float = Field(default=0.0, ge=-MAX_DELTA_V_M_PER_S, le=MAX_DELTA_V_M_PER_S, allow_inf_nan=False)
    normalMPerS: float = Field(default=0.0, ge=-MAX_DELTA_V_M_PER_S, le=MAX_DELTA_V_M_PER_S, allow_inf_nan=False)
    radialMPerS: float = Field(default=0.0, ge=-MAX_DELTA_V_M_PER_S, le=MAX_DELTA_V_M_PER_S, allow_inf_nan=False)
    deltaVMPerS: Optional[Velocity3] = None
    centered: bool = True
    label: str = Field(default="", max_length=64)

    @model_validator(mode="after")
    def _consistent(self) -> "ManeuverCreate":
        if (self.at == "epoch") != (self.epochS is not None):
            raise ValueError('epochS is required with at = "epoch" and not allowed otherwise')
        vnb = (self.progradeMPerS, self.normalMPerS, self.radialMPerS) != (0.0, 0.0, 0.0)
        if self.frame == "inertial":
            if self.deltaVMPerS is None or vnb:
                raise ValueError("an inertial manoeuvre needs deltaVMPerS and no VNB components")
        elif self.deltaVMPerS is not None:
            raise ValueError("deltaVMPerS is only for frame = inertial")
        return self

    def components(self) -> tuple:
        if self.frame == "inertial":
            return (self.deltaVMPerS.x, self.deltaVMPerS.y, self.deltaVMPerS.z)
        return (self.progradeMPerS, self.normalMPerS, self.radialMPerS)


class MissionObjective(BaseModel):
    """What the mission must achieve at the destination, judged on the ACTUAL simulated state.
    orbit: a bound orbit whose periapsis and apoapsis altitudes are within `toleranceM` of the targets (apoapsis = periapsis when
    `apoapsisAltitudeM` is omitted: a circular orbit), kept for one full revolution. flyby: a closest approach within `toleranceM`
    of `periapsisAltitudeM`."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["orbit", "flyby"] = "orbit"
    periapsisAltitudeM: float = Field(gt=0, le=MAX_POSITION_M, allow_inf_nan=False)
    apoapsisAltitudeM: Optional[float] = Field(default=None, gt=0, le=MAX_POSITION_M, allow_inf_nan=False)
    direction: Literal["prograde", "retrograde"] = "prograde"
    toleranceM: float = Field(default=50_000.0, gt=0, le=MAX_POSITION_M, allow_inf_nan=False)

    @model_validator(mode="after")
    def _apsides(self) -> "MissionObjective":
        if self.apoapsisAltitudeM is not None and self.apoapsisAltitudeM < self.periapsisAltitudeM:
            raise ValueError("apoapsisAltitudeM must not be below periapsisAltitudeM")
        if self.type == "flyby" and self.apoapsisAltitudeM is not None:
            raise ValueError("a flyby has no apoapsis altitude")
        return self


class MissionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    spacecraftId: str = Field(min_length=1, max_length=64)
    destinationBodyId: str = Field(min_length=1, max_length=64)
    objective: MissionObjective


class MissionPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transferTimeS: Optional[float] = Field(default=None, gt=0, le=MAX_TIME_S, allow_inf_nan=False)
    burnMode: Literal["impulsive", "finite"] = "impulsive"
    earliestDepartureS: Optional[float] = Field(default=None, ge=-MAX_TIME_S, le=MAX_TIME_S, allow_inf_nan=False)


__all__ = ["OrbitSpec", "StateSpec", "SpacecraftCreate", "SpacecraftUpdate", "OrbitPreviewRequest", "ManeuverCreate", "MissionObjective",
           "MissionCreate", "MissionPlanRequest", "MAX_SPEED_M_PER_S"]
