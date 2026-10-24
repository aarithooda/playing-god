import { describe, expect, it } from "vitest";
import type { PositionSample } from "../render/contract";
import { toScenePosition } from "./renderTransform";
import { buildPolylines, buildTimedPolylines, decimate, smoothTimedPolyline, spatialTrailProgress, toSceneSamples } from "./trajectory";

const sample = (i: number, segment = 0, x = i): PositionSample => ({ simulationTimeS: i * 100, positionM: { x: x * 1e9, y: 2e9, z: 3e9 }, segment });
const run = (n: number, segmentAt: number[] = []): PositionSample[] =>
  Array.from({ length: n }, (_, i) => sample(i, segmentAt.filter((s) => i >= s).length));

describe("trajectory.ts", () => {
  it("trajectory.ts converts SI samples with toScenePosition", () => {
    const t = { metersPerUnit: 1e9 };
    const samples = [sample(0), sample(1)];
    expect(toSceneSamples(samples, t)).toEqual(samples.map((s) => toScenePosition(s.positionM, t)));
    // the physics x-y plane is the ground plane: y -> -z, z -> up
    expect(toSceneSamples([sample(0)], t)[0]).toEqual([0, 3, -2]);
  });

  it("decimate keeps segment boundaries, first and last points and at most maxPoints", () => {
    const samples = run(10_000, [3000, 7000]);
    const out = decimate(samples, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    const times = new Set(out.map((s) => s.simulationTimeS));
    for (const i of [0, 2999, 3000, 6999, 7000, 9999]) expect(times.has(i * 100)).toBe(true);
    expect(out.map((s) => s.simulationTimeS)).toEqual([...out.map((s) => s.simulationTimeS)].sort((a, b) => a - b));
    expect(out.map((s) => s.segment)).toEqual([...out.map((s) => s.segment)].sort((a, b) => a - b));
  });

  it("decimate never invents points and leaves short input alone", () => {
    const samples = run(40);
    expect(decimate(samples, 5000)).toEqual(samples);
    expect(decimate(samples, 5000)).not.toBe(samples);
    const out = decimate(run(1000), 100);
    const original = new Set(run(1000).map((s) => s.simulationTimeS));
    expect(out.every((s) => original.has(s.simulationTimeS))).toBe(true);
  });

  it("decimate copes with more segment boundaries than the budget", () => {
    const many = run(2000, Array.from({ length: 999 }, (_, i) => (i + 1) * 2));
    const out = decimate(many, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out[0]).toBe(many[0]);
    expect(out[out.length - 1]).toBe(many[1999]);
  });

  it("TrajectoryLayer splits polylines at segment changes", () => {
    const lines = buildPolylines(run(10, [4, 7]), { metersPerUnit: 1e9 });
    expect(lines.map((l) => l.length)).toEqual([4, 3, 3]);
    // nothing connects the last point of one piece to the first of the next
    expect(lines[0]![3]).toEqual(toScenePosition({ x: 3e9, y: 2e9, z: 3e9 }, { metersPerUnit: 1e9 }));
    expect(lines[1]![0]).toEqual(toScenePosition({ x: 4e9, y: 2e9, z: 3e9 }, { metersPerUnit: 1e9 }));
  });

  it("retains backend sample times without changing recorded geometry", () => {
    const lines = buildTimedPolylines(run(6, [3]), { metersPerUnit: 1e9 });
    expect(lines.map((line) => line.simulationTimesS)).toEqual([[0, 100, 200], [300, 400, 500]]);
    expect(lines.map((line) => line.points)).toEqual(buildPolylines(run(6, [3]), { metersPerUnit: 1e9 }));
  });

  it("fades by cumulative space along the curve, ending bright at its current endpoint", () => {
    const progress = spatialTrailProgress([[0, 0, 0], [1, 0, 0], [1, 3, 0]]);
    expect(progress).toEqual([0, 0.25, 1]);
    expect(spatialTrailProgress([[4, 2, 1]])).toEqual([1]);
  });

  it("smooths the displayed path between recorded samples while preserving endpoints and time order", () => {
    const recorded = buildTimedPolylines(run(5), { metersPerUnit: 1e9 })[0]!;
    const smooth = smoothTimedPolyline(recorded);
    expect(smooth.points.length).toBeGreaterThan(recorded.points.length);
    expect(smooth.points[0]).toEqual(recorded.points[0]);
    expect(smooth.points[smooth.points.length - 1]).toEqual(recorded.points[recorded.points.length - 1]);
    expect(smooth.simulationTimesS[0]).toBe(recorded.simulationTimesS[0]);
    expect(smooth.simulationTimesS[smooth.simulationTimesS.length - 1]).toBe(recorded.simulationTimesS[recorded.simulationTimesS.length - 1]);
    expect(smooth.simulationTimesS).toEqual([...smooth.simulationTimesS].sort((a, b) => a - b));
    expect(smooth.points.some((point, i) => i > 0 && i < smooth.points.length - 1
      && !recorded.points.some((original) => original.every((value, axis) => value === point[axis])))).toBe(true);
  });

  it("keeps rendered curve density bounded for long recorded histories", () => {
    const recorded = buildTimedPolylines(run(5000), { metersPerUnit: 1e9 })[0]!;
    const smooth = smoothTimedPolyline(recorded);
    expect(smooth.points.length).toBeLessThanOrEqual(10_000);
    expect(smooth.points[0]).toEqual(recorded.points[0]);
    expect(smooth.points[smooth.points.length - 1]).toEqual(recorded.points[recorded.points.length - 1]);
  });

  it("keeps an unevenly sampled curved path finite and smooth", () => {
    const smooth = smoothTimedPolyline({
      points: [[0, 0, 0], [0.1, 4, 0], [5, 4, 0], [5.2, 0, 0]],
      simulationTimesS: [0, 1, 2, 3],
    });
    expect(smooth.points.every((point) => point.every(Number.isFinite))).toBe(true);
    expect(smooth.points[0]).toEqual([0, 0, 0]);
    expect(smooth.points[smooth.points.length - 1]).toEqual([5.2, 0, 0]);
  });

  it("an empty or single-sample trajectory yields no drawable line", () => {
    expect(buildPolylines([], { metersPerUnit: 1 })).toEqual([]);
    expect(buildPolylines([sample(0)], { metersPerUnit: 1 }).filter((l) => l.length >= 2)).toEqual([]);
  });
});
