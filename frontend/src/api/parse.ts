// Runtime checks for backend responses. A malformed payload becomes an ApiError instead of
// propagating NaN/undefined into the scene.
import { ApiError } from "./errors";
import { DIAGNOSTICS_VERSION } from "./types";
import type {
  ActivationDto,
  BodyDto,
  BodyType,
  CatalogueDto,
  CollisionDetailDto,
  CollisionListDto,
  CollisionRecordDto,
  CollisionSummaryDto,
  DebrisDto,
  EscapedLedgerDto,
  ReplayReportDto,
  VisualEventDto,
  VisualPhaseDto,
  MaterialDto,
  OrientationDto,
  CataloguePropertyDto,
  ComparisonDto,
  ExperimentDto,
  InitialDifferencesDto,
  ModificationDto,
  OrbitLabSystemDto,
  UniverseProvenanceDto,
  Vec3Tuple,
  DiagnosticsDto,
  EventListDto,
  HistoryPageDto,
  PresetSummaryDto,
  CollisionEventDto,
  SimulationEventDto,
  SimulationStateDto,
  SnapshotSummaryDto,
  StepResponseDto,
  UniverseListDto,
  UniverseSummaryDto,
  Vec3,
} from "./types";

const BODY_TYPES: BodyType[] = ["star", "rocky-planet", "gas-giant", "ice-giant", "moon", "asteroid", "default"];

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

/** A finite number or an explicit `null` (undefined quantity). `undefined` (missing key) is rejected. */
function numOrNull(v: unknown, what: string): number | null {
  return v === null ? null : num(v, what);
}

function vec3OrNull(v: unknown, what: string): Vec3 | null {
  return v === null ? null : vec3(v, what);
}

/** Optional collision-engine fields of a body. Absent keys stay absent (older backends, bodies without a material). */
function parseCollisionBodyFields(o: Record<string, unknown>): {
  material?: MaterialDto; spinRadPerS?: Vec3; orientation?: OrientationDto; representation?: "fragment" | "debris-parcel";
  originEventId?: string; debris?: DebrisDto; fragmentClass?: "bound_to_remnant" | "orbiting_system" | "escaping";
} {
  const out: ReturnType<typeof parseCollisionBodyFields> = {};
  if (o.representation !== undefined && o.representation !== null) {
    if (o.representation !== "fragment" && o.representation !== "debris-parcel") bad("body.representation");
    out.representation = o.representation;
  }
  if (o.originEventId !== undefined && o.originEventId !== null) out.originEventId = str(o.originEventId, "body.originEventId");
  if (o.fragmentClass !== undefined && o.fragmentClass !== null) {
    if (o.fragmentClass !== "bound_to_remnant" && o.fragmentClass !== "orbiting_system" && o.fragmentClass !== "escaping") bad("body.fragmentClass");
    out.fragmentClass = o.fragmentClass;
  }
  if (o.debris !== undefined && o.debris !== null) {
    const d = obj(o.debris, "body.debris");
    const sd = d.sizeDistribution;
    let sizeDistribution: DebrisDto["sizeDistribution"] = null;
    if (sd !== undefined && sd !== null) {
      const s = obj(sd, "body.debris.sizeDistribution");
      if (s.kind !== "power-law") bad("body.debris.sizeDistribution.kind");
      sizeDistribution = { kind: "power-law", exponent: num(s.exponent, "body.debris.sizeDistribution.exponent"),
        dMinM: num(s.dMinM, "body.debris.sizeDistribution.dMinM"), dMaxM: num(s.dMaxM, "body.debris.sizeDistribution.dMaxM") };
    }
    out.debris = {
      totalMassKg: num(d.totalMassKg, "body.debris.totalMassKg"), sizeDistribution,
      velocityDispersionMPerS: num(d.velocityDispersionMPerS, "body.debris.velocityDispersionMPerS"),
      materialProfileId: d.materialProfileId === null || d.materialProfileId === undefined ? null : str(d.materialProfileId, "body.debris.materialProfileId"),
      sampleSeed: num(d.sampleSeed, "body.debris.sampleSeed"),
    };
  }
  if (o.material !== undefined && o.material !== null) {
    const m = obj(o.material, "body.material");
    const layers = m.layers;
    if (layers !== undefined && layers !== null && !Array.isArray(layers)) bad("body.material.layers");
    out.material = {
      profileId: str(m.profileId, "body.material.profileId"),
      layers:
        layers === undefined || layers === null
          ? null
          : (layers as unknown[]).map((l, i) => {
              const lo = obj(l, `body.material.layers[${i}]`);
              const phase = lo.phase;
              if (phase !== "solid" && phase !== "molten" && phase !== "partial" && phase !== "gas") bad(`body.material.layers[${i}].phase`);
              return {
                materialId: str(lo.materialId, `body.material.layers[${i}].materialId`),
                massFraction: num(lo.massFraction, `body.material.layers[${i}].massFraction`),
                phase,
                meltFraction: lo.meltFraction == null ? null : num(lo.meltFraction, `body.material.layers[${i}].meltFraction`),
                densityKgPerM3: lo.densityKgPerM3 == null ? null : num(lo.densityKgPerM3, `body.material.layers[${i}].densityKgPerM3`),
              };
            }),
    };
  }
  if (o.spinRadPerS !== undefined && o.spinRadPerS !== null) out.spinRadPerS = vec3(o.spinRadPerS, "body.spinRadPerS");
  if (o.orientation !== undefined && o.orientation !== null) {
    const r = obj(o.orientation, "body.orientation");
    if (!Array.isArray(r.quaternion) || r.quaternion.length !== 4) bad("body.orientation.quaternion");
    const q = r.quaternion.map((c, i) => num(c, `body.orientation.quaternion[${i}]`));
    out.orientation = { quaternion: [q[0], q[1], q[2], q[3]], epochS: num(r.epochS, "body.orientation.epochS") };
  }
  return out;
}

