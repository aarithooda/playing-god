import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseCollisionDetail, parseVisualEvent } from "../../api/parse";
import { toEventView } from "../viewModel";
import { describeRecord } from "./describe";
import { allocate } from "./effectBudget";
import { useCollisionEffects, SURFACE_MARK_DISPLAY_RAD } from "./useCollisionEffects";
import { fakeClient } from "../../test/fixtures";
import type { CollisionEventDto } from "../../api/types";

const visual = parseVisualEvent({
  eventId: "col-1", outcome: "partial_accretion", timeS: 1000,
  impactSite: { bodyId: "t", centerLocal: { x: 0, y: 0, z: -1 }, centerWorldAtContactM: { x: 5, y: 6, z: 7 }, normalWorld: { x: 0, y: 0, z: -1 } },
  phases: [
    { name: "contact", startS: 1000, endS: 1001, basis: "simulation-time" },
    { name: "flash", startS: 1000, endS: null, basis: "visual-wall-clock", durationWallS: 0.3 },
    { name: "ejecta", startS: 1000, endS: null, basis: "simulation-time" },
    { name: "aftermath", startS: 1001, endS: null, basis: "simulation-time" },
  ],
  ejectaSources: [], fragmentBodyIds: [], debrisParcelIds: ["p0"], cloud: null,
  visualOnly: [{ kind: "flash", intensity: 0.6, lifetimeWallS: 0.3 }], materialAppearance: { t: "ice" }, fidelityNotes: [],
});

const event = {
  id: "col-1", type: "collision", schemaVersion: 1, outcome: "partial_accretion", simulationTimeS: 1001, estimatedContactTimeS: 1000,
  bodyIds: ["t", "p"], survivingBodyIds: ["t"], createdBodyIds: ["p0"], removedBodyIds: ["p"], parentEventId: null, rootEventId: "col-1", generation: 0,
  modelId: "ls12", modelVersion: "1", impactSpeedMPerS: 1, impactAngleDeg: 1, specificImpactEnergyJPerKg: 1, largestRemnantMassKg: 1, debrisMassKg: 1,
  massResidualRel: 0, momentumResidualRel: 0, warnings: [], fidelitySummary: {}, hasVisual: true,
} as CollisionEventDto;

const bodies = [
  { id: "t", positionM: { x: 0, y: 0, z: 0 }, radiusM: 1e6 },
  { id: "p0", positionM: { x: 1e7, y: 0, z: 0 }, radiusM: 1e5 },
];

function setup(props: { displayTimeS: number; seekKey: string; advancing: boolean }) {
  const getCollisionVisual = vi.fn().mockResolvedValue(visual);
  const client = fakeClient({ getCollisionVisual } as never).scoped({ universeId: "uni-1", activationEpoch: 1 });
  const hook = renderHook((p: typeof props) => useCollisionEffects({ client, events: [toEventView(event)], bodies, enabled: true, ...p }), { initialProps: props });
  return { hook, getCollisionVisual };
}

const sleep = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

