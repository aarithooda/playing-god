// Test-only fixtures (never imported by production code).
import type { ApiClient, ScopedClient } from "../api/client";
import type {
  BodyCreateDto,
  BodyDto,
  BodyUpdateDto,
  CatalogueDto,
  CatalogueEntryDto,
  DiagnosticsDto,
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