export function parseDiagnosticsDto(v: unknown): DiagnosticsDto {
  const o = obj(v, "diagnostics");
  if (o.version !== DIAGNOSTICS_VERSION) bad(`diagnostics.version (${String(o.version)}, expected ${DIAGNOSTICS_VERSION})`);
  return {
    version: DIAGNOSTICS_VERSION,
    totalMassKg: numOrNull(o.totalMassKg, "diagnostics.totalMassKg"),
    totalMomentumKgMPerS: vec3OrNull(o.totalMomentumKgMPerS, "diagnostics.totalMomentumKgMPerS"),
    kineticEnergyJ: numOrNull(o.kineticEnergyJ, "diagnostics.kineticEnergyJ"),
    potentialEnergyJ: numOrNull(o.potentialEnergyJ, "diagnostics.potentialEnergyJ"),
    angularMomentumAboutOriginKgM2PerS: vec3OrNull(
      o.angularMomentumAboutOriginKgM2PerS,
      "diagnostics.angularMomentumAboutOriginKgM2PerS",
    ),
    bookedSpinKgM2PerS: vec3OrNull(o.bookedSpinKgM2PerS, "diagnostics.bookedSpinKgM2PerS"),
    // additive (Stage 2): absent unless some body has a rotation state; the version stays 1
    ...(o.spinAngularMomentumKgM2PerS === undefined
      ? {}
      : { spinAngularMomentumKgM2PerS: vec3OrNull(o.spinAngularMomentumKgM2PerS, "diagnostics.spinAngularMomentumKgM2PerS") }),
    // additive (Stage 7): the escaped-material ledger, absent until some debris was removed by the escape rule
    ...(o.escaped === undefined || o.escaped === null ? {} : { escaped: parseEscaped(o.escaped) }),
  };
}

/**
 * State-level diagnostics are parsed leniently: a missing, unsupported-version or malformed object yields
 * `diagnostics: null` plus a reason instead of failing the whole state (bodies must stay visible). The strict
 * `parseDiagnosticsDto` is still what accepts a value; an unknown version is never reinterpreted.
 */
function parseDiagnosticsLenient(v: unknown): Pick<SimulationStateDto, "diagnostics" | "diagnosticsIssue"> {
  if (v === undefined || v === null) return { diagnostics: null, diagnosticsIssue: "the response contained no diagnostics" };
  if (typeof v === "object" && !Array.isArray(v)) {
    const version = (v as Record<string, unknown>).version;
    if (version !== DIAGNOSTICS_VERSION) {
      return {
        diagnostics: null,
        diagnosticsIssue: `unsupported diagnostics version (${String(version)}; this client understands ${DIAGNOSTICS_VERSION})`,
      };
    }
  }
  try {
    return { diagnostics: parseDiagnosticsDto(v), diagnosticsIssue: null };
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    return { diagnostics: null, diagnosticsIssue: `the diagnostics were malformed (${e.message})` };
  }
}

/** Optional renderer metadata shared by live bodies and history metadata. Unknown values degrade to "absent". */
function parseRenderMeta(o: Record<string, unknown>, where: string): { bodyType?: BodyType; assetKey?: string; primaryId?: string } {
  const bodyType = typeof o.bodyType === "string" && BODY_TYPES.includes(o.bodyType as BodyType)
    ? (o.bodyType as BodyType)
    : undefined;
  for (const key of ["assetKey", "primaryId"] as const) {
    const raw = o[key];
    if (raw !== undefined && raw !== null && typeof raw !== "string") bad(`${where}.${key}`);
  }
  return {
    ...(bodyType === undefined ? {} : { bodyType }),
    ...(typeof o.assetKey === "string" ? { assetKey: o.assetKey } : {}),
    ...(typeof o.primaryId === "string" ? { primaryId: o.primaryId } : {}),
  };
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
    // Older backends send neither field: a body without a kind is a planet.
    kind: o.kind === "star" ? "star" : "planet",
    catalogueEntryId: typeof o.catalogueEntryId === "string" ? o.catalogueEntryId : null,
    ...parseRenderMeta(o, "body"),
    ...parseCollisionBodyFields(o),
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
    ...parseDiagnosticsLenient(o.diagnostics),
    ...(typeof o.universeId === "string" ? { universeId: o.universeId } : {}),
    ...(typeof o.revision === "number" && Number.isFinite(o.revision) ? { revision: o.revision } : {}),
  };
}

function strArray(v: unknown, what: string): string[] {
  if (!Array.isArray(v)) bad(what);
  return (v as unknown[]).map((x) => str(x, `${what}[]`));
}

