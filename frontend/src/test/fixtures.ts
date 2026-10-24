// Test-only fixtures (never imported by production code).
import type { ApiClient, ScopedClient } from "../api/client";
import type {
  BodyCreateDto,
  BodyDto,
  BodyUpdateDto,
  CatalogueDto,
  CatalogueEntryDto,
  ComparisonDto,
  DiagnosticsDto,
  ExperimentDto,
  InitialDifferencesDto,
  OrbitLabSystemDto,
  HistoryPageDto,
  PresetSummaryDto,
  SimulationEventDto,
  SimulationStateDto,
  SnapshotSummaryDto,
  StepResponseDto,
  UniverseListDto,
  UniverseScope,
  UniverseSummaryDto,
} from "../api/types";

export const sun: BodyDto = {
  id: "body-aaaaaaaaaaaa",
  name: "Sun",
  massKg: 1.989e30,
  radiusM: 6.957e8,
  positionM: { x: 0, y: 0, z: 0 },
  velocityMPerS: { x: 0, y: 0, z: 0 },
  colorHex: "#fdb813",
  kind: "star",
  catalogueEntryId: null,
  bodyType: "star",
};

export const earth: BodyDto = {
  id: "body-bbbbbbbbbbbb",
  name: "Earth",
  massKg: 5.972e24,
  radiusM: 6.371e6,
  positionM: { x: 1.496e11, y: 0, z: 0 },
  velocityMPerS: { x: 0, y: 29780, z: 0 },
  colorHex: "#3b82f6",
  kind: "planet",
  catalogueEntryId: null,
  bodyType: "rocky-planet",
};

export const mergerEvent: SimulationEventDto = {
  id: "evt-1",
  type: "merger",
  simulationTimeS: 7200,
  estimatedContactTimeS: 7000,
  bodyIds: [sun.id, earth.id],
  resultBodyId: sun.id,
  resultMassKg: 1.989e30 + 5.972e24,
  relativeSpeedMPerS: 29780,
  kineticEnergyLostJ: 1e33,
  spinAddedKgM2PerS: { x: 0, y: 0, z: 1e40 },
};

export const zeroVec = { x: 0, y: 0, z: 0 };

export const diagnostics: DiagnosticsDto = {
  version: 1,
  totalMassKg: 1.989e30 + 5.972e24,
  totalMomentumKgMPerS: { x: 0, y: 1.7786e29, z: 0 },
  kineticEnergyJ: 2.6e33,
  potentialEnergyJ: -5.3e33,
  angularMomentumAboutOriginKgM2PerS: { x: 0, y: 0, z: 2.66e40 },
  bookedSpinKgM2PerS: zeroVec,
};

export function state(bodies: BodyDto[], t = 0): SimulationStateDto {
  return { status: "paused", simulationTimeS: t, bodies, diagnostics, diagnosticsIssue: null };
}

export function stepResponse(bodies: BodyDto[], t: number, events: SimulationEventDto[] = []): StepResponseDto {
  return { ...state(bodies, t), advancedS: 100, events };
}

export function universe(o: Partial<UniverseSummaryDto> = {}): UniverseSummaryDto {
  return {
    id: "uni-default", name: "Sandbox", role: "sandbox", presetId: null, experimentId: null, active: true,
    simulationTimeS: 0, bodyCount: 2, revision: 0, status: "idle", lastFailure: null,
    createdAtIso: "2026-01-01T00:00:00Z", epochLabel: null, historyMode: "step", ...o,
  };
}

export function universeList(universes: UniverseSummaryDto[] = [universe()], epoch = 1): UniverseListDto {
  const active = universes.find((u) => u.active) ?? universes[0]!;
  return { universes, activeUniverseId: active.id, activationEpoch: epoch };
}

export const solarPreset: PresetSummaryDto = {
  id: "solar-system-j2000", name: "Solar System (J2000.0)", description: "The Sun and the eight planets.",
  available: true, unavailableReason: null, bodyCount: 9, epochLabel: "J2000.0",
};

export type FakeClient = ApiClient;

/**
 * A scriptable in-memory client; tests override the methods they care about. It serves both the unscoped surface
 * and, through `scoped()`, a scoped one that shares the same overrides (so existing single-universe tests keep
 * working unchanged).
 */
