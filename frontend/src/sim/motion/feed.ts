// Turns what the backend reported (a state, and for a step the events it produced) into the buffer's input. Pure.
import type { SimulationEventDto } from "../../api/types";
import type { SimulationView } from "../viewModel";
import type { MotionSample } from "./MotionBuffer";

/** Bodies named by the events of one step: they were removed, merged or created by a collision, so their motion is not continuous. */
export function cutIdsOf(events: readonly SimulationEventDto[]): Set<string> {
  const ids = new Set<string>();
  for (const e of events) {
    // a burn changes a spacecraft's velocity inside the step, a contact puts the pair back to the instant they touched: neither
    // body's motion over that step is the smooth arc the interpolation assumes
    for (const id of e.bodyIds) ids.add(id);
    if (e.type === "merger") ids.add(e.resultBodyId);
    else if (e.type === "collision") for (const id of [...e.survivingBodyIds, ...e.createdBodyIds, ...e.removedBodyIds]) ids.add(id);
  }
  return ids;
}

export function toMotionSample(view: SimulationView, events: readonly SimulationEventDto[] = []): MotionSample {
  const cut = cutIdsOf(events);
  return {
    t: view.simulationTimeS,
    bodies: view.bodies.map((b) => ({
      id: b.id,
      massKg: b.massKg,
      p: [b.positionM.x, b.positionM.y, b.positionM.z],
      v: [b.velocityMPerS.x, b.velocityMPerS.y, b.velocityMPerS.z],
      // a spacecraft rides on the body it orbits NOW (the backend's reference body), so its fast orbit is interpolated about it
      ...(b.spacecraft?.orbit ? { primaryId: b.spacecraft.orbit.referenceBodyId } : b.primaryId === undefined ? {} : { primaryId: b.primaryId }),
    })),
    ...(cut.size ? { cut } : {}),
  };
}
