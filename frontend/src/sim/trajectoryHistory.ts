import type { Vec3 } from "../api/types";
import type { SimulationView } from "./viewModel";

/** Bound client-side trajectory history independently of the backend event log. */
export const MAX_TRAJECTORY_SNAPSHOTS = 600;

export interface TrajectoryBodySnapshot {
  id: string;
  name: string;
  positionM: Vec3;
}

export interface TrajectorySnapshot {
  sequence: number;
  simulationTimeS: number;
  /** A discontinuity begins a new segment so no trail should bridge an edit or uncertain step. */
  segment: number;
  bodies: TrajectoryBodySnapshot[];
}

export interface TrajectoryHistory {
  /** Client-local identity. The API does not expose a persistent simulation-run id. */
  runId: number;
  samples: TrajectorySnapshot[];
  segment: number;
  truncated: boolean;
}

let nextRunId = 1;

export function nextTrajectoryRunId(): number {
  const runId = nextRunId;
  nextRunId += 1;
  return runId;
}

function copyBodies(sim: SimulationView): TrajectoryBodySnapshot[] {
  return sim.bodies.map((body) => ({
    id: body.id,
    name: body.name,
    positionM: { ...body.positionM },
  }));
}

function sameSnapshot(a: TrajectorySnapshot, sim: SimulationView): boolean {
  if (a.simulationTimeS !== sim.simulationTimeS || a.bodies.length !== sim.bodies.length) return false;
  return a.bodies.every((body, index) => {
    const current = sim.bodies[index];
    return body.id === current.id && body.name === current.name &&
      body.positionM.x === current.positionM.x &&
      body.positionM.y === current.positionM.y &&
      body.positionM.z === current.positionM.z;
  });
}

export function createTrajectoryHistory(runId: number, sim: SimulationView): TrajectoryHistory {
  return appendTrajectorySnapshot({ runId, samples: [], segment: 0, truncated: false }, sim);
}

/**
 * Store a copy of a backend-returned state. Never interpolate or predict positions here.
 * A discontinuity is used after body edits or an uncertain-outcome resync so trails cannot imply
 * continuous motion across a change the client did not observe.
 */
export function appendTrajectorySnapshot(
  history: TrajectoryHistory,
  sim: SimulationView,
  discontinuity = false,
): TrajectoryHistory {
  const previous = history.samples[history.samples.length - 1];
  if (!discontinuity && previous && sameSnapshot(previous, sim)) return history;

  const segment = history.segment + (discontinuity && previous ? 1 : 0);
  const sample: TrajectorySnapshot = {
    sequence: previous ? previous.sequence + 1 : 0,
    simulationTimeS: sim.simulationTimeS,
    segment,
    bodies: copyBodies(sim),
  };
  const samples = [...history.samples, sample];
  const truncated = history.truncated || samples.length > MAX_TRAJECTORY_SNAPSHOTS;
  return {
    ...history,
    segment,
    samples: truncated ? samples.slice(-MAX_TRAJECTORY_SNAPSHOTS) : samples,
    truncated,
  };
}
