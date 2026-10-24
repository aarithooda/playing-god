// Wire types for the backend API (SI units, camelCase). Source of truth: backend/models.py and
// context/API_CONTRACT.md. Do not rename or rescale fields here.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BodyType = "star" | "rocky-planet" | "gas-giant" | "ice-giant" | "moon" | "asteroid" | "default";

/** Stable rendering-asset identity assigned by the backend for recognized bodies; custom bodies omit it. */
export type BodyAssetKey =
  | "sun"
  | "mercury"
  | "venus"
  | "earth"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune"
  | "moon"
  | "io"
  | "europa"
  | "ganymede"
  | "callisto"
  | "titan"
  | "rhea"
  | "iapetus"
  | "dione"
  | "tethys"
  | "proxima-centauri"
  | "trappist-1"
  | "sirius-a"
  | "betelgeuse";
export type BodyKind = "star" | "planet";

export interface BodyDto {
  id: string;
  name: string;
  massKg: number;
  radiusM: number;
  positionM: Vec3;
  velocityMPerS: Vec3;
  colorHex: string;
  /** Physics role: a star shines, a planet is lit. The renderer never derives anything else from it. */
  kind: BodyKind;
  /** Catalogue provenance only (a catalogue entry is a copy, never a live reference). */
  catalogueEntryId: string | null;
  /** Renderer metadata, optional until the backend supplies it (feature/body-render-metadata). Absent -> derived from `kind`. */
  bodyType?: BodyType;
  /** Stable identity for a specific licensed visual asset set; custom or unknown bodies omit it. */
  assetKey?: string;
  /** Id of the body this one orbits (a moon's planet). Relationship metadata only: positions are always the simulated ones. */
  primaryId?: string;
}

/** POST /api/v1/bodies request (the server generates `id`). `kind` defaults to "planet" on the server. */
export type BodyCreateDto = Omit<BodyDto, "id" | "kind" | "catalogueEntryId" | "bodyType" | "assetKey" | "primaryId"> & {
  kind?: BodyKind;
  catalogueEntryId?: string | null;
  bodyType?: BodyType;
  assetKey?: string;
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
  /** Present when the backend records renderer metadata (older backends omit them). */
  bodyType?: BodyType;
  assetKey?: string;
  primaryId?: string;
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

// ---------- Body catalogue ----------
export type CatalogueBasis = "measured" | "nominal" | "estimated" | "illustrative";

export interface CataloguePropertyDto {
  /** SI value (kg or m). For a range the value is the midpoint, disclosed in `note`. */
  value: number;
  uncertainty: { minus: number; plus: number } | { range: [number, number] } | null;
  basis: CatalogueBasis;
  /** The number exactly as published, with its unit. */
  sourceValue: string;
  conversion: string;
  sources: { citation: string; url: string; retrieved: string }[];
  note?: string;
}

export interface CatalogueEntryDto {
  id: string;
  name: string;
  kind: BodyKind;
  /** Renderer classification and stable texture identity; omitted on older catalogue responses. */
  bodyType?: BodyType;
  assetKey?: string;
  properties: { massKg: CataloguePropertyDto; radiusM: CataloguePropertyDto };
  visual: { colorHex: string; note: string };
  notes: string;
}

export interface CatalogueDto {
  notes: string[];
  entries: CatalogueEntryDto[];
}

// ---------- Orbit Lab (Experiment 01) ----------
export type Vec3Tuple = [number, number, number];

export interface OrbitLabSystemDto {
  id: string;
  name: string;
  presetId: string;
  bodyIds: string[];
  selectableBodyIds: string[];
  speedFactors: number[];
  observationWindowS: number;
  sampleIntervalS: number;
  modelNote: string;
  description: string;
}

export interface ModificationDto {
  baselineUniverseId: string;
  baselineInitialDigest: string;
  bodyId: string;
  originalVelocityMPerS: Vec3Tuple;
  modifiedVelocityMPerS: Vec3Tuple;
  speedFactor: number;
  units: string;
  createdAtIso: string;
}

export interface ExperimentBodyDto {
  id: string;
  name: string;
  massKg: number;
  radiusM: number;
  positionM: Vec3Tuple;
  velocityMPerS: Vec3Tuple;
  speedMPerS: number;
}

export interface ExperimentDto {
  id: string;
  systemId: string;
  name: string;
  createdAtIso: string;
  baselineUniverseId: string;
  modifiedUniverseId: string | null;
  system: OrbitLabSystemDto;
  initialState: {
    epoch: string | null;
    jdTdb: number | null;
    frame: string | null;
    origin: string | null;
    units: string | null;
    digest: string;
    bodies: ExperimentBodyDto[];
    modelNote: string;
  };
  modification: ModificationDto | null;
}

export interface InitialDifferencesDto {
  experimentId: string;
  baselineUniverseId: string;
  modifiedUniverseId: string;
  differences: { bodyId: string; field: string; baseline: unknown; modified: unknown }[];
  configEqual: boolean;
}

export interface ComparisonDto {
  bodyId: string;
  sampleIntervalS: number;
  observationWindowS: number;
  baseline: { universeId: string; simulationTimeS: number; sampleCount: number };
  modified: { universeId: string; simulationTimeS: number; sampleCount: number } | null;
  commonSampleCount: number;
  timesS: number[];
  baselinePositionM: Vec3Tuple[];
  modifiedPositionM: Vec3Tuple[];
  separationM: number[];
  windowCompleteBoth: boolean;
  complete: boolean;
  issues: string[];
  timesDiffer: boolean;
  comparedUpToS: number | null;
  controlled: boolean;
  firstUncontrolledAtS: number | null;
  modification: ModificationDto | null;
}

export interface AuditEntryDto {
  atSimulationTimeS: number;
  op: string;
  bodyId: string;
  physical: boolean;
  changes: Record<string, unknown>;
}

export interface UniverseProvenanceDto {
  sourceKind: string;
  controlled: boolean;
  firstUncontrolledAtS: number | null;
  audit: AuditEntryDto[];
}
