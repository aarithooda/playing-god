// Test-only fixtures (never imported by production code).
import type { ApiClient, ScopedClient } from "../api/client";
import type {
  BodyCreateDto,
  BodyDto,
  BodyUpdateDto,
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
