// DTO -> view model mapping. Physical quantities keep their SI names and values; the view model only
// adds derived read-only values (speed). Scene (render) values are produced separately by toSceneBody.
import type { BodyDto, BodyKind, BodyType, DiagnosticsDto, SimulationEventDto, SimulationStateDto, SimulationStatus, Vec3 } from "../api/types";
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
  kind: BodyKind;
  catalogueEntryId: string | null;
  bodyType: BodyType;
  assetKey?: string;
  /** |velocityMPerS| in m/s (derived). */
  speedMPerS: number;
}

export interface SimulationView {
  status: SimulationStatus;
  simulationTimeS: number;
  bodies: BodyView[];
  /** Backend-computed system diagnostics, passed through unchanged (never recomputed in the frontend). */
  diagnostics: DiagnosticsDto | null;
  /** Why diagnostics are unavailable (null when present). */
  diagnosticsIssue: string | null;
  /** Commit counter of the universe this state belongs to (universe-scoped responses only). */
  revision?: number;
}

export interface SceneBody {
  id: string;
  name: string;
  color: string;
  kind: BodyKind;
  bodyType: BodyType;
  assetKey?: string;
  position: ScenePosition;
  /** Display radius in scene units (exaggerated, NOT the physical radius). */
  radius: number;
}

/**
 * Renderer classification of a body. An explicit `bodyType` wins; when the backend does not send one it is derived
 * from `kind` ONLY (a star is "star", anything else "default"), the same rule the backend contract uses. Never from
 * the name, id or catalogue entry.
 */
export function bodyTypeFor(kind: BodyKind, bodyType: BodyType | undefined): BodyType {
  return bodyType ?? (kind === "star" ? "star" : "default");
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
    kind: dto.kind,
    catalogueEntryId: dto.catalogueEntryId,
    bodyType: bodyTypeFor(dto.kind, dto.bodyType),
    ...(dto.assetKey === undefined ? {} : { assetKey: dto.assetKey }),
    speedMPerS: Math.hypot(v.x, v.y, v.z),
  };
}

export function toSimulationView(dto: SimulationStateDto): SimulationView {
  return {
    status: dto.status,
    simulationTimeS: dto.simulationTimeS,
    bodies: dto.bodies.map(toBodyView),
    diagnostics: dto.diagnostics,
    diagnosticsIssue: dto.diagnosticsIssue,
    ...(dto.revision !== undefined ? { revision: dto.revision } : {}),
  };
}

/** What the scene needs of a body: a live BodyView and a recorded history frame both provide it. */
export type DisplayBody = Pick<BodyView, "id" | "name" | "colorHex" | "kind" | "positionM" | "radiusM"> &
  Partial<Pick<BodyView, "bodyType" | "assetKey">>;

export function toSceneBody(body: DisplayBody, t: RenderTransform): SceneBody {
  return {
    id: body.id,
    name: body.name,
    color: body.colorHex,
    kind: body.kind,
    bodyType: bodyTypeFor(body.kind, body.bodyType),
    ...(body.assetKey === undefined ? {} : { assetKey: body.assetKey }),
    position: toScenePosition(body.positionM, t),
    radius: displayRadiusUnits(body.radiusM),
  };
}

export interface EventView {
  id: string;
  type: SimulationEventDto["type"];
  simulationTimeS: number;
  estimatedContactTimeS: number | null;
  bodyIds: string[];
  resultBodyId: string;
  resultMassKg: number;
  relativeSpeedMPerS: number;
  kineticEnergyLostJ: number;
  spinAddedKgM2PerS: Vec3;
}

export function toEventView(dto: SimulationEventDto): EventView {
  return {
    id: dto.id,
    type: dto.type,
    simulationTimeS: dto.simulationTimeS,
    estimatedContactTimeS: dto.estimatedContactTimeS,
    bodyIds: [...dto.bodyIds],
    resultBodyId: dto.resultBodyId,
    resultMassKg: dto.resultMassKg,
    relativeSpeedMPerS: dto.relativeSpeedMPerS,
    kineticEnergyLostJ: dto.kineticEnergyLostJ,
    spinAddedKgM2PerS: { ...dto.spinAddedKgM2PerS },
  };
}

/** Appends events whose ids are not yet known, preserving order. */
export function mergeEvents(existing: EventView[], incoming: EventView[]): EventView[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((e) => e.id));
  const fresh = incoming.filter((e) => !seen.has(e.id));
  return fresh.length ? [...existing, ...fresh] : existing;
}
