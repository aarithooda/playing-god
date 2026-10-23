// Runtime checks for backend responses. A malformed payload becomes an ApiError instead of
// propagating NaN/undefined into the scene.
import { ApiError } from "./errors";
import type {
  BodyDto,
  EventListDto,
  SimulationEventDto,
  SimulationStateDto,
  StepResponseDto,
  Vec3,
} from "./types";

function bad(what: string): never {
  throw new ApiError("invalid-response", `Unexpected response shape: ${what}`);
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) bad(what);
  return v as Record<string, unknown>;
}

function num(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) bad(what);
  return v;
}

function str(v: unknown, what: string): string {
  if (typeof v !== "string") bad(what);
  return v;
}

function vec3(v: unknown, what: string): Vec3 {
  const o = obj(v, what);
  return { x: num(o.x, `${what}.x`), y: num(o.y, `${what}.y`), z: num(o.z, `${what}.z`) };
}

export function parseBodyDto(v: unknown): BodyDto {
  const o = obj(v, "body");
  return {
    id: str(o.id, "body.id"),
    name: str(o.name, "body.name"),
    massKg: num(o.massKg, "body.massKg"),
    radiusM: num(o.radiusM, "body.radiusM"),
    positionM: vec3(o.positionM, "body.positionM"),
    velocityMPerS: vec3(o.velocityMPerS, "body.velocityMPerS"),
    colorHex: str(o.colorHex, "body.colorHex"),
  };
}

export function parseStateDto(v: unknown): SimulationStateDto {
  const o = obj(v, "state");
  const status = o.status;
  if (status !== "paused" && status !== "running") bad("state.status");
  if (!Array.isArray(o.bodies)) bad("state.bodies");
  return {
    status,
    simulationTimeS: num(o.simulationTimeS, "state.simulationTimeS"),
    bodies: (o.bodies as unknown[]).map(parseBodyDto),
  };
}

export function parseEventDto(v: unknown): SimulationEventDto {
  const o = obj(v, "event");
  if (o.type !== "merger") bad(`event.type (${String(o.type)})`);
  if (!Array.isArray(o.bodyIds)) bad("event.bodyIds");
  return {
    id: str(o.id, "event.id"),
    type: "merger",
    simulationTimeS: num(o.simulationTimeS, "event.simulationTimeS"),
    estimatedContactTimeS:
      o.estimatedContactTimeS === null || o.estimatedContactTimeS === undefined
        ? null
        : num(o.estimatedContactTimeS, "event.estimatedContactTimeS"),
    bodyIds: (o.bodyIds as unknown[]).map((b) => str(b, "event.bodyIds[]")),
    resultBodyId: str(o.resultBodyId, "event.resultBodyId"),
    resultMassKg: num(o.resultMassKg, "event.resultMassKg"),
    relativeSpeedMPerS: num(o.relativeSpeedMPerS, "event.relativeSpeedMPerS"),
    kineticEnergyLostJ: num(o.kineticEnergyLostJ, "event.kineticEnergyLostJ"),
    spinAddedKgM2PerS: vec3(o.spinAddedKgM2PerS, "event.spinAddedKgM2PerS"),
  };
}

export function parseEventList(v: unknown): EventListDto {
  const o = obj(v, "events");
  if (!Array.isArray(o.events)) bad("events.events");
  return { events: (o.events as unknown[]).map(parseEventDto) };
}

export function parseStepResponse(v: unknown): StepResponseDto {
  const o = obj(v, "step");
  const state = parseStateDto(v);
  if (!Array.isArray(o.events)) bad("step.events");
  return {
    ...state,
    advancedS: num(o.advancedS, "step.advancedS"),
    events: (o.events as unknown[]).map(parseEventDto),
  };
}
