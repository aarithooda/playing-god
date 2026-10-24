import { describe, expect, it } from "vitest";
import { parseBodyDto, parseDiagnosticsDto, parseHistoryPage, parseStateDto, parseStepResponse } from "./parse";
import { ApiError } from "./errors";
import { diagnostics, earth, mergerEvent, state, stepResponse, sun } from "../test/fixtures";

const allNull = {
  version: 1,
  totalMassKg: null,
  totalMomentumKgMPerS: null,
  kineticEnergyJ: null,
  potentialEnergyJ: null,
  angularMomentumAboutOriginKgM2PerS: null,
  bookedSpinKgM2PerS: null,
};

function rejects(fn: () => unknown, fragment: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).kind).toBe("invalid-response");
    expect((e as ApiError).message).toContain(fragment);
    return;
  }
  throw new Error(`expected a rejection mentioning "${fragment}"`);
}

describe("parseDiagnosticsDto", () => {
  it("accepts a normal diagnostics object unchanged", () => {
    expect(parseDiagnosticsDto(diagnostics)).toEqual(diagnostics);
  });

  it("accepts an empty-system object with zeros (zero is a value, not undefined)", () => {
    const zero = { x: 0, y: 0, z: 0 };
    const empty = { ...diagnostics, totalMassKg: 0, totalMomentumKgMPerS: zero, kineticEnergyJ: 0, potentialEnergyJ: 0 };
    expect(parseDiagnosticsDto(empty)).toEqual(empty);
  });

  it("keeps explicit nulls as null for scalars and for whole vectors", () => {
    expect(parseDiagnosticsDto(allNull)).toEqual(allNull);
    const onlyPotentialUndefined = { ...diagnostics, potentialEnergyJ: null };
    expect(parseDiagnosticsDto(onlyPotentialUndefined).potentialEnergyJ).toBeNull();
    expect(parseDiagnosticsDto(onlyPotentialUndefined).kineticEnergyJ).toBe(diagnostics.kineticEnergyJ);
  });

  it("rejects missing or non-object diagnostics", () => {
    rejects(() => parseDiagnosticsDto(undefined), "diagnostics");
    rejects(() => parseDiagnosticsDto(null), "diagnostics");
    rejects(() => parseDiagnosticsDto([]), "diagnostics");
    rejects(() => parseDiagnosticsDto("x"), "diagnostics");
  });

  it("rejects an unsupported or missing schema version", () => {
    rejects(() => parseDiagnosticsDto({ ...diagnostics, version: 2 }), "diagnostics.version");
    rejects(() => parseDiagnosticsDto({ ...diagnostics, version: "1" }), "diagnostics.version");
    const { version: _v, ...noVersion } = diagnostics;
    rejects(() => parseDiagnosticsDto(noVersion), "diagnostics.version");
  });

  it("rejects a missing key (absent is not the same as an explicit null)", () => {
    const { potentialEnergyJ: _p, ...noPotential } = diagnostics;
    rejects(() => parseDiagnosticsDto(noPotential), "diagnostics.potentialEnergyJ");
    const { bookedSpinKgM2PerS: _s, ...noSpin } = diagnostics;
    rejects(() => parseDiagnosticsDto(noSpin), "diagnostics.bookedSpinKgM2PerS");
  });

  it("rejects malformed field types", () => {
    rejects(() => parseDiagnosticsDto({ ...diagnostics, totalMassKg: "3" }), "diagnostics.totalMassKg");
    rejects(() => parseDiagnosticsDto({ ...diagnostics, kineticEnergyJ: true }), "diagnostics.kineticEnergyJ");
    rejects(() => parseDiagnosticsDto({ ...diagnostics, totalMomentumKgMPerS: [1, 2, 3] }), "diagnostics.totalMomentumKgMPerS");
    rejects(() => parseDiagnosticsDto({ ...diagnostics, bookedSpinKgM2PerS: { x: 0, y: 0 } }), "diagnostics.bookedSpinKgM2PerS.z");
    rejects(() => parseDiagnosticsDto({ ...diagnostics, bookedSpinKgM2PerS: { x: 0, y: "0", z: 0 } }), "bookedSpinKgM2PerS.y");
  });

  it("rejects non-finite numbers anywhere, like every other numeric field", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      rejects(() => parseDiagnosticsDto({ ...diagnostics, potentialEnergyJ: bad }), "diagnostics.potentialEnergyJ");
      rejects(
        () => parseDiagnosticsDto({ ...diagnostics, angularMomentumAboutOriginKgM2PerS: { x: 0, y: bad, z: 0 } }),
        "angularMomentumAboutOriginKgM2PerS.y",
      );
    }
  });
});

