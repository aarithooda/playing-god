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

/** Diagnostics semantics version this client understands (backend `DIAGNOSTICS_VERSION`). */
export const DIAGNOSTICS_VERSION = 1;

/**
 * System-level quantities of exactly the state in `bodies` (backend/diagnostics.py, API_CONTRACT.md "Diagnostics").
 * Each value is finite or `null` (undefined or overflowed); a vector is all-or-nothing. Computed by the backend only.
 */
export interface DiagnosticsDto {
  version: typeof DIAGNOSTICS_VERSION;
  totalMassKg: number | null;
  totalMomentumKgMPerS: Vec3 | null;
  kineticEnergyJ: number | null;
  potentialEnergyJ: number | null;
  /** About the fixed simulation origin (0,0,0), not the centre of mass. */
  angularMomentumAboutOriginKgM2PerS: Vec3 | null;
  /** Sum of spin booked by mergers (bookkeeping only; no rotation dynamics). */
  bookedSpinKgM2PerS: Vec3 | null;
}

export interface SimulationStateDto {
  status: SimulationStatus;
  simulationTimeS: number;
  bodies: BodyDto[];
  diagnostics: DiagnosticsDto;
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
