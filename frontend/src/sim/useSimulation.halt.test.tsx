// Stop-on-contact in the play loop: a step that reports a halt ends Play there, and no further step is requested from a
// universe that would refuse it.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { craft, halt, maneuver, mission } from "../test/flightFixtures";
import { earth, fakeClient, state, stepResponse } from "../test/fixtures";
import { cutIdsOf, toMotionSample } from "./motion/feed";
import { useSimulation } from "./useSimulation";
import { toSimulationView } from "./viewModel";

const opts = { tickMs: 100, healthPollMs: 1_000_000 };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useSimulation: a collision halt", () => {
  it("stops Play at the halting step and asks for no more steps", async () => {
    let calls = 0;
    const contact = { id: "halt-3", type: "contact" as const, simulationTimeS: 300, estimatedContactTimeS: 300, bodyIds: halt.bodyIds, relativeSpeedMPerS: 7933, refined: true, involvesSpacecraft: true };
    const client = fakeClient({
      getState: async () => state([earth, craft()]),
      step: async () => {
        calls += 1;
        if (calls < 3) return stepResponse([earth, craft()], calls * 100);
        return { ...stepResponse([earth, craft()], 300, [contact]), advancedS: 42, warnings: ["collision_stopped"], halt };
      },
    });
    const { result } = renderHook(() => useSimulation(client, opts));
    await advance(0);
    act(() => result.current.play());
    await advance(1500);
    expect(calls).toBe(3); // the halting response was the last request
    expect(result.current.playing).toBe(false);
    expect(result.current.sim?.halt?.eventId).toBe("halt-3");
    expect(result.current.sim?.simulationTimeS).toBe(300);
    expect(result.current.events.map((e) => e.type)).toEqual(["contact"]);
    expect(result.current.actionError).toBeNull(); // a halt is a reported state, not an error
    await advance(1000);
    expect(calls).toBe(3);
  });

  it("carries manoeuvre nodes, missions and the halt of a state into the view, and empty lists when there are none", () => {
    const plain = toSimulationView(state([earth]));
    expect([plain.maneuvers, plain.missions, plain.halt]).toEqual([[], [], null]);
    const view = toSimulationView({ ...state([earth, craft()]), spaceflight: { maneuvers: [maneuver()], missions: [mission()] }, halt });
    expect(view.maneuvers[0]?.id).toBe("mnv-1");
    expect(view.missions[0]?.status).toBe("draft");
    expect(view.halt?.message).toContain("collided");
    expect(view.bodies[1]?.kind).toBe("spacecraft");
    expect(view.bodies[1]?.spacecraft?.orbit?.referenceBodyName).toBe("Earth");
  });

  it("generic mutations go through the queue and re-read state and events", async () => {
    const getState = vi.fn(async () => state([earth, craft()]));
    const getEvents = vi.fn(async () => []);
    const client = fakeClient({ getState, getEvents });
    const { result } = renderHook(() => useSimulation(client, opts));
    await advance(0);
    const task = vi.fn(async () => undefined);
    let outcome: unknown;
    await act(async () => { outcome = await result.current.mutate(task); });
    expect(outcome).toEqual({ ok: true });
    expect(task).toHaveBeenCalledTimes(1);
    expect(getState).toHaveBeenCalledTimes(2);
    expect(getEvents).toHaveBeenCalledTimes(2);
    await act(async () => { outcome = await result.current.mutate(async () => { throw new Error("the burn would start in the past"); }); });
    expect(outcome).toEqual({ ok: false, error: "the burn would start in the past" });
  });
});

describe("motion feed with spacecraft", () => {
  it("a burning or halted spacecraft is not interpolated across the step, and nothing else is cut by a burn", () => {
    const burn = { id: "burn-1", type: "maneuver" as const, simulationTimeS: 10, bodyIds: ["craft-111111111111"], maneuverId: "mnv-1", phase: "impulse" as const, mode: "impulsive" as const,
      referenceBodyId: earth.id, commandedDeltaVMPerS: 150, deliveredDeltaVMPerS: 150, propellantUsedKg: 501, missionId: null, label: "" };
    expect([...cutIdsOf([burn])]).toEqual(["craft-111111111111"]); // the reference body keeps its smooth motion
    const contact = { id: "halt-2", type: "contact" as const, simulationTimeS: 99, estimatedContactTimeS: 99, bodyIds: ["craft-111111111111", earth.id], relativeSpeedMPerS: 7933, refined: true, involvesSpacecraft: true };
    expect([...cutIdsOf([contact])].sort()).toEqual([earth.id, "craft-111111111111"].sort());
  });

  it("a spacecraft is interpolated about the body it orbits now", () => {
    const sample = toMotionSample(toSimulationView(state([earth, craft()])));
    expect(sample.bodies[1]?.primaryId).toBe(earth.id);
    expect(sample.bodies[0]?.primaryId).toBeUndefined();
  });
});