describe("body rendering metadata", () => {
  it("accepts known classification and stable asset keys", () => {
    expect(parseBodyDto({ ...earth, bodyType: "rocky-planet", assetKey: "earth" })).toMatchObject({
      bodyType: "rocky-planet",
      assetKey: "earth",
    });
  });

  it("keeps older and custom bodies valid when optional rendering metadata is absent", () => {
    const { bodyType: _type, assetKey: _key, ...legacyBody } = earth;
    expect(parseBodyDto(legacyBody)).toEqual(legacyBody);
  });

  it("accepts the current API response shape with bodyType but no assetKey", () => {
    const parsed = parseBodyDto({ ...earth, bodyType: "default" });
    expect(parsed.bodyType).toBe("default");
    expect(parsed.assetKey).toBeUndefined();
  });

  it("accepts the finalized nullable asset key and falls back for a null classification", () => {
    const parsed = parseBodyDto({ ...earth, bodyType: null, assetKey: null });
    expect(parsed.bodyType).toBeUndefined();
    expect(parsed.assetKey).toBeUndefined();
  });

  it("uses the default fallback for unknown classifications and tolerates unregistered asset keys", () => {
    expect(parseBodyDto({ ...earth, bodyType: "comet" }).bodyType).toBeUndefined();
    const futureBody = parseBodyDto({ ...earth, bodyType: "comet", assetKey: "future-asset" });
    expect(futureBody.bodyType).toBeUndefined();
    expect(futureBody.assetKey).toBe("future-asset");
    expect(parseBodyDto({ ...earth, assetKey: "future-asset" }).assetKey).toBe("future-asset");
  });
});

describe("moon metadata", () => {
  const io = { ...earth, id: "body-io", name: "Io", bodyType: "moon", assetKey: "io", primaryId: "body-jupiter" };

  it("accepts the moon type and a primary id on live bodies", () => {
    expect(parseBodyDto(io)).toMatchObject({ bodyType: "moon", assetKey: "io", primaryId: "body-jupiter" });
  });

  it("treats a null or absent primary as no primary, and rejects a malformed one", () => {
    expect("primaryId" in parseBodyDto({ ...io, primaryId: null })).toBe(false);
    expect("primaryId" in parseBodyDto({ ...io, primaryId: undefined })).toBe(false);
    rejects(() => parseBodyDto({ ...io, primaryId: 5 }), "body.primaryId");
  });

  it("keeps renderer metadata on history body metadata, and tolerates older backends without it", () => {
    const page = (meta: object) => parseHistoryPage({
      universeId: "u", mode: "grid", sampleIntervalS: 1, generation: 0, firstIndex: 0, nextIndex: 0, droppedBefore: 0,
      truncated: false, samples: [], bodies: { "body-io": { name: "Io", colorHex: "#fff", radiusM: 1, kind: "planet", ...meta } },
    });
    expect(page({ bodyType: "moon", assetKey: "io", primaryId: "body-jupiter" }).bodies["body-io"]).toMatchObject({ bodyType: "moon", assetKey: "io", primaryId: "body-jupiter" });
    expect(page({}).bodies["body-io"]).toEqual({ name: "Io", colorHex: "#fff", radiusM: 1, kind: "planet" });
  });
});

