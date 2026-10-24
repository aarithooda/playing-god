"""Pydantic models for the API contract (see context/API_CONTRACT.md). SI units throughout."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer, model_validator

from backend.catalogue import catalogue_ids

# Request bounds (documented in the contract). Finite floats only: NaN and +/-Infinity are rejected.
MAX_MASS_KG = 1.0e45  # ~5e14 solar masses
MAX_RADIUS_M = 1.0e15  # ~100 light-years
MAX_POSITION_M = 1.0e18  # ~100 light-years
MAX_SPEED_M_PER_S = 2.99792458e8  # speed of light: this is a Newtonian simulator, faster is meaningless
MIN_STEP_S = 1.0e-6
MAX_STEP_S = 1.0e8  # ~3.2 years per request; Play = many bounded requests
MAX_BODIES = 200
MAX_SPIN_RAD_PER_S = 1.0e5  # sanity bound on a requested spin rate (a request limit like the others, not a physical claim)

BodyKind = Literal["star", "planet"]

# Renderer metadata (display only; never read by the physics). `kind` is the coarse role, `bodyType` the visual class.
BodyType = Literal["star", "rocky-planet", "gas-giant", "ice-giant", "moon", "asteroid", "default"]
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


class LayerSpec(BaseModel):
    """A layer of a body's material override (collision engine, plan 4.2). Validated against the contract in the service."""

    model_config = ConfigDict(extra="forbid")

    materialId: str = Field(min_length=1, max_length=64)
    massFraction: float = Field(ge=0, le=1, allow_inf_nan=False)
    phase: Literal["solid", "molten", "partial", "gas"]
    meltFraction: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    densityKgPerM3: float | None = Field(default=None, gt=0, allow_inf_nan=False)


class MaterialSpec(BaseModel):
    """`material` of a body: a registry profile id, optionally with layer overrides. Absent / null = unspecified."""

    model_config = ConfigDict(extra="forbid")

    profileId: str = Field(min_length=1, max_length=64)
    layers: list[LayerSpec] | None = Field(default=None, min_length=1, max_length=16)


class SpinVec3(BaseModel):
    """Angular velocity in the inertial frame [rad/s]."""

    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=-MAX_SPIN_RAD_PER_S, le=MAX_SPIN_RAD_PER_S, allow_inf_nan=False)
    y: float = Field(ge=-MAX_SPIN_RAD_PER_S, le=MAX_SPIN_RAD_PER_S, allow_inf_nan=False)
    z: float = Field(ge=-MAX_SPIN_RAD_PER_S, le=MAX_SPIN_RAD_PER_S, allow_inf_nan=False)


class OrientationSpec(BaseModel):
    """Unit quaternion [w, x, y, z] (body -> world) at simulation time `epochS`. Request: the orientation at that epoch."""

    model_config = ConfigDict(extra="forbid")

    quaternion: list[float] = Field(min_length=4, max_length=4)
    epochS: float = Field(allow_inf_nan=False)

    @field_validator("quaternion")
    @classmethod
    def _finite(cls, v: list[float]) -> list[float]:
        if not all(isinstance(c, (int, float)) and abs(c) < float("inf") for c in v):
            raise ValueError("quaternion components must be finite numbers")
        return [float(c) for c in v]


# Optional collision-engine fields of a body. They are OMITTED from responses when null, so a body without a material looks
# exactly as before (D-033 DQ-2: no new body fields, no spin state).
COLLISION_BODY_FIELDS = ("material", "spinRadPerS", "orientation")


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
    material: MaterialSpec | None = None  # None: unspecified -> exact legacy merge, no spin state
    spinRadPerS: SpinVec3 | None = None  # needs a material whose profile has a moment-of-inertia factor
    orientation: OrientationSpec | None = None  # same requirement

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
    primaryId: str | None = None  # always present; id of the body this one orbits (moon -> planet). Display only
    material: MaterialSpec | None = None  # present only when set
    spinRadPerS: Vec3 | None = None  # present only when the body has a rotation state
    orientation: OrientationSpec | None = None  # present only when the body has a rotation state

    @model_serializer(mode="wrap")
    def _omit_unset_collision_fields(self, handler):
        data = handler(self)
        for key in COLLISION_BODY_FIELDS:
            if data.get(key) is None:
                data.pop(key, None)
        return data


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
    material: MaterialSpec | None = None  # an explicit null clears it (not allowed while the body has a spin state)
    spinRadPerS: SpinVec3 | None = None  # an explicit null clears the rotation state

    @model_validator(mode="after")
    def _non_empty_and_no_nulls(self) -> "BodyUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field must be provided")
        for field in self.model_fields_set:
            if getattr(self, field) is None and field not in ("assetKey", "material", "spinRadPerS"):  # explicit null clears these
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
    # Additive and optional: present only when some body has a rotation state (Stage 2). The version stays 1, so older
    # clients, which are strict about `version`, keep working; the key is simply absent in every other state.
    spinAngularMomentumKgM2PerS: Vec3 | None = None

    @model_serializer(mode="wrap")
    def _omit_absent_spin_term(self, handler):
        data = handler(self)
        if data.get("spinAngularMomentumKgM2PerS") is None:
            data.pop("spinAngularMomentumKgM2PerS", None)
        return data


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