function parseCollisionEvent(o: Record<string, unknown>): CollisionEventDto {
  const fidelity = obj(o.fidelitySummary, "event.fidelitySummary");
  return {
    id: str(o.id, "event.id"),
    type: "collision",
    schemaVersion: num(o.schemaVersion, "event.schemaVersion"),
    outcome: str(o.outcome, "event.outcome"),
    simulationTimeS: num(o.simulationTimeS, "event.simulationTimeS"),
    estimatedContactTimeS:
      o.estimatedContactTimeS === null || o.estimatedContactTimeS === undefined
        ? null
        : num(o.estimatedContactTimeS, "event.estimatedContactTimeS"),
    bodyIds: strArray(o.bodyIds, "event.bodyIds"),
    survivingBodyIds: strArray(o.survivingBodyIds, "event.survivingBodyIds"),
    createdBodyIds: strArray(o.createdBodyIds, "event.createdBodyIds"),
    removedBodyIds: strArray(o.removedBodyIds, "event.removedBodyIds"),
    parentEventId: o.parentEventId === null || o.parentEventId === undefined ? null : str(o.parentEventId, "event.parentEventId"),
    rootEventId: str(o.rootEventId, "event.rootEventId"),
    generation: num(o.generation, "event.generation"),
    modelId: str(o.modelId, "event.modelId"),
    modelVersion: str(o.modelVersion, "event.modelVersion"),
    impactSpeedMPerS: num(o.impactSpeedMPerS, "event.impactSpeedMPerS"),
    impactAngleDeg: num(o.impactAngleDeg, "event.impactAngleDeg"),
    specificImpactEnergyJPerKg: num(o.specificImpactEnergyJPerKg, "event.specificImpactEnergyJPerKg"),
    largestRemnantMassKg: num(o.largestRemnantMassKg, "event.largestRemnantMassKg"),
    debrisMassKg: num(o.debrisMassKg, "event.debrisMassKg"),
    massResidualRel: num(o.massResidualRel, "event.massResidualRel"),
    momentumResidualRel: num(o.momentumResidualRel, "event.momentumResidualRel"),
    warnings: strArray(o.warnings, "event.warnings"),
    fidelitySummary: Object.fromEntries(Object.entries(fidelity).map(([k, val]) => [k, str(val, `event.fidelitySummary.${k}`)])),
    hasVisual: o.hasVisual === true,
  };
}

