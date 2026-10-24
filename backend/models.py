"""Pydantic models for the API contract (see context/API_CONTRACT.md). SI units throughout."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.catalogue import catalogue_ids

# Request bounds (documented in the contract). Finite floats only: NaN and +/-Infinity are rejected.
MAX_MASS_KG = 1.0e45  # ~5e14 solar masses
MAX_RADIUS_M = 1.0e15  # ~100 light-years
MAX_POSITION_M = 1.0e18  # ~100 light-years
MAX_SPEED_M_PER_S = 2.99792458e8  # speed of light: this is a Newtonian simulator, faster is meaningless
MIN_STEP_S = 1.0e-6
MAX_STEP_S = 1.0e8  # ~3.2 years per request; Play = many bounded requests
MAX_BODIES = 200

BodyKind = Literal["star", "planet"]

# Renderer metadata (display only; never read by the physics). `kind` is the coarse role, `bodyType` the visual class.
BodyType = Literal["star", "rocky-planet", "gas-giant", "ice-giant", "asteroid", "default"]
ASSET_KEY_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"  # stable lowercase-kebab identifier, e.g. "earth", "proxima-centauri"
ASSET_KEY_MAX_LENGTH = 64


def default_body_type(kind: str) -> str:
    """bodyType of a body created without one. Derived from `kind` only, never from the display name."""
    return "star" if kind == "star" else "default"


def check_kind_body_type(kind: str, body_type: str) -> None:
    """A star is a "star" and only a star is: "default" is the neutral type and fits either kind."""
    if (kind == "star") != (body_type == "star") and body_type != "default":
        raise ValueError(f'bodyType "{body_type}" is inconsistent with kind "{kind}"')


class Vec3(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)
    z: float = Field(allow_inf_nan=False)


class Position3(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=-MAX_POSITION_M, le=MAX_POSITION_M, allow_inf_nan=False)
    y: float = Field(ge=-MAX_POSITION_M, le=MAX_POSITION_M, allow_inf_nan=False)
    z: float = Field(ge=-MAX_POSITION_M, le=MAX_POSITION_M, allow_inf_nan=False)


class Velocity3(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=-MAX_SPEED_M_PER_S, le=MAX_SPEED_M_PER_S, allow_inf_nan=False)
    y: float = Field(ge=-MAX_SPEED_M_PER_S, le=MAX_SPEED_M_PER_S, allow_inf_nan=False)
    z: float = Field(ge=-MAX_SPEED_M_PER_S, le=MAX_SPEED_M_PER_S, allow_inf_nan=False)

    @model_validator(mode="after")
    def _below_light_speed(self) -> "Velocity3":
        if (self.x ** 2 + self.y ** 2 + self.z ** 2) ** 0.5 >= MAX_SPEED_M_PER_S:
            raise ValueError("speed must be below the speed of light (299792458 m/s)")
        return self


class BodyCreate(BaseModel):
    """Request body for POST /api/v1/bodies. The server generates `id`."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    massKg: float = Field(gt=0, le=MAX_MASS_KG, allow_inf_nan=False)
    radiusM: float = Field(gt=0, le=MAX_RADIUS_M, allow_inf_nan=False)
    positionM: Position3
    velocityMPerS: Velocity3
    colorHex: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    kind: BodyKind = "planet"
    catalogueEntryId: str | None = Field(default=None, min_length=1, max_length=64)  # provenance only
    bodyType: BodyType | None = None  # omitted or null: derived from `kind` ("star" for a star, else "default")
    assetKey: str | None = Field(default=None, min_length=1, max_length=ASSET_KEY_MAX_LENGTH, pattern=ASSET_KEY_PATTERN)

    @model_validator(mode="after")
    def _body_type_matches_kind(self) -> "BodyCreate":
        if self.bodyType is not None:
            check_kind_body_type(self.kind, self.bodyType)
        return self

    @field_validator("catalogueEntryId")
    @classmethod
    def _known_catalogue_entry(cls, v: str | None) -> str | None:
        if v is not None and v not in catalogue_ids():
            raise ValueError(f"unknown catalogue entry: {v}")
        return v


class Body(BaseModel):
    """Response shape. Deliberately unbounded: the engine's evolved state is reported as-is, bounds apply to requests."""

    id: str
    name: str
    massKg: float
    radiusM: float
    positionM: Vec3
    velocityMPerS: Vec3
    colorHex: str
    kind: BodyKind = "planet"
    catalogueEntryId: str | None = None
    bodyType: BodyType = "default"  # always present
    assetKey: str | None = None  # always present; null = no specific asset, use the bodyType fallback


class BodyUpdate(BaseModel):
    """Request body for PATCH /api/v1/bodies/{id}: any subset of the BodyCreate fields, at least one."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=64)
    massKg: float | None = Field(default=None, gt=0, le=MAX_MASS_KG, allow_inf_nan=False)
    radiusM: float | None = Field(default=None, gt=0, le=MAX_RADIUS_M, allow_inf_nan=False)
    positionM: Position3 | None = None
    velocityMPerS: Velocity3 | None = None
    colorHex: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    kind: BodyKind | None = None
    bodyType: BodyType | None = None
    assetKey: str | None = Field(default=None, min_length=1, max_length=ASSET_KEY_MAX_LENGTH, pattern=ASSET_KEY_PATTERN)

    @model_validator(mode="after")
    def _non_empty_and_no_nulls(self) -> "BodyUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field must be provided")
        for field in self.model_fields_set:
            if getattr(self, field) is None and field != "assetKey":  # an explicit null assetKey clears it
                raise ValueError(f"{field} must not be null")
        return self


class Diagnostics(BaseModel):
    """System-level quantities of the exact state in `bodies` (definitions: backend/diagnostics.py, API_CONTRACT.md).
    Each value is finite or null (undefined / overflow); vectors are all-or-nothing."""

    version: Literal[1]  # semantics version; bump together with backend/diagnostics.py and API_CONTRACT.md
    totalMassKg: float | None
    totalMomentumKgMPerS: Vec3 | None
    kineticEnergyJ: float | None
    potentialEnergyJ: float | None
    angularMomentumAboutOriginKgM2PerS: Vec3 | None
    bookedSpinKgM2PerS: Vec3 | None


class SimulationState(BaseModel):
    status: Literal["paused", "running"]
    simulationTimeS: float
    bodies: list[Body]
    diagnostics: Diagnostics


class StepRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dtS: float = Field(ge=MIN_STEP_S, le=MAX_STEP_S, allow_inf_nan=False)


class Event(BaseModel):
    """A genuine engine event. The only outcome implemented is a perfectly inelastic merger."""

    id: str
    type: Literal["merger"]
    simulationTimeS: float  # engine time at which the overlap was DETECTED (end of an internal step)
    estimatedContactTimeS: float | None  # straight-line estimate of first contact; None if not estimable
    bodyIds: list[str]  # [survivor, absorbed]
    resultBodyId: str  # equals bodyIds[0]; the absorbed id no longer exists
    resultMassKg: float
    relativeSpeedMPerS: float
    kineticEnergyLostJ: float
    spinAddedKgM2PerS: Vec3  # orbital angular momentum booked as remnant spin (bookkeeping only)


class StepResponse(SimulationState):
    advancedS: float  # simulation time actually advanced (== dtS up to rounding)
    events: list[Event]  # events that occurred during this step only


class EventList(BaseModel):
    events: list[Event]
