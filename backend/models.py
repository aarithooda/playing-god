"""Pydantic models for the API contract (see context/API_CONTRACT.md). SI units throughout."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Finite floats only: NaN and +/-Infinity are rejected.
FiniteFloat = Field(allow_inf_nan=False)


class Vec3(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = FiniteFloat
    y: float = FiniteFloat
    z: float = FiniteFloat


class BodyCreate(BaseModel):
    """Request body for POST /api/v1/bodies. The server generates `id`."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    massKg: float = Field(gt=0, allow_inf_nan=False)
    radiusM: float = Field(gt=0, allow_inf_nan=False)
    positionM: Vec3
    velocityMPerS: Vec3
    colorHex: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class Body(BodyCreate):
    id: str


class SimulationState(BaseModel):
    status: Literal["paused", "running"]
    simulationTimeS: float
    bodies: list[Body]