describe("useCollisionEffects", () => {
  it("fetches the description once and produces an effect, a surface mark and samples at the displayed time", async () => {
    const { hook, getCollisionVisual } = setup({ displayTimeS: 1500, seekKey: "live", advancing: false });
    await waitFor(() => expect(hook.result.current.effects).toHaveLength(1));
    const [e] = hook.result.current.effects;
    expect(e!.eventId).toBe("col-1");
    expect(e!.particles.length).toBeGreaterThan(0);
    expect(e!.label).toMatch(/visual/);
    expect(hook.result.current.marks).toEqual([
      { key: "uni-1:col-1:site", bodyId: "t", centerLocal: { x: 0, y: 0, z: -1 }, angularRadiusRad: SURFACE_MARK_DISPLAY_RAD, colorHex: "#d9eefc" },
    ]);
    hook.rerender({ displayTimeS: 1600, seekKey: "live", advancing: false });
    expect(getCollisionVisual).toHaveBeenCalledTimes(1);
  });

  it("shows nothing at a displayed time before the event", async () => {
    const { hook } = setup({ displayTimeS: 500, seekKey: "history:0", advancing: false });
    await sleep(30);
    expect(hook.result.current.effects).toEqual([]);
    expect(hook.result.current.marks).toEqual([]);
  });

  it("keeps the flash's remaining life while paused, however long the pause", async () => {
    const { hook } = setup({ displayTimeS: 1500, seekKey: "live", advancing: false });
    await waitFor(() => expect(hook.result.current.effects).toHaveLength(1));
    const before = hook.result.current.effects[0]!.flash;
    expect(before?.remaining01).toBe(1);
    await sleep(500); // longer than the flash's whole life (0.3 s) of wall-clock time
    hook.rerender({ displayTimeS: 1500, seekKey: "live", advancing: false });
    expect(hook.result.current.effects[0]!.flash).toEqual(before);
  });

  it("lets the flash run out while the display advances, then a seek past it shows none and a seek back restarts it", async () => {
    const { hook } = setup({ displayTimeS: 1500, seekKey: "live", advancing: true });
    await waitFor(() => expect(hook.result.current.effects).toHaveLength(1));
    await waitFor(() => expect(hook.result.current.effects[0]!.flash).toBeUndefined(), { timeout: 2000 }); // 0.3 s of advancing wall time
    expect(hook.result.current.effects[0]!.particles.length).toBeGreaterThan(0); // the material effects stay
    hook.rerender({ displayTimeS: 400, seekKey: "history:1", advancing: false }); // seek back before the event
    expect(hook.result.current.effects).toEqual([]);
    hook.rerender({ displayTimeS: 1000, seekKey: "history:2", advancing: false }); // seek to the event time: fresh
    await waitFor(() => expect(hook.result.current.effects[0]?.flash?.remaining01).toBe(1));
    hook.rerender({ displayTimeS: 3000, seekKey: "history:3", advancing: false }); // seek forward past it
    await waitFor(() => expect(hook.result.current.effects[0]!.flash).toBeUndefined());
  });

  it("does nothing when disabled", async () => {
    const getCollisionVisual = vi.fn().mockResolvedValue(visual);
    const client = fakeClient({ getCollisionVisual } as never).scoped({ universeId: "uni-1", activationEpoch: 1 });
    const { result } = renderHook(() => useCollisionEffects({ client, events: [toEventView(event)], bodies, displayTimeS: 1500, seekKey: "live", advancing: false, enabled: false }));
    await sleep(20);
    expect(result.current).toEqual({ effects: [], marks: [] });
    expect(getCollisionVisual).not.toHaveBeenCalled();
  });

  it("treats a missing description (a legacy merge or a dropped record) as nothing to draw", async () => {
    const getCollisionVisual = vi.fn().mockRejectedValue(new Error("404"));
    const client = fakeClient({ getCollisionVisual } as never).scoped({ universeId: "uni-1", activationEpoch: 1 });
    const { result } = renderHook(() => useCollisionEffects({ client, events: [toEventView(event)], bodies, displayTimeS: 1500, seekKey: "live", advancing: false, enabled: true }));
    await sleep(30);
    expect(getCollisionVisual).toHaveBeenCalledOnce();
    expect(result.current.effects).toEqual([]);
  });
});

describe("the inspector's numbers do not depend on the effects", () => {
  const detail = parseCollisionDetail({
    childEventIds: [], products: [], escapedLedger: null, note: "n",
    record: {
      eventId: "col-1", legacyEventId: null, parentEventId: null, rootEventId: "col-1", generation: 0, selectionReasons: ["r"], warnings: [], fidelity: { outcome: "model" },
      inputDigest: "a".repeat(64), resultDigest: "b".repeat(64),
      input: { impact: { detectionTimeS: 1, target: { id: "t", massKg: 2e22, materialProfile: null }, projectile: { id: "p", massKg: 1e21, materialProfile: null },
        impactSpeedMPerS: 1, impactAngleDeg: 1, specificImpactEnergyJPerKg: 1, contactPointM: { x: 0, y: 0, z: 0 } } },
      outcomeSpec: null,
      result: { removedBodyIds: [], transformed: [{ id: "t" }], created: [], debrisParcels: [{ id: "p0" }],
        massLedger: { consumedBodiesKg: 2.1e22, remnantsKg: 2e22, fragmentsKg: 0, parcelsKg: 1e21, escapedKg: 0, returnedToRemnantKg: 0 },
        conservation: { massResidualRel: 0, momentumResidualRel: 0, angularMomentumResidualRel: 0, angularMomentumUnmodelled: null, energy: { dissipatedJ: 1, dissipatedNonNegative: true }, withinTolerance: true } },
    },
  });

  it("is identical at every level of detail and with the effects on or off", () => {
    const before = JSON.stringify(describeRecord(detail, (id) => id));
    for (const n of [0, 1, 3, 6, 8, 40]) allocate(Array.from({ length: n }, (_, i) => `e${i}`)); // every LOD tier
    expect(JSON.stringify(describeRecord(detail, (id) => id))).toBe(before);
    expect(describeRecord.length).toBe(2); // it takes the record and a name function: there is no way to hand it an effect
    expect(detail.record.result?.massLedger.parcelsKg).toBe(1e21);
  });
});
