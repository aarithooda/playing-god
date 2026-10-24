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
  | "earth"
  | "mars"
  | "jupiter"
  | "neptune"
  | "moon"
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
  /** Collision engine (optional, present only when set): material profile, spin (rad/s, inertial frame) and orientation. */
  material?: MaterialDto;
  spinRadPerS?: Vec3;
  orientation?: OrientationDto;
  /** Bodies created by a collision: absent for ordinary bodies. A parcel carries a mass but stands for many pieces. */
  representation?: "fragment" | "debris-parcel";
  originEventId?: string;
  debris?: DebrisDto;
  /** Fragments and parcels: dynamical class from the present state (Stage 7). Not a prediction. */
  fragmentClass?: "bound_to_remnant" | "orbiting_system" | "escaping";
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
export interface MaterialLayerDto {
  materialId: string;
  massFraction: number;
  phase: "solid" | "molten" | "partial" | "gas";
  meltFraction: number | null;
  densityKgPerM3: number | null;
}

/** A body's material: a backend registry profile id (GET /api/v1/materials), optionally with layer overrides. */
export interface MaterialDto {
  profileId: string;
  layers: MaterialLayerDto[] | null;
}

/** Unit quaternion [w, x, y, z] (body -> world) at simulation time `epochS`. Present only for a body with a rotation state. */
export interface OrientationDto {
  quaternion: [number, number, number, number];
  epochS: number;
}

/** What a debris parcel stands for (a statistical population, not a single object). `sizeDistribution` is set for parcels of Stage 5 fragmentation (null only for the single-parcel hit-and-run path). */
export interface DebrisDto {
  totalMassKg: number;
  sizeDistribution: { kind: "power-law"; exponent: number; dMinM: number; dMaxM: number } | null;
  velocityDispersionMPerS: number;
  materialProfileId: string | null;
  sampleSeed: number;
}

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
  /** Sum of I*omega over bodies WITH a rotation state. Absent (not null) in every state without one. */
  spinAngularMomentumKgM2PerS?: Vec3 | null;
  /** Material that left the simulation through the explicit escape rule (Stage 7); totals including it are conserved. Absent until then. */
  escaped?: EscapedLedgerDto;
}

/** One row of the collision-record list (GET .../collisions). */
export interface CollisionSummaryDto {
  eventId: string;
  legacyEventId: string | null;
  parentEventId: string | null;
  rootEventId: string;
  generation: number;
  outcome: string | null;
  modelId: string | null;
  modelVersion: string | null;
  timeS: number;
  bodyIds: string[];
  warnings: string[];
  hasResult: boolean;
  detailDropped: boolean;
  inputDigest: string;
  resultDigest: string;
}

export interface CollisionListDto {
  total: number;
  offset: number;
  limit: number;
  maxRecords: number;
  records: CollisionSummaryDto[];
}

/** The parts of a collision record the inspector shows (spec 10.2). Everything in it is a field of the API; nothing is derived. */
export interface CollisionRecordDto {
  eventId: string;
  legacyEventId: string | null;
  parentEventId: string | null;
  rootEventId: string;
  generation: number;
  selectionReasons: string[];
  warnings: string[];
  fidelity: Record<string, string>;
  inputDigest: string;
  resultDigest: string;
  impact: {
    detectionTimeS: number;
    targetId: string;
    projectileId: string;
    targetMassKg: number;
    projectileMassKg: number;
    impactSpeedMPerS: number;
    impactAngleDeg: number;
    specificImpactEnergyJPerKg: number;
    contactPointM: Vec3;
    targetMaterialId: string | null;
    projectileMaterialId: string | null;
  };
  outcome: {
    outcome: string;
    modelId: string;
    modelVersion: string;
    regimeReasons: string[];
    parameters: { name: string; value: number; unit: string; source: string }[];
    debrisMassKg: number;
  } | null;
  result: {
    removedBodyIds: string[];
    survivingBodyIds: string[];
    createdBodyIds: string[];
    parcelIds: string[];
    massLedger: Record<string, number>;
    conservation: {
      massResidualRel: number;
      momentumResidualRel: number;
      angularMomentumResidualRel: number | null;
      angularMomentumUnmodelled: string | null;
      dissipatedJ: number;
      dissipatedNonNegative: boolean;
      withinTolerance: boolean;
    };
  } | null;
}

export interface CollisionProductDto {
  bodyId: string;
  representation: string;
  massKgAtEvent: number;
  exists: boolean;
  fragmentClass: "bound_to_remnant" | "orbiting_system" | "escaping" | null;
  massKgNow: number | null;
}

export interface CollisionDetailDto {
  record: CollisionRecordDto;
  childEventIds: string[];
  products: CollisionProductDto[];
  escapedLedger: EscapedLedgerDto | null;
  note: string;
}

export interface ReplayCheckDto {
  name: string;
  ok: boolean | null;
  detail: string;
}

export interface ReplayReportDto {
  eventId: string;
  reproduced: boolean;
  checks: ReplayCheckDto[];
  recordedResultDigest: string;
  replayedResultDigest: string;
  differingFields: string[];
  mutatesState: boolean;
}

export interface EscapedLedgerDto {
  massKg: number;
  momentumKgMPerS: Vec3;
  angularMomentumAboutOriginKgM2PerS: Vec3;
  bodyCount: number;
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

/** The legacy perfectly inelastic merger (unchanged shape). */
export interface MergerEventDto {
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

/** Collision engine event (backend mode outcome-v1): a summary; the physics, residuals and reasons are the backend's. */
export interface CollisionEventDto {
  id: string;
  type: "collision";
  schemaVersion: number;
  outcome: string;
  simulationTimeS: number;
  estimatedContactTimeS: number | null;
  bodyIds: string[]; // [target, projectile]
  survivingBodyIds: string[];
  createdBodyIds: string[];
  removedBodyIds: string[];
  parentEventId: string | null;
  rootEventId: string;
  generation: number;
  modelId: string;
  modelVersion: string;
  impactSpeedMPerS: number;
  impactAngleDeg: number;
  specificImpactEnergyJPerKg: number;
  largestRemnantMassKg: number;
  debrisMassKg: number;
  massResidualRel: number;
  momentumResidualRel: number;
  warnings: string[];
  /** quantity -> computed | model | approximation | statistical | visual | unsupported */
  fidelitySummary: Record<string, string>;
  hasVisual: boolean;
}

export type SimulationEventDto = MergerEventDto | CollisionEventDto;

export interface StepResponseDto extends SimulationStateDto {
  advancedS: number;
  /** Present only when non-empty: "collision_budget_reached" = the step ended early (advancedS < dtS), by design (DQ-10). */
  warnings?: string[];
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
