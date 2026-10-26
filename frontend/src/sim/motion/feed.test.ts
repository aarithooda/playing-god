import { describe, expect, it } from "vitest";
import { earth, mergerEvent, stepResponse, sun } from "../../test/fixtures";
import { toSimulationView } from "../viewModel";
import { cutIdsOf, toMotionSample } from "./feed";

describe("feeding the motion buffer", () => {
  it("carries time, mass, position, velocity and the named primary of every body, in SI", () => {
    const view = toSimulationView(stepResponse([sun, { ...earth, primaryId: sun.id }], 123));
    const sample = toMotionSample(view);
    expect(sample.t).toBe(123);
    expect(sample.cut).toBeUndefined();
    expect(sample.bodies.map((b) => b.id)).toEqual([sun.id, earth.id]);
    expect(sample.bodies[1]).toEqual({ id: earth.id, massKg: earth.massKg, p: [1.496e11, 0, 0], v: [0, 29780, 0], primaryId: sun.id });
  });

  it("marks every body a step's events name (survivor, absorbed, result) as discontinuous", () => {
    expect([...cutIdsOf([mergerEvent])].sort()).toEqual([earth.id, sun.id].sort());
    const view = toSimulationView(stepResponse([sun], 5));
    expect([...toMotionSample(view, [mergerEvent]).cut!].sort()).toEqual([earth.id, sun.id].sort());
    expect(cutIdsOf([])).toEqual(new Set());
  });
});
