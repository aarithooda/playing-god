// Test-only fixtures (never imported by production code).
import type { ApiClient } from "../api/client";
import type { BodyDto, DiagnosticsDto, SimulationEventDto, SimulationStateDto, StepResponseDto } from "../api/types";

export const sun: BodyDto = {
  id: "body-aaaaaaaaaaaa",
  name: "Sun",
  massKg: 1.989e30,
  radiusM: 6.957e8,
  positionM: { x: 0, y: 0, z: 0 },
  velocityMPerS: { x: 0, y: 0, z: 0 },
  colorHex: "#fdb813",
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

/** A scriptable in-memory ApiClient; tests override the methods they care about. */
export function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    health: async () => true,
    getState: async () => state([sun, earth]),
    createBody: async (b) => ({ id: "body-new", ...b }),
    updateBody: async (id, patch) => ({ ...sun, ...patch, id }),
    deleteBody: async () => undefined,
    step: async () => stepResponse([sun, earth], 100),
    reset: async () => state([]),
    getEvents: async () => [],
    ...overrides,
  };
}
