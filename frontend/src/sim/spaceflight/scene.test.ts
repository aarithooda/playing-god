import { describe, expect, it } from "vitest";
import type { MissionTrajectoryDto } from "../../api/types";
import { craft, leoOrbit, mission, plan, spacecraftBlock } from "../../test/flightFixtures";
import { earth } from "../../test/fixtures";
import type { HistoryCache } from "../history/historyModel";
import { toBodyView } from "../viewModel";
import { buildSpaceflightScene } from "./useSpaceflight";

const moon = { ...earth, id: "body-moon", name: "Moon", massKg: 7.35e22, radiusM: 1.7374e6, positionM: { x: earth.positionM.x + 3.844e8, y: 0, z: 0 } };
const views = (...bodies: Parameters<typeof toBodyView>[0][]) => bodies.map(toBodyView);

const trajectory: MissionTrajectoryDto = {
  missionId: "msn-1", planRevision: 1,
  timesS: [0, 100000, 200000, 348980, 360000],
  originM: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  destinationM: [[3.8e8, 0, 0], [3.7e8, 9e7, 0], [3.4e8, 1.7e8, 0], [2.7e8, 2.7e8, 0], [2.6e8, 2.8e8, 0]],
  spacecraftM: [[6.7e6, 0, 0], [1.2e8, 9e7, 0], [2.2e8, 1.9e8, 0], [2.7e8, 2.718e8, 0], [2.6e8, 2.818e8, 0]],
};

function history(): HistoryCache {
  // twelve samples of a 400 km orbit about Earth, 20 degrees apart
  const samples = Array.from({ length: 12 }, (_, k) => {
    const a = (k * 20 * Math.PI) / 180;
    return { index: k, simulationTimeS: k * 300, segment: 0,
      positionsM: { [earth.id]: [earth.positionM.x, 0, 0] as [number, number, number], "craft-111111111111": [earth.positionM.x + 6.771e6 * Math.cos(a), 6.771e6 * Math.sin(a), 0] as [number, number, number] } };
  });
  return { universeId: "u", generation: 1, mode: "grid", sampleIntervalS: 300, samples, bodies: {}, nextIndex: 12, droppedBefore: 0, truncated: false, gaps: [], clientTrimmed: false };
}

describe("buildSpaceflightScene: what the canvas is given for spacecraft", () => {
  it("is nothing for a universe without spacecraft or plans", () => {
    expect(buildSpaceflightScene(views(earth), [], {}, null, true, 0)).toBeUndefined();
  });

  it("gives every spacecraft its osculating orbit and its flown path about the body it orbits", () => {
    const scene = buildSpaceflightScene(views(earth, craft()), [], {}, history(), true, 3300)!;
    expect(scene.plans).toEqual([]);
    const [c] = scene.craft;
    expect(c!.frameBodyId).toBe(earth.id);
    expect(c!.orbit).toHaveLength(181);
    expect(Math.hypot(...c!.orbit[0]!)).toBeCloseTo(6.771e6, 0);
    expect(c!.recorded).toHaveLength(1);
    expect(c!.recorded[0]!.frameBodyId).toBe(earth.id);
    expect(c!.recorded[0]!.points).toHaveLength(12);
  });

  it("draws no flown path when paths are switched off, and still the orbit", () => {
    const scene = buildSpaceflightScene(views(earth, craft()), [], {}, history(), false, 0)!;
    expect(scene.craft[0]!.recorded).toEqual([]);
    expect(scene.craft[0]!.orbit.length).toBeGreaterThan(0);
  });

  it("inside another body's sphere of influence the earlier leg stays drawn about the body it was flown around", () => {
    const atMoon = { ...leoOrbit, referenceBodyId: moon.id, referenceBodyName: "Moon", sphereOfInfluenceM: 6.6e7 };
    const lunar = craft({ spacecraft: spacecraftBlock({ orbit: atMoon, homeBodyId: earth.id }) });
    const h = history();
    for (const s of h.samples) s.positionsM[moon.id] = [earth.positionM.x + 3.844e8, 0, 0]; // the Moon is far from every recorded sample
    const scene = buildSpaceflightScene(views(earth, moon, lunar), [], {}, h, true, 0)!;
    expect(scene.craft[0]!.frameBodyId).toBe(moon.id);
    expect(scene.craft[0]!.recorded.map((p) => p.frameBodyId)).toEqual([earth.id]); // nothing was flown inside the Moon's sphere yet
  });

  it("a mission's planned trajectory is drawn only while it is a current plan, and only its part still ahead once committed", () => {
    const bodies = views(earth, moon, craft());
    const proposed = mission({ status: "planned", plan: { ...plan, originBodyId: earth.id, destinationBodyId: moon.id }, planRevision: 1 });
    const key = { "msn-1:1": trajectory };
    const scene = buildSpaceflightScene(bodies, [proposed], key, null, true, 0)!;
    expect(scene.plans).toHaveLength(1);
    const p = scene.plans[0]!;
    expect(p.committed).toBe(false);
    expect(p.aboutOrigin).toHaveLength(4); // up to the arrival
    expect(p.destinationName).toBe("Moon");
    expect(p.destinationAtArrival).toEqual([2.7e8, 2.7e8, 0]);
    expect(p.nodes.map((n) => [n.label, n.frameBodyId])).toEqual([["Departure burn", earth.id], ["Insertion burn", moon.id]]);
    expect(p.aboutDestination.length).toBeGreaterThan(0);

    const flying = { ...proposed, committed: true, status: "in_progress" as const };
    const later = buildSpaceflightScene(bodies, [flying], key, null, true, 150000)!.plans[0]!;
    expect(later.aboutOrigin).toHaveLength(2); // t = 200000 and the arrival
    expect(later.nodes.map((n) => n.label)).toEqual(["Insertion burn"]); // the departure is behind

    for (const status of ["draft", "completed", "failed", "unsupported"] as const) {
      expect(buildSpaceflightScene(bodies, [{ ...proposed, status }], key, null, true, 0)!.plans).toEqual([]);
    }
    expect(buildSpaceflightScene(bodies, [proposed], {}, null, true, 0)!.plans).toEqual([]); // its samples have not arrived yet
  });
});
