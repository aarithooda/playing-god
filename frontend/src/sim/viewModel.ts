// DTO -> view model mapping. Physical quantities keep their SI names and values; the view model only
// adds derived read-only values (speed). Scene (render) values are produced separately by toSceneBody.
import type { BodyDto, SimulationEventDto, SimulationStateDto, SimulationStatus, Vec3 } from "../api/types";
import {
  displayRadiusUnits,
  toScenePosition,
  type RenderTransform,
  type ScenePosition,
} from "./renderTransform";

export interface BodyView {
  id: string;
  name: string;
  massKg: number;
  radiusM: number;
  positionM: Vec3;
  velocityMPerS: Vec3;
  colorHex: string;
  /** |velocityMPerS| in m/s (derived). */
  speedMPerS: number;
}

export interface SimulationView {
  status: SimulationStatus;
  simulationTimeS: number;
  bodies: BodyView[];
}

export interface SceneBody {
  id: string;
  name: string;
  color: string;
  position: ScenePosition;
  /** Display radius in scene units (exaggerated, NOT the physical radius). */
  radius: number;
}

export function toBodyView(dto: BodyDto): BodyView {
  const v = dto.velocityMPerS;
  return {
    id: dto.id,
    name: dto.name,
    massKg: dto.massKg,
    radiusM: dto.radiusM,
    positionM: { ...dto.positionM },
    velocityMPerS: { ...v },
    colorHex: dto.colorHex,
    speedMPerS: Math.hypot(v.x, v.y, v.z),
  };
}

export function toSimulationView(dto: SimulationStateDto): SimulationView {
  return {
    status: dto.status,
    simulationTimeS: dto.simulationTimeS,
    bodies: dto.bodies.map(toBodyView),
  };
}

export function toSceneBody(body: BodyView, t: RenderTransform): SceneBody {
  return {
    id: body.id,
    name: body.name,
    color: body.colorHex,
    position: toScenePosition(body.positionM, t),
    radius: displayRadiusUnits(body.radiusM),
  };
}

export interface EventView {
  id: string;
  type: SimulationEventDto["type"];
  simulationTimeS: number;
  bodyIds: string[];
  resultBodyId: string;
  resultMassKg: number;
  relativeSpeedMPerS: number;
  kineticEnergyLostJ: number;
}

export function toEventView(dto: SimulationEventDto): EventView {
  return {
    id: dto.id,
    type: dto.type,
    simulationTimeS: dto.simulationTimeS,
    bodyIds: [...dto.bodyIds],
    resultBodyId: dto.resultBodyId,
    resultMassKg: dto.resultMassKg,
    relativeSpeedMPerS: dto.relativeSpeedMPerS,
    kineticEnergyLostJ: dto.kineticEnergyLostJ,
  };
}

/** Appends events whose ids are not yet known, preserving order. */
export function mergeEvents(existing: EventView[], incoming: EventView[]): EventView[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((e) => e.id));
  const fresh = incoming.filter((e) => !seen.has(e.id));
  return fresh.length ? [...existing, ...fresh] : existing;
}
