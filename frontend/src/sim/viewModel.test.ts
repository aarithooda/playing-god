import { describe, expect, it } from "vitest";
import { diagnostics, earth, mergerEvent, state, sun } from "../test/fixtures";
import { formatDuration, formatNumber } from "./format";
import { mergeEvents, toBodyView, toEventView, toSceneBody, toSimulationView } from "./viewModel";

describe("DTO -> view model", () => {
  it("keeps every SI quantity under its API name and adds derived speed", () => {
    const v = toBodyView(earth);
    expect(v).toMatchObject({
      id: earth.id,
      name: "Earth",
      massKg: 5.972e24,
      radiusM: 6.371e6,
      positionM: { x: 1.496e11, y: 0, z: 0 },
      velocityMPerS: { x: 0, y: 29780, z: 0 },
      colorHex: "#3b82f6",
    });
    expect(v.speedMPerS).toBe(29780);
  });

  it("does not alias the DTO vectors", () => {
    const v = toBodyView(earth);
    v.positionM.x = 1;
    expect(earth.positionM.x).toBe(1.496e11);
  });

  it("uses the safe default visual classification for legacy/custom bodies", () => {
    const { bodyType: _type, assetKey: _key, ...customBody } = earth;
    expect(toBodyView(customBody).bodyType).toBe("default");
    expect(toBodyView(customBody).assetKey).toBeUndefined();
  });

  it("maps the simulation state including status and time", () => {
    const v = toSimulationView({ ...state([sun, earth], 3600), status: "running" });
    expect(v.status).toBe("running");
    expect(v.simulationTimeS).toBe(3600);
    expect(v.bodies.map((b) => b.id)).toEqual([sun.id, earth.id]);
  });

  it("produces scene values from SI values only through the transform", () => {
    const s = toSceneBody(toBodyView(earth), { metersPerUnit: 1e10 });
    expect(s.position[0]).toBeCloseTo(14.96, 10);
    expect(s.position[1]).toBe(0);
    expect(s.color).toBe("#3b82f6");
    expect(s.radius).toBeCloseTo(6.371e6 / 1e10, 12); // true scale in both views
  });

  it("merges events by id without duplicating", () => {
    const e = toEventView(mergerEvent);
    expect(e.estimatedContactTimeS).toBe(mergerEvent.estimatedContactTimeS);
    expect(e.spinAddedKgM2PerS).toEqual(mergerEvent.spinAddedKgM2PerS);
    e.spinAddedKgM2PerS.z = 0;
    expect(mergerEvent.spinAddedKgM2PerS.z).toBe(1e40);
    const once = mergeEvents([], [e]);
    expect(mergeEvents(once, [e])).toBe(once);
    expect(mergeEvents(once, [{ ...e, id: "evt-2" }]).map((x) => x.id)).toEqual(["evt-1", "evt-2"]);
  });
});

describe("formatting", () => {
  it("round-trips through Number()", () => {
    for (const x of [0, 1, -3.5, 1.496e11, 6.371e6, 5.972e24, 1.2e-7, 29780]) {
      const back = Number(formatNumber(x));
      expect(Math.abs(back - x)).toBeLessThanOrEqual(Math.abs(x) * 1e-6);
    }
  });

  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(7200)).toBe("2 h");
    expect(formatDuration(86400 * 3.5)).toBe("3.5 d");
    expect(formatDuration(3.156e7)).toBe("1 yr");
  });
});

describe("toSimulationView diagnostics", () => {
  it("passes the backend diagnostics through unchanged", () => {
    expect(toSimulationView(state([earth])).diagnostics).toEqual(diagnostics);
  });
});