export function parseEventDto(v: unknown): SimulationEventDto {
  const o = obj(v, "event");
  if (o.type === "collision") return parseCollisionEvent(o);
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

function parseEscaped(v: unknown): EscapedLedgerDto {
  const o = obj(v, "diagnostics.escaped");
  const vec = (x: unknown, what: string): Vec3 => {
    const r = vec3OrNull(x, what);
    if (r === null) bad(what);
    return r;
  };
  return {
    massKg: num(o.massKg, "diagnostics.escaped.massKg"),
    momentumKgMPerS: vec(o.momentumKgMPerS, "diagnostics.escaped.momentumKgMPerS"),
    angularMomentumAboutOriginKgM2PerS: vec(o.angularMomentumAboutOriginKgM2PerS, "diagnostics.escaped.angularMomentumAboutOriginKgM2PerS"),
    bodyCount: num(o.bodyCount, "diagnostics.escaped.bodyCount"),
  };
}

function strOrNullStrict(v: unknown, what: string): string | null {
  return v === null ? null : str(v, what);
}

function parseCollisionSummary(v: unknown): CollisionSummaryDto {
  const o = obj(v, "collision");
  return {
    eventId: str(o.eventId, "collision.eventId"), legacyEventId: strOrNullStrict(o.legacyEventId, "collision.legacyEventId"),
    parentEventId: strOrNullStrict(o.parentEventId, "collision.parentEventId"), rootEventId: str(o.rootEventId, "collision.rootEventId"),
    generation: num(o.generation, "collision.generation"), outcome: strOrNullStrict(o.outcome, "collision.outcome"),
    modelId: strOrNullStrict(o.modelId, "collision.modelId"), modelVersion: strOrNullStrict(o.modelVersion, "collision.modelVersion"),
    timeS: num(o.timeS, "collision.timeS"), bodyIds: strArray(o.bodyIds, "collision.bodyIds"), warnings: strArray(o.warnings, "collision.warnings"),
    hasResult: bool(o.hasResult, "collision.hasResult"), detailDropped: bool(o.detailDropped, "collision.detailDropped"),
    inputDigest: str(o.inputDigest, "collision.inputDigest"), resultDigest: str(o.resultDigest, "collision.resultDigest"),
  };
}

export function parseCollisionList(v: unknown): CollisionListDto {
  const o = obj(v, "collisions");
  if (!Array.isArray(o.records)) bad("collisions.records");
  return {
    total: num(o.total, "collisions.total"), offset: num(o.offset, "collisions.offset"), limit: num(o.limit, "collisions.limit"),
    maxRecords: num(o.maxRecords, "collisions.maxRecords"), records: (o.records as unknown[]).map(parseCollisionSummary),
  };
}

function parseCollisionRecord(v: unknown): CollisionRecordDto {
  const o = obj(v, "record");
  const input = obj(o.input, "record.input");
  const impact = obj(input.impact, "record.input.impact");
  const target = obj(impact.target, "record.input.impact.target");
  const projectile = obj(impact.projectile, "record.input.impact.projectile");
  const profileId = (b: Record<string, unknown>, what: string): string | null =>
    b.materialProfile === null || b.materialProfile === undefined ? null : str(obj(b.materialProfile, what).id, `${what}.id`);
  const fid = obj(o.fidelity, "record.fidelity");
  const fidelity: Record<string, string> = {};
  for (const [k, label] of Object.entries(fid)) fidelity[k] = str(label, `record.fidelity.${k}`);
  let outcome: CollisionRecordDto["outcome"] = null;
  if (o.outcomeSpec !== null && o.outcomeSpec !== undefined) {
    const s = obj(o.outcomeSpec, "record.outcomeSpec");
    const params = obj(s.parameters, "record.outcomeSpec.parameters");
    outcome = {
      outcome: str(s.outcome, "record.outcomeSpec.outcome"), modelId: str(s.modelId, "record.outcomeSpec.modelId"),
      modelVersion: str(s.modelVersion, "record.outcomeSpec.modelVersion"), regimeReasons: strArray(s.regimeReasons, "record.outcomeSpec.regimeReasons"),
      parameters: Object.entries(params).map(([name, p]) => {
        const po = obj(p, `record.outcomeSpec.parameters.${name}`);
        return { name, value: num(po.value, `${name}.value`), unit: str(po.unit, `${name}.unit`), source: str(po.source, `${name}.source`) };
      }),
      debrisMassKg: num(s.debrisMassKg, "record.outcomeSpec.debrisMassKg"),
    };
  }
  let result: CollisionRecordDto["result"] = null;
  if (o.result !== null && o.result !== undefined) {
    const r = obj(o.result, "record.result");
    const c = obj(r.conservation, "record.result.conservation");
    const e = obj(c.energy, "record.result.conservation.energy");
    const ids = (posts: unknown, what: string): string[] => {
      if (!Array.isArray(posts)) bad(what);
      return (posts as unknown[]).map((p) => str(obj(p, `${what}[]`).id, `${what}[].id`));
    };
    const ledger = obj(r.massLedger, "record.result.massLedger");
    const massLedger: Record<string, number> = {};
    for (const [k, x] of Object.entries(ledger)) massLedger[k] = num(x, `record.result.massLedger.${k}`);
    result = {
      removedBodyIds: strArray(r.removedBodyIds, "record.result.removedBodyIds"), survivingBodyIds: ids(r.transformed, "record.result.transformed"),
      createdBodyIds: ids(r.created, "record.result.created"), parcelIds: ids(r.debrisParcels, "record.result.debrisParcels"), massLedger,
      conservation: {
        massResidualRel: num(c.massResidualRel, "conservation.massResidualRel"), momentumResidualRel: num(c.momentumResidualRel, "conservation.momentumResidualRel"),
        angularMomentumResidualRel: numOrNull(c.angularMomentumResidualRel, "conservation.angularMomentumResidualRel"),
        angularMomentumUnmodelled: strOrNullStrict(c.angularMomentumUnmodelled, "conservation.angularMomentumUnmodelled"),
        dissipatedJ: num(e.dissipatedJ, "conservation.energy.dissipatedJ"), dissipatedNonNegative: bool(e.dissipatedNonNegative, "conservation.energy.dissipatedNonNegative"),
        withinTolerance: bool(c.withinTolerance, "conservation.withinTolerance"),
      },
    };
  }
  return {
    eventId: str(o.eventId, "record.eventId"), legacyEventId: strOrNullStrict(o.legacyEventId, "record.legacyEventId"),
    parentEventId: strOrNullStrict(o.parentEventId, "record.parentEventId"), rootEventId: str(o.rootEventId, "record.rootEventId"),
    generation: num(o.generation, "record.generation"), selectionReasons: strArray(o.selectionReasons, "record.selectionReasons"),
    warnings: strArray(o.warnings, "record.warnings"), fidelity, inputDigest: str(o.inputDigest, "record.inputDigest"),
    resultDigest: str(o.resultDigest, "record.resultDigest"),
    impact: {
      detectionTimeS: num(impact.detectionTimeS, "impact.detectionTimeS"), targetId: str(target.id, "impact.target.id"),
      projectileId: str(projectile.id, "impact.projectile.id"), targetMassKg: num(target.massKg, "impact.target.massKg"),
      projectileMassKg: num(projectile.massKg, "impact.projectile.massKg"), impactSpeedMPerS: num(impact.impactSpeedMPerS, "impact.impactSpeedMPerS"),
      impactAngleDeg: num(impact.impactAngleDeg, "impact.impactAngleDeg"),
      specificImpactEnergyJPerKg: num(impact.specificImpactEnergyJPerKg, "impact.specificImpactEnergyJPerKg"),
      contactPointM: vec3(impact.contactPointM, "impact.contactPointM"), targetMaterialId: profileId(target, "impact.target.materialProfile"),
      projectileMaterialId: profileId(projectile, "impact.projectile.materialProfile"),
    },
    outcome, result,
  };
}

export function parseCollisionDetail(v: unknown): CollisionDetailDto {
  const o = obj(v, "collision detail");
  if (!Array.isArray(o.products)) bad("detail.products");
  return {
    record: parseCollisionRecord(o.record), childEventIds: strArray(o.childEventIds, "detail.childEventIds"),
    products: (o.products as unknown[]).map((p, i) => {
      const po = obj(p, `detail.products[${i}]`);
      const cls = po.fragmentClass;
      if (cls !== null && cls !== "bound_to_remnant" && cls !== "orbiting_system" && cls !== "escaping") bad(`detail.products[${i}].fragmentClass`);
      return {
        bodyId: str(po.bodyId, "product.bodyId"), representation: str(po.representation, "product.representation"),
        massKgAtEvent: num(po.massKgAtEvent, "product.massKgAtEvent"), exists: bool(po.exists, "product.exists"), fragmentClass: cls,
        massKgNow: numOrNull(po.massKgNow, "product.massKgNow"),
      };
    }),
    escapedLedger: o.escapedLedger === null || o.escapedLedger === undefined ? null : parseEscaped(o.escapedLedger),
    note: str(o.note, "detail.note"),
  };
}

const PHASE_NAMES = ["contact", "flash", "cratering", "ejecta", "separation", "cloud-expansion", "aftermath"] as const;

export function parseVisualEvent(v: unknown): VisualEventDto {
  const o = obj(v, "visual");
  const site = obj(o.impactSite, "visual.impactSite");
  if (!Array.isArray(o.phases)) bad("visual.phases");
  if (!Array.isArray(o.visualOnly)) bad("visual.visualOnly");
  if (!Array.isArray(o.ejectaSources)) bad("visual.ejectaSources");
  const phases = (o.phases as unknown[]).map((p, i) => {
    const po = obj(p, `visual.phases[${i}]`);
    const name = po.name;
    if (!PHASE_NAMES.includes(name as (typeof PHASE_NAMES)[number])) bad(`visual.phases[${i}].name`);
    if (po.basis !== "simulation-time" && po.basis !== "visual-wall-clock") bad(`visual.phases[${i}].basis`);
    const out: VisualPhaseDto = {
      name: name as VisualPhaseDto["name"], startS: num(po.startS, "phase.startS"),
      endS: po.endS === null || po.endS === undefined ? null : num(po.endS, "phase.endS"), basis: po.basis,
    };
    if (po.durationWallS !== undefined && po.durationWallS !== null) out.durationWallS = num(po.durationWallS, "phase.durationWallS");
    return out;
  });
  const appearance = obj(o.materialAppearance, "visual.materialAppearance");
  const materialAppearance: Record<string, string> = {};
  for (const [k, a] of Object.entries(appearance)) materialAppearance[k] = str(a, `visual.materialAppearance.${k}`);
  let cloud: VisualEventDto["cloud"] = null;
  if (o.cloud !== null && o.cloud !== undefined) {
    const c = obj(o.cloud, "visual.cloud");
    cloud = { initialRadiusM: num(c.initialRadiusM, "cloud.initialRadiusM"), expansionSpeedMPerS: num(c.expansionSpeedMPerS, "cloud.expansionSpeedMPerS"),
      materialAppearance: str(c.materialAppearance, "cloud.materialAppearance") };
  }
  return {
    eventId: str(o.eventId, "visual.eventId"), outcome: str(o.outcome, "visual.outcome"), timeS: num(o.timeS, "visual.timeS"),
    impactSite: { bodyId: str(site.bodyId, "site.bodyId"), centerLocal: vec3(site.centerLocal, "site.centerLocal"),
      centerWorldAtContactM: vec3(site.centerWorldAtContactM, "site.centerWorldAtContactM"), normalWorld: vec3(site.normalWorld, "site.normalWorld") },
    phases, ejectaSourceCount: (o.ejectaSources as unknown[]).length, fragmentBodyIds: strArray(o.fragmentBodyIds, "visual.fragmentBodyIds"),
    debrisParcelIds: strArray(o.debrisParcelIds, "visual.debrisParcelIds"), cloud,
    visualOnly: (o.visualOnly as unknown[]).map((e, i) => {
      const eo = obj(e, `visual.visualOnly[${i}]`);
      if (eo.kind !== "flash" && eo.kind !== "glow" && eo.kind !== "shock-indicator") bad(`visual.visualOnly[${i}].kind`);
      if ("massKg" in eo || "mass" in eo) bad(`visual.visualOnly[${i}] (a visual-only effect has no mass)`);
      return { kind: eo.kind, intensity: num(eo.intensity, "effect.intensity"), lifetimeWallS: num(eo.lifetimeWallS, "effect.lifetimeWallS") };
    }),
    materialAppearance, fidelityNotes: strArray(o.fidelityNotes, "visual.fidelityNotes"),
  };
}

export function parseReplayReport(v: unknown): ReplayReportDto {
  const o = obj(v, "replay");
  if (!Array.isArray(o.checks)) bad("replay.checks");
  return {
    eventId: str(o.eventId, "replay.eventId"), reproduced: bool(o.reproduced, "replay.reproduced"),
    checks: (o.checks as unknown[]).map((c, i) => {
      const co = obj(c, `replay.checks[${i}]`);
      if (co.ok !== null && typeof co.ok !== "boolean") bad(`replay.checks[${i}].ok`);
      return { name: str(co.name, "check.name"), ok: co.ok as boolean | null, detail: str(co.detail, "check.detail") };
    }),
    recordedResultDigest: str(o.recordedResultDigest, "replay.recordedResultDigest"), replayedResultDigest: str(o.replayedResultDigest, "replay.replayedResultDigest"),
    differingFields: strArray(o.differingFields, "replay.differingFields"), mutatesState: bool(o.mutatesState, "replay.mutatesState"),
  };
}

export function parseStepResponse(v: unknown): StepResponseDto {
  const o = obj(v, "step");
  const state = parseStateDto(v);
  if (!Array.isArray(o.events)) bad("step.events");
  let warnings: string[] | undefined;
  if (o.warnings !== undefined && o.warnings !== null) {
    if (!Array.isArray(o.warnings)) bad("step.warnings");
    warnings = (o.warnings as unknown[]).map((w) => str(w, "step.warnings[]"));
  }
  return {
    ...state,
    advancedS: num(o.advancedS, "step.advancedS"),
    events: (o.events as unknown[]).map(parseEventDto),
    ...(warnings && warnings.length ? { warnings } : {}),
  };
}

// ---------- Simulation Lab ----------
function bool(v: unknown, what: string): boolean {
  if (typeof v !== "boolean") bad(what);
  return v;
}

function strOrNull(v: unknown, what: string): string | null {
  return v === null || v === undefined ? null : str(v, what);
}

export function parseUniverseSummary(v: unknown): UniverseSummaryDto {
  const o = obj(v, "universe");
  const role = o.role;
  if (role !== "sandbox" && role !== "preset" && role !== "baseline" && role !== "modified") bad("universe.role");
  const lf = o.lastFailure;
  return {
    id: str(o.id, "universe.id"),
    name: str(o.name, "universe.name"),
    role,
    presetId: strOrNull(o.presetId, "universe.presetId"),
    experimentId: strOrNull(o.experimentId, "universe.experimentId"),
    active: bool(o.active, "universe.active"),
    simulationTimeS: num(o.simulationTimeS, "universe.simulationTimeS"),
    bodyCount: num(o.bodyCount, "universe.bodyCount"),
    revision: num(o.revision, "universe.revision"),
    status: o.status === "mutating" ? "mutating" : "idle",
    lastFailure:
      lf === null || lf === undefined
        ? null
        : (() => {
            const f = obj(lf, "universe.lastFailure");
            return {
              kind: str(f.kind, "lastFailure.kind"),
              message: str(f.message, "lastFailure.message"),
              atSimulationTimeS: num(f.atSimulationTimeS, "lastFailure.atSimulationTimeS"),
              atIso: str(f.atIso, "lastFailure.atIso"),
            };
          })(),
    createdAtIso: str(o.createdAtIso, "universe.createdAtIso"),
    epochLabel: strOrNull(o.epochLabel, "universe.epochLabel"),
    historyMode: o.historyMode === "grid" ? "grid" : "step",
  };
}

export function parseUniverseList(v: unknown): UniverseListDto {
  const o = obj(v, "universes");
  if (!Array.isArray(o.universes)) bad("universes.universes");
  return {
    universes: (o.universes as unknown[]).map(parseUniverseSummary),
    activeUniverseId: str(o.activeUniverseId, "universes.activeUniverseId"),
    activationEpoch: num(o.activationEpoch, "universes.activationEpoch"),
  };
}

export function parseActivation(v: unknown): ActivationDto {
  const o = obj(v, "activation");
  return {
    activeUniverseId: str(o.activeUniverseId, "activation.activeUniverseId"),
    activationEpoch: num(o.activationEpoch, "activation.activationEpoch"),
  };
}

export function parsePresetList(v: unknown): PresetSummaryDto[] {
  const o = obj(v, "presets");
  if (!Array.isArray(o.presets)) bad("presets.presets");
  return (o.presets as unknown[]).map((p) => {
    const q = obj(p, "preset");
    return {
      id: str(q.id, "preset.id"),
      name: str(q.name, "preset.name"),
      description: typeof q.description === "string" ? q.description : "",
      available: bool(q.available, "preset.available"),
      unavailableReason: strOrNull(q.unavailableReason, "preset.unavailableReason"),
      bodyCount: typeof q.bodyCount === "number" ? q.bodyCount : 0,
      epochLabel: strOrNull(q.epochLabel, "preset.epochLabel"),
    };
  });
}

export function parseSnapshotSummary(v: unknown): SnapshotSummaryDto {
  const o = obj(v, "snapshot");
  return {
    id: str(o.id, "snapshot.id"),
    name: str(o.name, "snapshot.name"),
    createdAtIso: str(o.createdAtIso, "snapshot.createdAtIso"),
    simulationTimeS: num(o.simulationTimeS, "snapshot.simulationTimeS"),
    bodyCount: num(o.bodyCount, "snapshot.bodyCount"),
    revision: num(o.revision, "snapshot.revision"),
    controlled: bool(o.controlled, "snapshot.controlled"),
  };
}

export function parseSnapshotList(v: unknown): SnapshotSummaryDto[] {
  const o = obj(v, "snapshots");
  if (!Array.isArray(o.snapshots)) bad("snapshots.snapshots");
  return (o.snapshots as unknown[]).map(parseSnapshotSummary);
}

export function parseHistoryPage(v: unknown): HistoryPageDto {
  const o = obj(v, "history");
  if (o.mode !== "grid" && o.mode !== "step") bad("history.mode");
  if (!Array.isArray(o.samples)) bad("history.samples");
  const bodies: HistoryPageDto["bodies"] = {};
  for (const [id, m] of Object.entries(obj(o.bodies, "history.bodies"))) {
    const b = obj(m, "history.bodies[]");
    bodies[id] = {
      name: str(b.name, "history.body.name"),
      colorHex: str(b.colorHex, "history.body.colorHex"),
      radiusM: num(b.radiusM, "history.body.radiusM"),
      kind: str(b.kind, "history.body.kind"),
      ...parseRenderMeta(b, "history.body"),
    };
  }
  return {
    universeId: str(o.universeId, "history.universeId"),
    mode: o.mode,
    sampleIntervalS:
      o.sampleIntervalS === null || o.sampleIntervalS === undefined ? null : num(o.sampleIntervalS, "history.sampleIntervalS"),
    generation: num(o.generation, "history.generation"),
    firstIndex: num(o.firstIndex, "history.firstIndex"),
    nextIndex: num(o.nextIndex, "history.nextIndex"),
    droppedBefore: num(o.droppedBefore, "history.droppedBefore"),
    truncated: bool(o.truncated, "history.truncated"),
    samples: (o.samples as unknown[]).map((s) => {
      const q = obj(s, "history.sample");
      const positions: Record<string, [number, number, number]> = {};
      for (const [id, p] of Object.entries(obj(q.positionsM, "history.sample.positionsM"))) {
        if (!Array.isArray(p) || p.length !== 3) bad("history.sample.positionsM[]");
        positions[id] = [num(p[0], "x"), num(p[1], "y"), num(p[2], "z")];
      }
      return {
        index: num(q.index, "sample.index"),
        simulationTimeS: num(q.simulationTimeS, "sample.simulationTimeS"),
        segment: num(q.segment, "sample.segment"),
        positionsM: positions,
      };
    }),
    bodies,
  };
}

// ---------- Catalogue ----------
function parseCatalogueProperty(v: unknown, what: string): CataloguePropertyDto {
  const o = obj(v, what);
  const basis = o.basis;
  if (basis !== "measured" && basis !== "nominal" && basis !== "estimated" && basis !== "illustrative") bad(`${what}.basis`);
  const u = o.uncertainty;
  let uncertainty: CataloguePropertyDto["uncertainty"] = null;
  if (u !== null && u !== undefined) {
    const q = obj(u, `${what}.uncertainty`);
    if (Array.isArray(q.range)) uncertainty = { range: [num(q.range[0], `${what}.range[0]`), num(q.range[1], `${what}.range[1]`)] };
    else uncertainty = { minus: num(q.minus, `${what}.minus`), plus: num(q.plus, `${what}.plus`) };
  }
  if (!Array.isArray(o.sources)) bad(`${what}.sources`);
  return {
    value: num(o.value, `${what}.value`),
    uncertainty,
    basis,
    sourceValue: str(o.sourceValue, `${what}.sourceValue`),
    conversion: str(o.conversion, `${what}.conversion`),
    sources: (o.sources as unknown[]).map((s) => {
      const q = obj(s, `${what}.source`);
      return { citation: str(q.citation, "source.citation"), url: str(q.url, "source.url"), retrieved: str(q.retrieved, "source.retrieved") };
    }),
    ...(typeof o.note === "string" ? { note: o.note } : {}),
  };
}

export function parseCatalogue(v: unknown): CatalogueDto {
  const o = obj(v, "catalogue");
  if (!Array.isArray(o.entries)) bad("catalogue.entries");
  return {
    notes: Array.isArray(o.notes) ? (o.notes as unknown[]).map((n) => str(n, "catalogue.notes[]")) : [],
    entries: (o.entries as unknown[]).map((e) => {
      const q = obj(e, "catalogue.entry");
      const props = obj(q.properties, "catalogue.entry.properties");
      const visual = obj(q.visual, "catalogue.entry.visual");
      if (q.kind !== "star" && q.kind !== "planet") bad("catalogue.entry.kind");
      return {
        id: str(q.id, "entry.id"),
        name: str(q.name, "entry.name"),
        kind: q.kind,
        properties: {
          massKg: parseCatalogueProperty(props.massKg, "entry.massKg"),
          radiusM: parseCatalogueProperty(props.radiusM, "entry.radiusM"),
        },
        visual: { colorHex: str(visual.colorHex, "entry.colorHex"), note: str(visual.note, "entry.visual.note") },
        notes: typeof q.notes === "string" ? q.notes : "",
      };
    }),
  };
}

// ---------- Orbit Lab ----------
function tuple3(v: unknown, what: string): Vec3Tuple {
  if (!Array.isArray(v) || v.length !== 3) bad(what);
  return [num(v[0], `${what}[0]`), num(v[1], `${what}[1]`), num(v[2], `${what}[2]`)];
}

function numArray(v: unknown, what: string): number[] {
  if (!Array.isArray(v)) bad(what);
  return (v as unknown[]).map((x, i) => num(x, `${what}[${i}]`));
}

export function parseOrbitLabSystem(v: unknown): OrbitLabSystemDto {
  const o = obj(v, "system");
  return {
    id: str(o.id, "system.id"),
    name: str(o.name, "system.name"),
    presetId: str(o.presetId, "system.presetId"),
    bodyIds: (Array.isArray(o.bodyIds) ? o.bodyIds : bad("system.bodyIds")).map((b: unknown) => str(b, "system.bodyIds[]")),
    selectableBodyIds: (Array.isArray(o.selectableBodyIds) ? o.selectableBodyIds : bad("system.selectableBodyIds")).map((b: unknown) => str(b, "system.selectableBodyIds[]")),
    speedFactors: numArray(o.speedFactors, "system.speedFactors"),
    observationWindowS: num(o.observationWindowS, "system.observationWindowS"),
    sampleIntervalS: num(o.sampleIntervalS, "system.sampleIntervalS"),
    modelNote: str(o.modelNote, "system.modelNote"),
    description: typeof o.description === "string" ? o.description : "",
  };
}

export function parseOrbitLabSystems(v: unknown): OrbitLabSystemDto[] {
  const o = obj(v, "systems");
  if (!Array.isArray(o.systems)) bad("systems.systems");
  return (o.systems as unknown[]).map(parseOrbitLabSystem);
}

function parseModification(v: unknown): ModificationDto | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, "modification");
  return {
    baselineUniverseId: str(o.baselineUniverseId, "modification.baselineUniverseId"),
    baselineInitialDigest: str(o.baselineInitialDigest, "modification.baselineInitialDigest"),
    bodyId: str(o.bodyId, "modification.bodyId"),
    originalVelocityMPerS: tuple3(o.originalVelocityMPerS, "modification.originalVelocityMPerS"),
    modifiedVelocityMPerS: tuple3(o.modifiedVelocityMPerS, "modification.modifiedVelocityMPerS"),
    speedFactor: num(o.speedFactor, "modification.speedFactor"),
    units: str(o.units, "modification.units"),
    createdAtIso: str(o.createdAtIso, "modification.createdAtIso"),
  };
}

