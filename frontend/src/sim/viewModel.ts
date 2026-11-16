// DTO -> view model mapping. Physical quantities keep their SI names and values; the view model only
// adds derived read-only values (speed). Scene (render) values are produced separately by toSceneBody.
import type { BodyDto, BodyKind, BodyType, DiagnosticsDto, HaltDto, ManeuverDto, MissionDto, SimulationEventDto, SimulationStateDto, SimulationStatus, SpacecraftDto, Vec3 } from "../api/types";
import {
  DEFAULT_SIZE_MODE,
  SIZE_LAWS,
  minimumRadiusPx,
  physicalRadiusUnits,
  type SizeMode,
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
  /** The body this one orbits (a moon's planet), when the backend says so. Relationship metadata only. */
  primaryId?: string;
  /** |velocityMPerS| in m/s (derived). */
  speedMPerS: number;
  /** Unit quaternion (w, x, y, z) of the body's orientation, only when the backend supplied one (a body with a rotation state). */
  orientation?: readonly [number, number, number, number];
  /** Present only for kind "spacecraft": propulsion and the osculating orbit, exactly as the backend reported them. */
  spacecraft?: SpacecraftDto;
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
  /** Manoeuvre nodes and missions of the universe (empty arrays when it has none). */
  maneuvers: ManeuverDto[];
  missions: MissionDto[];
  /** Set while the simulation is stopped at a contact. */
  halt: HaltDto | null;
}

export interface SceneBody {
  id: string;
  name: string;
  color: string;
  kind: BodyKind;
  bodyType: BodyType;
  assetKey?: string;
  /** The body this one orbits, when known (moons). Used only to size and label; positions are always simulated. */
  primaryId?: string;
  /** True when one snapshot step moves this body too far to ease it linearly (blendSafety.ts). */
  snap?: boolean;
  position: ScenePosition;
  /** Radius in scene units: the physical radius / metersPerUnit (both views). */
  radius: number;
  /** Minimum on-screen radius (CSS px) at the overview in the active view (renderTransform.minimumRadiusPx). */
  visiblePx?: number;
  /** Largest factor the minimum grows by while the camera zooms in (the active view's `maxZoomGrowth`). */
  maxGrowth?: number;
  /** Scene distance to the nearest moon (a planet) or to the primary (a moon): limits the zoom-in growth only. */
  clearance?: number;
  /** Largest minimum (px) in the body's moon system, so planet and moons share one growth factor. */
  systemPx?: number;
  /** A planet only: scene distance to its nearest moon; caps the planet's zoom-in growth below the moon's orbit (bodyVisibility.ts). */
  moonRoom?: number;
  /** Orientation (w, x, y, z) in the simulation frame; absent = the body is drawn exactly as before (D-053). */
  orientation?: readonly [number, number, number, number];
  /** A spacecraft whose engine is burning (backend state); drawn on its marker. */
  thrusting?: boolean;
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
    ...(dto.primaryId === undefined ? {} : { primaryId: dto.primaryId }),
    ...(dto.orientation === undefined || dto.orientation.quaternion.length !== 4
      ? {}
      : { orientation: [dto.orientation.quaternion[0]!, dto.orientation.quaternion[1]!, dto.orientation.quaternion[2]!, dto.orientation.quaternion[3]!] as const }),
    ...(dto.spacecraft === undefined ? {} : { spacecraft: dto.spacecraft }),
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
    maneuvers: dto.spaceflight?.maneuvers ?? [],
    missions: dto.spaceflight?.missions ?? [],
    halt: dto.halt ?? null,
  };
}

/** What the scene needs of a body: a live BodyView and a recorded history frame both provide it. */
export type DisplayBody = Pick<BodyView, "id" | "name" | "colorHex" | "kind" | "positionM" | "radiusM"> &
  Partial<Pick<BodyView, "bodyType" | "assetKey" | "primaryId" | "orientation" | "massKg" | "spacecraft">>;

