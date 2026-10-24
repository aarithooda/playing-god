import { describe, expect, it } from "vitest";
import { earth, sun, state } from "../test/fixtures";
import { toSimulationView } from "./viewModel";
import {
  appendTrajectorySnapshot,
  createTrajectoryHistory,
  MAX_TRAJECTORY_SNAPSHOTS,
} from "./trajectoryHistory";

describe("trajectory history", () => {
  it("copies only observed positions and never mutates when the source state changes", () => {
    const sim = toSimulationView(state([sun, earth], 10));
    const history = createTrajectoryHistory(7, sim);
    sim.bodies[1].positionM.x = -123;

    expect(history.runId).toBe(7);
    expect(history.samples[0].simulationTimeS).toBe(10);
    expect(history.samples[0].bodies[1].positionM.x).toBe(earth.positionM.x);
    expect(history.samples[0].segment).toBe(0);
  });

  it("skips duplicate unchanged states but records same-time body edits as discontinuities", () => {
    const initial = toSimulationView(state([sun], 10));
    const history = createTrajectoryHistory(1, initial);
    expect(appendTrajectorySnapshot(history, initial)).toBe(history);

    const edited = toSimulationView(state([{ ...sun, positionM: { x: 4, y: 5, z: 6 } }], 10));
    const afterEdit = appendTrajectorySnapshot(history, edited, true);
    expect(afterEdit.samples).toHaveLength(2);
    expect(afterEdit.samples[1].simulationTimeS).toBe(10);
    expect(afterEdit.samples[1].segment).toBe(1);
  });

  it("keeps only the newest bounded samples and reports that older history was trimmed", () => {
    let history = createTrajectoryHistory(3, toSimulationView(state([sun], 0)));
    for (let i = 1; i <= MAX_TRAJECTORY_SNAPSHOTS + 2; i += 1) {
      history = appendTrajectorySnapshot(history, toSimulationView(state([sun], i)));
    }

    expect(history.samples).toHaveLength(MAX_TRAJECTORY_SNAPSHOTS);
    expect(history.samples[0].simulationTimeS).toBe(3);
    expect(history.samples[history.samples.length - 1].simulationTimeS).toBe(MAX_TRAJECTORY_SNAPSHOTS + 2);
    expect(history.truncated).toBe(true);
  });

  it("keeps positions for bodies that disappear in a later backend snapshot", () => {
    let history = createTrajectoryHistory(4, toSimulationView(state([sun, earth], 0)));
    history = appendTrajectorySnapshot(history, toSimulationView(state([sun], 5)));

    expect(history.samples[0].bodies.map((body) => body.id)).toContain(earth.id);
    expect(history.samples[1].bodies.map((body) => body.id)).not.toContain(earth.id);
  });
});