export function fakeClient(overrides: Partial<ApiClient & ScopedClient> = {}): ApiClient {
  const base = {
    health: async () => true,
    getState: async () => state([sun, earth]),
    createBody: async (b: BodyCreateDto): Promise<BodyDto> => ({
      id: "body-new", name: b.name, massKg: b.massKg, radiusM: b.radiusM, positionM: b.positionM,
      velocityMPerS: b.velocityMPerS, colorHex: b.colorHex, kind: b.kind ?? "planet", catalogueEntryId: b.catalogueEntryId ?? null,
    }),
    updateBody: async (id: string, patch: BodyUpdateDto): Promise<BodyDto> => ({ ...sun, ...patch, id } as BodyDto),
    deleteBody: async () => undefined,
    step: async () => stepResponse([sun, earth], 100),
    reset: async () => state([]),
    getEvents: async () => [],
    listUniverses: async () => universeList(),
    createUniverse: async () => universe({ id: "uni-new", active: false }),
    activateUniverse: async (id: string) => ({ activeUniverseId: id, activationEpoch: 2 }),
    deleteUniverse: async () => undefined,
    listPresets: async () => [solarPreset],
    getCatalogue: async () => catalogueFixture,
    listOrbitLabSystems: async () => [orbitSystem],
    listExperiments: async () => [],
    createExperiment: async () => experiment(),
    createModifiedRun: async (_id: string, req: { speedFactor: number }) => experiment({ modifiedUniverseId: "uni-mod", modification: modificationOf(req.speedFactor) }),
    getInitialDifferences: async (): Promise<InitialDifferencesDto> => ({
      experimentId: "exp-1", baselineUniverseId: "uni-base", modifiedUniverseId: "uni-mod",
      differences: [{ bodyId: "body-earth", field: "velocityMPerS", baseline: [0, 29786.6, 0], modified: [0, 32765.3, 0] }], configEqual: true,
    }),
    getComparison: async (): Promise<ComparisonDto> => comparison(),
    deleteExperiment: async () => undefined,
    getProvenance: async () => ({ sourceKind: "sandbox", controlled: true, firstUncontrolledAtS: null, audit: [] }),
    listSnapshots: async () => [],
    createSnapshot: async (name?: string): Promise<SnapshotSummaryDto> => ({
      id: "snap-1", name: name ?? "Snapshot", createdAtIso: "2026-01-01T00:00:00Z", simulationTimeS: 0, bodyCount: 2,
      revision: 0, controlled: true,
    }),
    restoreSnapshot: async () => state([sun, earth]),
    deleteSnapshot: async () => undefined,
    getHistory: async (): Promise<HistoryPageDto> => ({
      universeId: "uni-default", mode: "step", sampleIntervalS: null, generation: 1, firstIndex: 0, nextIndex: 0,
      droppedBefore: 0, truncated: false, samples: [], bodies: {},
    }),
  };
  const self = { ...base, ...overrides } as ApiClient & ScopedClient;
  self.scoped = overrides.scoped ?? ((scope: UniverseScope) => ({ ...self, scope }) as ScopedClient);
  return self;
}

const src = [{ citation: "JPL SSD Planetary Physical Parameters", url: "https://ssd.jpl.nasa.gov/planets/phys_par.html", retrieved: "2026-10-24" }];

export const earthEntry: CatalogueEntryDto = {
  id: "earth", name: "Earth", kind: "planet",
  properties: {
    massKg: { value: 5.97217e24, uncertainty: { minus: 2.8e20, plus: 2.8e20 }, basis: "measured", sourceValue: "5.97217 \u00b1 0.00028 \u00d7 10^24 kg", conversion: "x 1e24 kg", sources: src },
    radiusM: { value: 6371008.4, uncertainty: { minus: 0.1, plus: 0.1 }, basis: "measured", sourceValue: "6371.0084 \u00b1 0.0001 km (mean radius)", conversion: "x 1000 m", sources: src },
  },
  visual: { colorHex: "#3b82f6", note: "display only, not a physical property" }, notes: "Earth alone, without the Moon.",
};