describe("state and step responses with diagnostics", () => {
  it("parseStateDto returns bodies, status, time and diagnostics", () => {
    const s = parseStateDto(state([sun, earth], 42));
    expect(s.bodies).toEqual([sun, earth]);
    expect(s.simulationTimeS).toBe(42);
    expect(s.status).toBe("paused");
    expect(s.diagnostics).toEqual(diagnostics);
  });

  it("parseStepResponse keeps advancedS and events next to diagnostics", () => {
    const r = parseStepResponse(stepResponse([sun], 100, [mergerEvent]));
    expect(r.advancedS).toBe(100);
    expect(r.events).toEqual([mergerEvent]);
    expect(r.diagnostics).toEqual(diagnostics);
  });

  it("a response without diagnostics still parses, with diagnostics null and a reason (never a default)", () => {
    const { diagnostics: _d, diagnosticsIssue: _i, ...legacy } = state([sun]);
    const s = parseStateDto(legacy);
    expect(s.bodies).toEqual([sun]);
    expect(s.diagnostics).toBeNull();
    expect(s.diagnosticsIssue).toMatch(/no diagnostics/);
    const step = parseStepResponse({ ...legacy, advancedS: 1, events: [] });
    expect(step.diagnostics).toBeNull();
    expect(step.advancedS).toBe(1);
  });

  it("an unsupported diagnostics version is reported, not reinterpreted, and does not hide the bodies", () => {
    const s = parseStateDto({ ...state([sun, earth]), diagnostics: { ...diagnostics, version: 2 } });
    expect(s.bodies).toHaveLength(2);
    expect(s.diagnostics).toBeNull();
    expect(s.diagnosticsIssue).toMatch(/unsupported diagnostics version \(2/);
    expect(parseStateDto({ ...state([sun]), diagnostics: { ...diagnostics, version: undefined } }).diagnosticsIssue)
      .toMatch(/unsupported diagnostics version \(undefined/);
  });

  it("malformed diagnostics (wrong type, non-finite, partial vector) become unavailable with a reason", () => {
    for (const bad of [
      { ...diagnostics, kineticEnergyJ: "1" },
      { ...diagnostics, potentialEnergyJ: NaN },
      { ...diagnostics, bookedSpinKgM2PerS: { x: 0, y: 0 } },
      "nope",
      [],
    ]) {
      const s = parseStateDto({ ...state([sun]), diagnostics: bad });
      expect(s.diagnostics).toBeNull();
      expect(s.diagnosticsIssue).toBeTruthy();
      expect(s.bodies).toEqual([sun]);
    }
  });

  it("existing required fields are still required", () => {
    rejects(() => parseStateDto({ ...state([sun]), simulationTimeS: "0" }), "state.simulationTimeS");
    rejects(() => parseStateDto({ ...state([sun]), status: "stopped" }), "state.status");
    rejects(() => parseStateDto({ ...state([sun]), bodies: null }), "state.bodies");
  });

  it("ignores unknown extra keys (additive backend changes stay compatible)", () => {
    const s = parseStateDto({ ...state([sun]), futureField: 1, diagnostics: { ...diagnostics, extra: 2 } });
    expect(s.diagnostics).toEqual(diagnostics);
  });
});

describe("collision engine fields (Stage 2)", () => {
  const withMaterial = {
    ...earth,
    material: { profileId: "silicate-rock", layers: null },
    spinRadPerS: { x: 0, y: 0, z: 7.2921e-5 },
    orientation: { quaternion: [1, 0, 0, 0], epochS: 0 },
  };

  it("leaves a body without the new fields exactly as it was (old backends and material-less bodies)", () => {
    const parsed = parseBodyDto(earth);
    expect("material" in parsed).toBe(false);
    expect("spinRadPerS" in parsed).toBe(false);
    expect("orientation" in parsed).toBe(false);
  });

  it("parses material, spin and orientation when present", () => {
    expect(parseBodyDto(withMaterial)).toMatchObject({
      material: { profileId: "silicate-rock", layers: null },
      spinRadPerS: { x: 0, y: 0, z: 7.2921e-5 },
      orientation: { quaternion: [1, 0, 0, 0], epochS: 0 },
    });
  });

  it("parses layer overrides and treats null layer details as null", () => {
    const parsed = parseBodyDto({
      ...earth,
      material: {
        profileId: "silicate-rock",
        layers: [{ materialId: "iron", massFraction: 1, phase: "partial", meltFraction: 0.5, densityKgPerM3: null }],
      },
    });
    expect(parsed.material?.layers).toEqual([
      { materialId: "iron", massFraction: 1, phase: "partial", meltFraction: 0.5, densityKgPerM3: null },
    ]);
  });

  it("rejects malformed new fields instead of passing them on", () => {
    rejects(() => parseBodyDto({ ...earth, material: { profileId: 5 } }), "body.material.profileId");
    rejects(() => parseBodyDto({ ...earth, material: { profileId: "x", layers: "no" } }), "body.material.layers");
    rejects(() => parseBodyDto({ ...earth, spinRadPerS: { x: 0, y: 0 } }), "body.spinRadPerS.z");
    rejects(() => parseBodyDto({ ...earth, orientation: { quaternion: [1, 0, 0], epochS: 0 } }), "body.orientation.quaternion");
    rejects(() => parseBodyDto({ ...earth, orientation: { quaternion: [1, 0, 0, NaN], epochS: 0 } }), "body.orientation.quaternion[3]");
    rejects(
      () => parseBodyDto({ ...earth, material: { profileId: "x", layers: [{ materialId: "a", massFraction: 1, phase: "plasma" }] } }),
      "body.material.layers[0].phase",
    );
  });

  it("accepts the additive spin angular momentum in diagnostics without changing the version", () => {
    const base = parseDiagnosticsDto(diagnostics);
    expect("spinAngularMomentumKgM2PerS" in base).toBe(false);
    const rich = parseDiagnosticsDto({ ...diagnostics, spinAngularMomentumKgM2PerS: { x: 0, y: 0, z: 1e33 } });
    expect(rich.version).toBe(1);
    expect(rich.spinAngularMomentumKgM2PerS).toEqual({ x: 0, y: 0, z: 1e33 });
    expect(parseDiagnosticsDto({ ...diagnostics, spinAngularMomentumKgM2PerS: null }).spinAngularMomentumKgM2PerS).toBeNull();
    rejects(() => parseDiagnosticsDto({ ...diagnostics, spinAngularMomentumKgM2PerS: { x: 1 } }), "diagnostics.spinAngularMomentumKgM2PerS");
  });

  it("parses a whole state whose body carries the new fields, and keeps its diagnostics", () => {
    const parsed = parseStateDto({ ...state([], 0), bodies: [withMaterial], diagnostics: { ...diagnostics, spinAngularMomentumKgM2PerS: { x: 0, y: 0, z: 1 } } });
    expect(parsed.bodies[0].orientation?.epochS).toBe(0);
    expect(parsed.diagnostics?.spinAngularMomentumKgM2PerS).toEqual({ x: 0, y: 0, z: 1 });
    expect(parsed.diagnosticsIssue).toBeNull();
  });
});

describe("collision products on bodies (Stage 4)", () => {
  const parcel = {
    ...earth,
    id: "debris-3-0",
    representation: "debris-parcel",
    originEventId: "col-3",
    debris: { totalMassKg: 5e20, sizeDistribution: null, velocityDispersionMPerS: 0, materialProfileId: "silicate-rock", sampleSeed: 12345 },
  };

  it("parses a debris parcel and leaves ordinary bodies without the fields", () => {
    const p = parseBodyDto(parcel);
    expect(p.representation).toBe("debris-parcel");
    expect(p.originEventId).toBe("col-3");
    expect(p.debris).toEqual({ totalMassKg: 5e20, sizeDistribution: null, velocityDispersionMPerS: 0, materialProfileId: "silicate-rock", sampleSeed: 12345 });
    const plain = parseBodyDto(earth);
    expect("representation" in plain || "originEventId" in plain || "debris" in plain).toBe(false);
  });

  it("parses a resolved size distribution and rejects malformed product fields", () => {
    const d = { ...parcel.debris, sizeDistribution: { kind: "power-law", exponent: 2.85, dMinM: 1, dMaxM: 1e5 } };
    expect(parseBodyDto({ ...parcel, debris: d }).debris?.sizeDistribution).toEqual({ kind: "power-law", exponent: 2.85, dMinM: 1, dMaxM: 1e5 });
    rejects(() => parseBodyDto({ ...parcel, representation: "cloud" }), "body.representation");
    rejects(() => parseBodyDto({ ...parcel, debris: { ...parcel.debris, totalMassKg: "x" } }), "body.debris.totalMassKg");
    rejects(() => parseBodyDto({ ...parcel, debris: { ...parcel.debris, sizeDistribution: { kind: "gaussian" } } }), "sizeDistribution.kind");
  });
});

describe("debris lifecycle fields (Stage 7)", () => {
  const frag = { ...earth, id: "frag-3-1", representation: "fragment", originEventId: "col-3", fragmentClass: "escaping" };

  it("parses the dynamical class of a fragment and leaves ordinary bodies without it", () => {
    expect(parseBodyDto(frag).fragmentClass).toBe("escaping");
    expect("fragmentClass" in parseBodyDto(earth)).toBe(false);
    rejects(() => parseBodyDto({ ...frag, fragmentClass: "lost" }), "body.fragmentClass");
  });

  it("parses the escaped-material ledger of the diagnostics and keeps it absent otherwise", () => {
    const escaped = { massKg: 1e3, momentumKgMPerS: { x: 1, y: 2, z: 3 }, angularMomentumAboutOriginKgM2PerS: { x: 0, y: 0, z: 4 }, bodyCount: 1 };
    expect(parseDiagnosticsDto({ ...diagnostics, escaped }).escaped).toEqual(escaped);
    expect("escaped" in parseDiagnosticsDto(diagnostics)).toBe(false);
    rejects(() => parseDiagnosticsDto({ ...diagnostics, escaped: { ...escaped, bodyCount: "one" } }), "diagnostics.escaped.bodyCount");
  });

  it("parses the budget warning of a shortened step and keeps it absent for a normal step", () => {
    const base = stepResponse([sun], 100, []);
    expect(parseStepResponse({ ...base, warnings: ["collision_budget_reached"], advancedS: 40 }).warnings).toEqual(["collision_budget_reached"]);
    expect("warnings" in parseStepResponse(base)).toBe(false);
    rejects(() => parseStepResponse({ ...base, warnings: "x" }), "step.warnings");
  });
});
