// Wire types for the backend API (SI units, camelCase). Source of truth: backend/models.py and
// context/API_CONTRACT.md. Do not rename or rescale fields here.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BodyDto {
  id: string;
  name: string;
  massKg: number;
  radiusM: number;
  positionM: Vec3;
  velocityMPerS: Vec3;
  colorHex: string;
}

/** POST /api/v1/bodies request (the server generates `id`). */
export type BodyCreateDto = Omit<BodyDto, "id">;

/** PATCH /api/v1/bodies/{id} request: any non-empty subset; vectors are replaced whole. */
export type BodyUpdateDto = Partial<BodyCreateDto>;

export type SimulationStatus = "paused" | "running";

export interface SimulationStateDto {
  status: SimulationStatus;
  simulationTimeS: number;
  bodies: BodyDto[];
}

export interface SimulationEventDto {
  id: string;
  type: "merger";
  simulationTimeS: number;
  estimatedContactTimeS: number | null;
  bodyIds: string[]; // [survivor, absorbed]
  resultBodyId: string;
  resultMassKg: number;
  relativeSpeedMPerS: number;
  kineticEnergyLostJ: number;
  spinAddedKgM2PerS: Vec3;
}

export interface StepResponseDto extends SimulationStateDto {
  advancedS: number;
  events: SimulationEventDto[];
}

export interface EventListDto {
  events: SimulationEventDto[];
}

/** Request bounds enforced by the backend (mirrors backend/models.py; the server stays authoritative). */
export const LIMITS = {
  maxMassKg: 1.0e45,
  maxRadiusM: 1.0e15,
  maxPositionM: 1.0e18,
  maxSpeedMPerS: 2.99792458e8,
  minStepS: 1.0e-6,
  maxStepS: 1.0e8,
  maxNameLength: 64,
} as const;