export const betelgeuseEntry: CatalogueEntryDto = {
  id: "betelgeuse", name: "Betelgeuse", kind: "star",
  properties: {
    massKg: { value: 3.53e31, uncertainty: { range: [3.28e31, 3.78e31] }, basis: "estimated", sourceValue: "16.5\u201319 M\u2609 (range; value is the midpoint 17.75)", conversion: "x nominal M\u2609", sources: src, note: "model-dependent estimate; the value shown is the midpoint of the published range" },
    radiusM: { value: 5.31e11, uncertainty: { minus: 4.3e10, plus: 8.1e10 }, basis: "estimated", sourceValue: "764 (+116/\u221262) R\u2609", conversion: "x 6.957e8 m", sources: src, note: "model-dependent estimate" },
  },
  visual: { colorHex: "#ff6a3d", note: "display only, not a physical property" }, notes: "A red supergiant.",
};

export const catalogueFixture: CatalogueDto = {
  notes: ["Catalogue entries are single bodies, not validated systems: nothing here has positions or velocities.", "Colour is a display choice, not a physical property."],
  entries: [betelgeuseEntry, earthEntry],
};

export const orbitSystem: OrbitLabSystemDto = {
  id: "exp01-sun-emb-j2000", name: "Sun + Earth–Moon barycentre (J2000)", presetId: "solar-system-j2000",
  bodyIds: ["body-sun", "body-earth"], selectableBodyIds: ["body-earth"], speedFactors: [0.9, 0.95, 1.05, 1.1],
  observationWindowS: 63072000, sampleIntervalS: 86400,
  modelNote: "Two-body model: Sun + Earth–Moon barycentre; positions are barycentres; not a forecast of Earth's real position.",
  description: "How does changing a planet's initial velocity affect its subsequent orbit?",
};

export const modificationOf = (f: number) => ({
  baselineUniverseId: "uni-base", baselineInitialDigest: "d".repeat(64), bodyId: "body-earth",
  originalVelocityMPerS: [-1000, 29786.6, 12] as [number, number, number],
  modifiedVelocityMPerS: [-1000 * f, 29786.6 * f, 12 * f] as [number, number, number],
  speedFactor: f, units: "m/s", createdAtIso: "2026-01-01T00:00:00Z",
});

export function experiment(o: Partial<ExperimentDto> = {}): ExperimentDto {
  return {
    id: "exp-1", systemId: orbitSystem.id, name: orbitSystem.name, createdAtIso: "2026-01-01T00:00:00Z",
    baselineUniverseId: "uni-base", modifiedUniverseId: null, system: orbitSystem,
    initialState: {
      epoch: "J2000.0", jdTdb: 2451545, frame: "Ecliptic and mean equinox of J2000.0", origin: "Barycentre of the two included bodies",
      units: "SI: m, kg, s, m/s", digest: "d".repeat(64), modelNote: orbitSystem.modelNote,
      bodies: [
        { id: "body-sun", name: "Sun", massKg: 1.98841e30, radiusM: 6.957e8, positionM: [0, 0, 0], velocityMPerS: [0, 0, 0], speedMPerS: 0 },
        { id: "body-earth", name: "Earth (Earth–Moon barycentre)", massKg: 6.0459e24, radiusM: 6.371e6, positionM: [-2.7e10, 1.4e11, 3e7],
          velocityMPerS: [-29800, -5400, 0.3], speedMPerS: 30286.011 },
      ],
    },
    modification: null, ...o,
  };
}

export function comparison(o: Partial<ComparisonDto> = {}): ComparisonDto {
  const n = 4;
  return {
    bodyId: "body-earth", sampleIntervalS: 86400, observationWindowS: 63072000,
    baseline: { universeId: "uni-base", simulationTimeS: 3 * 86400, sampleCount: n },
    modified: { universeId: "uni-mod", simulationTimeS: 3 * 86400, sampleCount: n },
    commonSampleCount: n, timesS: [0, 1, 2, 3].map((k) => k * 86400),
    baselinePositionM: [0, 1, 2, 3].map((k) => [1.5e11 + k * 2.5e9, 0, 0] as [number, number, number]),
    modifiedPositionM: [0, 1, 2, 3].map((k) => [1.5e11 + k * 2.75e9, 0, 0] as [number, number, number]),
    separationM: [0, 2.5e8, 5e8, 7.5e8], windowCompleteBoth: false, complete: false, issues: [], timesDiffer: false,
    comparedUpToS: 3 * 86400, controlled: true, firstUncontrolledAtS: null, modification: modificationOf(1.1), ...o,
  };
}