export function toSceneBody(body: DisplayBody, t: RenderTransform, sizeMode: SizeMode = DEFAULT_SIZE_MODE): SceneBody {
  const law = SIZE_LAWS[sizeMode];
  return {
    id: body.id,
    name: body.name,
    color: body.colorHex,
    kind: body.kind,
    bodyType: bodyTypeFor(body.kind, body.bodyType),
    ...(body.assetKey === undefined ? {} : { assetKey: body.assetKey }),
    ...(body.primaryId === undefined ? {} : { primaryId: body.primaryId }),
    ...(body.orientation === undefined ? {} : { orientation: body.orientation }),
    ...(body.spacecraft?.thrusting ? { thrusting: true } : {}),
    position: toScenePosition(body.positionM, t),
    radius: physicalRadiusUnits(body.radiusM, t),
    // Keep star visibility separate from the planet radius curve: the solar disc must fit inside
    // the compact inner-orbit spacing, while planet sizes still reflect their own radii.
    visiblePx: body.kind === "star"
      ? law.starPx
      : Math.min(law.maxBodyPx, minimumRadiusPx(body.radiusM, sizeMode)),
    // The star keeps a fixed world-space visibility boost, so its projected size follows camera zoom.
    maxGrowth: body.kind === "star" ? 1 : law.maxZoomGrowth,
  };
}

export interface MergerEventView {
  id: string;
  type: "merger";
  simulationTimeS: number;
  estimatedContactTimeS: number | null;
  bodyIds: string[];
  resultBodyId: string;
  resultMassKg: number;
  relativeSpeedMPerS: number;
  kineticEnergyLostJ: number;
  spinAddedKgM2PerS: Vec3;
}

/** A collision-engine event as the UI needs it (all text comes from these backend fields). */
export interface CollisionEventView {
  id: string;
  type: "collision";
  outcome: string;
  simulationTimeS: number;
  estimatedContactTimeS: number | null;
  bodyIds: string[];
  survivingBodyIds: string[];
  createdBodyIds: string[];
  removedBodyIds: string[];
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
  fidelitySummary: Record<string, string>;
}

/** A burn of a spacecraft (an impulse, or the ignition / cutoff of a finite burn). */
export interface ManeuverEventView {
  id: string;
  type: "maneuver";
  simulationTimeS: number;
  bodyIds: string[];
  maneuverId: string;
  phase: "impulse" | "ignition" | "cutoff";
  mode: "impulsive" | "finite";
  referenceBodyId: string | null;
  commandedDeltaVMPerS: number;
  deliveredDeltaVMPerS: number;
  propellantUsedKg: number;
  missionId: string | null;
  label: string;
}

/** Two bodies touched and the simulation stopped there. */
export interface ContactEventView {
  id: string;
  type: "contact";
  simulationTimeS: number;
  estimatedContactTimeS: number | null;
  bodyIds: string[];
  relativeSpeedMPerS: number;
  refined: boolean;
  involvesSpacecraft: boolean;
}

export type EventView = MergerEventView | CollisionEventView | ManeuverEventView | ContactEventView;

/** The body to highlight for an event, if any: a merger's survivor, a collision's first surviving or created body, the spacecraft
 *  of a burn, the first body of a contact. */
export function eventFocusBodyId(event: EventView): string | undefined {
  if (event.type === "merger") return event.resultBodyId;
  if (event.type === "collision") return event.survivingBodyIds[0] ?? event.createdBodyIds[0];
  return event.bodyIds[0];
}

export function toEventView(dto: SimulationEventDto): EventView {
  if (dto.type === "maneuver" || dto.type === "contact") return { ...dto, bodyIds: [...dto.bodyIds] };
  if (dto.type === "collision") {
    return {
      id: dto.id, type: "collision", outcome: dto.outcome, simulationTimeS: dto.simulationTimeS,
      estimatedContactTimeS: dto.estimatedContactTimeS, bodyIds: [...dto.bodyIds], survivingBodyIds: [...dto.survivingBodyIds],
      createdBodyIds: [...dto.createdBodyIds], removedBodyIds: [...dto.removedBodyIds], modelId: dto.modelId, modelVersion: dto.modelVersion,
      impactSpeedMPerS: dto.impactSpeedMPerS, impactAngleDeg: dto.impactAngleDeg, specificImpactEnergyJPerKg: dto.specificImpactEnergyJPerKg,
      largestRemnantMassKg: dto.largestRemnantMassKg, debrisMassKg: dto.debrisMassKg, massResidualRel: dto.massResidualRel,
      momentumResidualRel: dto.momentumResidualRel, warnings: [...dto.warnings], fidelitySummary: { ...dto.fidelitySummary },
    };
  }
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
