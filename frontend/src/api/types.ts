// Wire types for the backend API (SI units, camelCase). Source of truth: backend/models.py and
// context/API_CONTRACT.md. Do not rename or rescale fields here.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BodyKind = "star" | "planet";

export interface BodyDto {
  id: string;
  name: string;
  massKg: number;
  radiusM: number;
  positionM: Vec3;
  velocityMPerS: Vec3;
  colorHex: string;
  kind: BodyKind;
  /** Catalogue provenance only (a catalogue entry is a copy, never a live reference). */
  catalogueEntryId: string | null;
}

/** POST /api/v1/bodies request (the server generates `id`). `kind` defaults to "planet" on the server. */
export type BodyCreateDto = Omit<BodyDto, "id" | "kind" | "catalogueEntryId"> & {
  kind?: BodyKind;
  catalogueEntryId?: string | null;
};

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
  /**
   * Backend diagnostics, or `null` when the response had none or they cannot be trusted (see `diagnosticsIssue`).
   * A diagnostics problem never prevents the bodies from being shown.
   */
  diagnostics: DiagnosticsDto | null;
  /** Why `diagnostics` is null (missing, unsupported version, malformed); null when diagnostics are present. */
  diagnosticsIssue: string | null;
  /** Universe-scoped responses only: which universe this state belongs to and its commit counter. */
  universeId?: string;
  revision?: number;
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

// ---------- Simulation Lab: universes, presets, snapshots, history ----------
export type UniverseRole = "sandbox" | "preset" | "baseline" | "modified";

export interface LastFailureDto {
  kind: string;
  message: string;
  atSimulationTimeS: number;
  atIso: string;
}

export interface UniverseSummaryDto {
  id: string;
  name: string;
  role: UniverseRole;
  presetId: string | null;
  experimentId: string | null;
  active: boolean;
  simulationTimeS: number;
  bodyCount: number;
  revision: number;
  status: "idle" | "mutating";
  lastFailure: LastFailureDto | null;
  createdAtIso: string;
  epochLabel: string | null;
  historyMode: "grid" | "step";
}

export interface UniverseListDto {
  universes: UniverseSummaryDto[];
  activeUniverseId: string;
  activationEpoch: number;
}

export interface ActivationDto {
  activeUniverseId: string;
  activationEpoch: number;
}

export type CreateUniverseDto = {
  name?: string;
  source: { kind: "empty" } | { kind: "preset"; presetId: string };
  activate?: boolean;
};

export interface PresetSummaryDto {
  id: string;
  name: string;
  description: string;
  available: boolean;
  unavailableReason: string | null;
  bodyCount: number;
  epochLabel: string | null;
}

export interface SnapshotSummaryDto {
  id: string;
  name: string;
  createdAtIso: string;
  simulationTimeS: number;
  bodyCount: number;
  revision: number;
  controlled: boolean;
}

export interface HistorySampleDto {
  index: number;
  simulationTimeS: number;
  segment: number;
  positionsM: Record<string, [number, number, number]>;
}

export interface HistoryBodyMetaDto {
  name: string;
  colorHex: string;
  radiusM: number;
  kind: string;
}

export interface HistoryPageDto {
  universeId: string;
  mode: "grid" | "step";
  sampleIntervalS: number | null;
  generation: number;
  firstIndex: number;
  nextIndex: number;
  droppedBefore: number;
  truncated: boolean;
  samples: HistorySampleDto[];
  bodies: Record<string, HistoryBodyMetaDto>;
}

/** The universe a client acts on: every mutation echoes `activationEpoch` so a stale request is refused. */
export interface UniverseScope {
  universeId: string;
  activationEpoch: number;
}
