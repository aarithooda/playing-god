"""Response models of the spaceflight API (SI units; angles in degrees at this boundary). This module must not import
backend.models (which imports it for the `spacecraft` block of a body and the spaceflight events)."""
from typing import Literal, Optional

from pydantic import BaseModel


class V3(BaseModel):
    x: float
    y: float
    z: float


class OrbitOut(BaseModel):
    """Osculating two-body orbit of a spacecraft about its reference body, from the present state. It is an instantaneous
    description: in an N-body universe the elements drift, most of all near the edge of a sphere of influence."""

    referenceBodyId: str
    referenceBodyName: str
    regime: Literal["bound", "suborbital", "escape", "degenerate"]  # suborbital: bound, but the periapsis is below the surface
    radiusM: float
    altitudeM: float
    speedMPerS: float  # relative to the reference body
    semiMajorAxisM: Optional[float] = None
    eccentricity: Optional[float] = None
    inclinationDeg: Optional[float] = None  # to the simulation's x-y plane
    raanDeg: Optional[float] = None
    argPeriapsisDeg: Optional[float] = None
    trueAnomalyDeg: Optional[float] = None
    periapsisRadiusM: Optional[float] = None
    apoapsisRadiusM: Optional[float] = None  # null for an escape trajectory
    periapsisAltitudeM: Optional[float] = None
    apoapsisAltitudeM: Optional[float] = None
    periodS: Optional[float] = None  # null for an escape trajectory
    timeToPeriapsisS: Optional[float] = None
    timeToApoapsisS: Optional[float] = None
    specificEnergyJPerKg: float
    circularSpeedMPerS: float  # at the present radius
    escapeSpeedMPerS: float  # at the present radius
    sphereOfInfluenceM: Optional[float] = None  # of the reference body; null when it has no parent (unbounded)
    gravitationalParameterM3PerS2: float


class SpacecraftOut(BaseModel):
    dryMassKg: float
    propellantKg: float
    propellantCapacityKg: float
    thrustN: float
    ispS: float
    massFlowKgPerS: float
    deltaVRemainingMPerS: float  # Tsiolkovsky, from the propellant on board
    thrusting: bool
    homeBodyId: Optional[str] = None
    orbit: Optional[OrbitOut] = None  # null only in a universe without any gravitating body


class ManeuverOut(BaseModel):
    id: str
    spacecraftId: str
    epochS: float
    mode: Literal["impulsive", "finite"]
    frame: Literal["vnb", "inertial"]
    referenceBodyId: Optional[str] = None
    progradeMPerS: Optional[float] = None
    normalMPerS: Optional[float] = None
    radialMPerS: Optional[float] = None
    deltaVMPerS: Optional[V3] = None  # inertial-frame nodes
    deltaVMagnitudeMPerS: float
    label: str
    centered: bool
    missionId: Optional[str] = None
    role: Optional[str] = None
    status: Literal["planned", "executing", "executed", "failed"]
    startS: float
    endS: float
    plannedPropellantKg: float
    feasible: bool
    startedAtS: Optional[float] = None
    endedAtS: Optional[float] = None
    deliveredDeltaVMPerS: Optional[float] = None
    propellantUsedKg: Optional[float] = None
    failure: Optional[str] = None


class MissionOut(BaseModel):
    id: str
    name: str
    spacecraftId: str
    originBodyId: Optional[str] = None
    destinationBodyId: str
    objective: dict
    status: Literal["draft", "planned", "in_progress", "completed", "failed", "unsupported"]
    phase: str
    reasons: list[str]
    committed: bool
    planRevision: int
    planStale: bool
    plan: Optional[dict] = None
    maneuverIds: list[str]
    checks: list[dict]
    agreement: list[dict]
    outcome: Optional[dict] = None
    createdAtS: float
    updatedAtS: float


class SpaceflightOut(BaseModel):
    """Manoeuvre nodes and missions of a universe; part of a state response only when there are any."""

    maneuvers: list[ManeuverOut]
    missions: list[MissionOut]


class HaltOut(BaseModel):
    """The simulation is stopped at a contact; stepping is refused until the contact is removed."""

    eventId: str
    reason: Literal["collision"]
    bodyIds: list[str]
    simulationTimeS: float
    relativeSpeedMPerS: float
    refined: bool
    message: str


class ManeuverEvent(BaseModel):
    """A burn of a spacecraft changed the simulation state (`phase`: an impulse, or the ignition / cutoff of a finite burn)."""

    id: str
    type: Literal["maneuver"]
    simulationTimeS: float
    bodyIds: list[str]  # [spacecraft]
    maneuverId: str
    phase: Literal["impulse", "ignition", "cutoff"]
    mode: Literal["impulsive", "finite"]
    referenceBodyId: Optional[str] = None
    commandedDeltaVMPerS: float
    deliveredDeltaVMPerS: float  # so far (0 at ignition)
    propellantUsedKg: float
    missionId: Optional[str] = None
    label: str


class ContactEvent(BaseModel):
    """Two bodies touched and the simulation stopped there (the stop-on-contact policy). Nothing was merged or broken."""

    id: str
    type: Literal["contact"]
    simulationTimeS: float
    estimatedContactTimeS: Optional[float] = None
    bodyIds: list[str]
    relativeSpeedMPerS: float
    refined: bool
    involvesSpacecraft: bool


class TrajectoryOut(BaseModel):
    """The PLANNED trajectory of a mission: a prediction flown on a copy of the universe when the plan was made. The actual path is
    the universe's recorded history."""

    missionId: str
    planRevision: int
    frame: str
    timesS: list[float]
    spacecraftM: list[list[float]]
    originM: list[list[float]]
    destinationM: list[list[float]]


class OrbitPreviewOut(BaseModel):
    positionM: V3
    velocityMPerS: V3
    orbit: OrbitOut
    warnings: list[str]


class ManeuverPreviewOut(BaseModel):
    epochS: float
    basis: str
    deltaVMagnitudeMPerS: float
    propellantKg: float
    burnDurationS: float
    feasible: bool
    before: OrbitOut
    after: OrbitOut


class SpacecraftCreated(BaseModel):
    id: str
    warnings: list[str]