export function parseExperiment(v: unknown): ExperimentDto {
  const o = obj(v, "experiment");
  const ini = obj(o.initialState, "experiment.initialState");
  if (!Array.isArray(ini.bodies)) bad("experiment.initialState.bodies");
  return {
    id: str(o.id, "experiment.id"),
    systemId: str(o.systemId, "experiment.systemId"),
    name: str(o.name, "experiment.name"),
    createdAtIso: str(o.createdAtIso, "experiment.createdAtIso"),
    baselineUniverseId: str(o.baselineUniverseId, "experiment.baselineUniverseId"),
    modifiedUniverseId: strOrNull(o.modifiedUniverseId, "experiment.modifiedUniverseId"),
    system: parseOrbitLabSystem(o.system),
    initialState: {
      epoch: strOrNull(ini.epoch, "initialState.epoch"),
      jdTdb: ini.jdTdb === null || ini.jdTdb === undefined ? null : num(ini.jdTdb, "initialState.jdTdb"),
      frame: strOrNull(ini.frame, "initialState.frame"),
      origin: strOrNull(ini.origin, "initialState.origin"),
      units: strOrNull(ini.units, "initialState.units"),
      digest: str(ini.digest, "initialState.digest"),
      bodies: (ini.bodies as unknown[]).map((b) => {
        const q = obj(b, "initialState.body");
        return {
          id: str(q.id, "body.id"),
          name: str(q.name, "body.name"),
          massKg: num(q.massKg, "body.massKg"),
          radiusM: num(q.radiusM, "body.radiusM"),
          positionM: tuple3(q.positionM, "body.positionM"),
          velocityMPerS: tuple3(q.velocityMPerS, "body.velocityMPerS"),
          speedMPerS: num(q.speedMPerS, "body.speedMPerS"),
        };
      }),
      modelNote: str(ini.modelNote, "initialState.modelNote"),
    },
    modification: parseModification(o.modification),
  };
}

