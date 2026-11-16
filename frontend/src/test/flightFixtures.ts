// Test-only fixtures of the Space Mission Design types (never imported by production code).
import type { BodyDto, HaltDto, ManeuverDto, MissionDto, MissionPlanDto, OrbitDto, SpacecraftDto } from "../api/types";
import { earth } from "./fixtures";

export const leoOrbit: OrbitDto = {
  referenceBodyId: earth.id, referenceBodyName: "Earth", regime: "bound", radiusM: 6.771e6, altitudeM: 400e3, speedMPerS: 7672.6,
  semiMajorAxisM: 6.771e6, eccentricity: 0, inclinationDeg: 51.6, raanDeg: 0, argPeriapsisDeg: 0, trueAnomalyDeg: 0,
  periapsisRadiusM: 6.771e6, apoapsisRadiusM: 6.771e6, periapsisAltitudeM: 400e3, apoapsisAltitudeM: 400e3, periodS: 5544.9,
  timeToPeriapsisS: 0, timeToApoapsisS: 2772.4, specificEnergyJPerKg: -2.94e7, circularSpeedMPerS: 7672.6, escapeSpeedMPerS: 10850.7,
  sphereOfInfluenceM: null, gravitationalParameterM3PerS2: 3.986e14,
};

export function spacecraftBlock(o: Partial<SpacecraftDto> = {}): SpacecraftDto {
  return {
    dryMassKg: 3000, propellantKg: 12000, propellantCapacityKg: 12000, thrustN: 50000, ispS: 450, massFlowKgPerS: 11.33,
    deltaVRemainingMPerS: 7102.4, thrusting: false, homeBodyId: earth.id, orbit: leoOrbit, ...o,
  };
}

export function craft(o: Partial<BodyDto> = {}): BodyDto {
  return {
    id: "craft-111111111111", name: "Explorer 1", massKg: 15000, radiusM: 5,
    positionM: { x: earth.positionM.x + 6.771e6, y: 0, z: 0 }, velocityMPerS: { x: 0, y: 29780 + 7672.6, z: 0 }, colorHex: "#8fd3ff",
    kind: "spacecraft", catalogueEntryId: null, bodyType: "spacecraft", spacecraft: spacecraftBlock(), ...o,
  };
}

export function maneuver(o: Partial<ManeuverDto> = {}): ManeuverDto {
  return {
    id: "mnv-1", spacecraftId: "craft-111111111111", epochS: 1000, mode: "impulsive", frame: "vnb", referenceBodyId: earth.id,
    progradeMPerS: 100, normalMPerS: 0, radialMPerS: 0, deltaVMPerS: null, deltaVMagnitudeMPerS: 100, label: "Manual node", centered: true,
    missionId: null, role: null, status: "planned", startS: 1000, endS: 1000, plannedPropellantKg: 336, feasible: true, startedAtS: null,
    endedAtS: null, deliveredDeltaVMPerS: null, propellantUsedKg: null, failure: null, ...o,
  };
}

export const plan: MissionPlanDto = {
  originBodyId: earth.id, destinationBodyId: "body-moon", designedAtS: 0,
  model: { method: "n-body shooting", bodiesInFinalFlight: 2, reducedModelForBracketing: false, burnModel: "impulsive", trialFlights: 6, periapsisResidualM: 0.4, planningWallTimeS: 0.6 },
  parkingOrbit: { radiusM: 6.671e6, eccentricity: 0, periodS: 5422, speedMPerS: 7730, planeMismatchDeg: 0 },
  patchedConic: { note: "two-body", departureDeltaVMPerS: 3112, transferTimeS: 430000, hohmannDepartureDeltaVMPerS: 3112, hohmannTransferTimeS: 460000 },
  departure: { epochS: 4745, ignitionS: 4745, cutoffS: 4745, deltaVMPerS: 3115, mode: "impulsive", propellantKg: 7595 },
  arrival: { epochS: 348980, transferTimeS: 344235, periapsisRadiusM: 1837400, periapsisAltitudeM: 100000, periapsisSpeedMPerS: 2449, direction: "prograde", inclinationToDestinationOrbitDeg: 0, hyperbolicExcessSpeedMPerS: 813, sphereOfInfluenceM: 6.9e7 },
  insertion: { epochS: 348980, deltaVMPerS: 815.6, mode: "impulsive", ignitionS: 348980, cutoffS: 348980, propellantKg: 1250 },
  predictedOrbit: { bound: true, semiMajorAxisM: 1837400, eccentricity: 0, periodS: 7067, minAltitudeM: 99990, maxAltitudeM: 100080 },
  totals: { deltaVMPerS: 3930.6, propellantRequiredKg: 8845, propellantAvailableKg: 12000, deltaVAvailableMPerS: 7102, feasible: true },
  trajectoryEndS: 363000,
};

export function mission(o: Partial<MissionDto> = {}): MissionDto {
  return {
    id: "msn-1", name: "Explorer 1 to Moon", spacecraftId: "craft-111111111111", originBodyId: null, destinationBodyId: "body-moon",
    objective: { type: "orbit", periapsisAltitudeM: 100e3, apoapsisAltitudeM: null, direction: "prograde", toleranceM: 50e3 },
    status: "draft", phase: "not designed", reasons: [], committed: false, planRevision: 0, planStale: false, plan: null, maneuverIds: [],
    checks: [], agreement: [], outcome: null, createdAtS: 0, updatedAtS: 0, ...o,
  };
}

export const halt: HaltDto = {
  eventId: "halt-3", reason: "collision", bodyIds: ["craft-111111111111", earth.id], simulationTimeS: 1265.2, relativeSpeedMPerS: 7933,
  refined: true, message: "Explorer 1 and Earth collided at t = 1265 s (relative speed 7933 m/s). The simulation is stopped at the contact.",
};
