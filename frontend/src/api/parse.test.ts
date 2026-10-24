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