export function parseExperimentList(v: unknown): ExperimentDto[] {
  const o = obj(v, "experiments");
  if (!Array.isArray(o.experiments)) bad("experiments.experiments");
  return (o.experiments as unknown[]).map(parseExperiment);
}

export function parseInitialDifferences(v: unknown): InitialDifferencesDto {
  const o = obj(v, "initial-differences");
  if (!Array.isArray(o.differences)) bad("differences");
  return {
    experimentId: str(o.experimentId, "experimentId"),
    baselineUniverseId: str(o.baselineUniverseId, "baselineUniverseId"),
    modifiedUniverseId: str(o.modifiedUniverseId, "modifiedUniverseId"),
    differences: (o.differences as unknown[]).map((d) => {
      const q = obj(d, "difference");
      return { bodyId: str(q.bodyId, "difference.bodyId"), field: str(q.field, "difference.field"), baseline: q.baseline, modified: q.modified };
    }),
    configEqual: bool(o.configEqual, "configEqual"),
  };
}

export function parseComparison(v: unknown): ComparisonDto {
  const o = obj(v, "comparison");
  const run = (r: unknown, what: string) => {
    const q = obj(r, what);
    return { universeId: str(q.universeId, `${what}.universeId`), simulationTimeS: num(q.simulationTimeS, `${what}.simulationTimeS`), sampleCount: num(q.sampleCount, `${what}.sampleCount`) };
  };
  const points = (p: unknown, what: string): Vec3Tuple[] => {
    if (!Array.isArray(p)) bad(what);
    return (p as unknown[]).map((x, i) => tuple3(x, `${what}[${i}]`));
  };
  const times = numArray(o.timesS, "comparison.timesS");
  const baselinePositionM = points(o.baselinePositionM, "comparison.baselinePositionM");
  const modifiedPositionM = points(o.modifiedPositionM, "comparison.modifiedPositionM");
  const separationM = numArray(o.separationM, "comparison.separationM");
  if (![baselinePositionM.length, modifiedPositionM.length, separationM.length].every((n) => n === times.length)) {
    bad("comparison arrays have different lengths");
  }
  if (!Array.isArray(o.issues)) bad("comparison.issues");
  return {
    bodyId: str(o.bodyId, "comparison.bodyId"),
    sampleIntervalS: num(o.sampleIntervalS, "comparison.sampleIntervalS"),
    observationWindowS: num(o.observationWindowS, "comparison.observationWindowS"),
    baseline: run(o.baseline, "comparison.baseline"),
    modified: o.modified === null || o.modified === undefined ? null : run(o.modified, "comparison.modified"),
    commonSampleCount: num(o.commonSampleCount, "comparison.commonSampleCount"),
    timesS: times,
    baselinePositionM,
    modifiedPositionM,
    separationM,
    windowCompleteBoth: bool(o.windowCompleteBoth, "comparison.windowCompleteBoth"),
    complete: bool(o.complete, "comparison.complete"),
    issues: (o.issues as unknown[]).map((i) => str(i, "comparison.issues[]")),
    timesDiffer: bool(o.timesDiffer, "comparison.timesDiffer"),
    comparedUpToS: o.comparedUpToS === null || o.comparedUpToS === undefined ? null : num(o.comparedUpToS, "comparison.comparedUpToS"),
    controlled: bool(o.controlled, "comparison.controlled"),
    firstUncontrolledAtS: o.firstUncontrolledAtS === null || o.firstUncontrolledAtS === undefined ? null : num(o.firstUncontrolledAtS, "comparison.firstUncontrolledAtS"),
    modification: parseModification(o.modification),
  };
}

export function parseProvenance(v: unknown): UniverseProvenanceDto {
  const o = obj(v, "provenance");
  return {
    sourceKind: str(o.sourceKind, "provenance.sourceKind"),
    controlled: bool(o.controlled, "provenance.controlled"),
    firstUncontrolledAtS: o.firstUncontrolledAtS === null || o.firstUncontrolledAtS === undefined ? null : num(o.firstUncontrolledAtS, "provenance.firstUncontrolledAtS"),
    audit: Array.isArray(o.audit)
      ? (o.audit as unknown[]).map((a) => {
          const q = obj(a, "audit");
          return {
            atSimulationTimeS: num(q.atSimulationTimeS, "audit.atSimulationTimeS"),
            op: str(q.op, "audit.op"),
            bodyId: str(q.bodyId, "audit.bodyId"),
            physical: bool(q.physical, "audit.physical"),
            changes: typeof q.changes === "object" && q.changes !== null ? (q.changes as Record<string, unknown>) : {},
          };
        })
      : [],
  };
}
