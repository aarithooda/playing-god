import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/errors";
import { parseEventDto, parseEventList, parseStepResponse } from "../../api/parse";
import type { CollisionEventDto } from "../../api/types";
import { eventFocusBodyId, mergeEvents, toEventView } from "../../sim/viewModel";
import { earth, mergerEvent, stepResponse, sun } from "../../test/fixtures";
import { describeEvent, describeFidelity, EventTimeline } from "./EventTimeline";

afterEach(cleanup);

const collision: CollisionEventDto = {
  id: "col-3",
  type: "collision",
  schemaVersion: 1,
  outcome: "partial_erosion",
  simulationTimeS: 7200,
  estimatedContactTimeS: 7100,
  bodyIds: [sun.id, earth.id],
  survivingBodyIds: [sun.id],
  createdBodyIds: ["debris-3-0"],
  removedBodyIds: [earth.id],
  parentEventId: null,
  rootEventId: "col-3",
  generation: 0,
  modelId: "ls12",
  modelVersion: "1-provisional",
  impactSpeedMPerS: 12345.6,
  impactAngleDeg: 30,
  specificImpactEnergyJPerKg: 8.1e5,
  largestRemnantMassKg: 9.5e21,
  debrisMassKg: 5.0e20,
  massResidualRel: 0,
  momentumResidualRel: 2e-16,
  warnings: ["provisional:CP-SCI-1", "debris_launch_speed_placeholder"],
  fidelitySummary: { outcome: "model", remnantMasses: "model", placement: "approximation" },
  hasVisual: false,
};

describe("collision events (Stage 4)", () => {
  it("parses a collision event and keeps merger events unchanged", () => {
    expect(parseEventDto(collision)).toEqual(collision);
    expect(parseEventDto(mergerEvent)).toEqual(mergerEvent);
    const list = parseEventList({ events: [mergerEvent, collision] });
    expect(list.events.map((e) => e.type)).toEqual(["merger", "collision"]);
    const step = parseStepResponse(stepResponse([sun], 100, [collision]));
    expect(step.events[0]).toEqual(collision);
  });

  it("still rejects unknown event types and malformed collision events", () => {
    expect(() => parseEventDto({ ...collision, type: "explosion" })).toThrow(ApiError);
    expect(() => parseEventDto({ ...collision, outcome: 3 })).toThrow(/event.outcome/);
    expect(() => parseEventDto({ ...collision, survivingBodyIds: "x" })).toThrow(/survivingBodyIds/);
    expect(() => parseEventDto({ ...collision, massResidualRel: NaN })).toThrow(/massResidualRel/);
    expect(() => parseEventDto({ ...collision, fidelitySummary: { outcome: 1 } })).toThrow(/fidelitySummary/);
    expect(() => parseEventDto({ ...collision, fidelitySummary: null })).toThrow(/fidelitySummary/);
  });

  it("accepts a null estimated contact time and a parent link", () => {
    const e = parseEventDto({ ...collision, estimatedContactTimeS: null, parentEventId: "col-1", generation: 1 }) as CollisionEventDto;
    expect(e.estimatedContactTimeS).toBeNull();
    expect(e.parentEventId).toBe("col-1");
  });

  it("builds a view that copies the arrays and dedupes by id next to merger events", () => {
    const view = toEventView(collision);
    expect(view.type).toBe("collision");
    if (view.type !== "collision") throw new Error("unreachable");
    view.survivingBodyIds.push("x");
    expect(collision.survivingBodyIds).toEqual([sun.id]);
    const once = mergeEvents(mergeEvents([], [toEventView(mergerEvent)]), [toEventView(collision)]);
    expect(once.map((e) => e.id)).toEqual(["evt-1", "col-3"]);
    expect(mergeEvents(once, [toEventView(collision)])).toBe(once);
  });

  it("chooses the body to highlight from API fields only", () => {
    expect(eventFocusBodyId(toEventView(mergerEvent))).toBe(mergerEvent.resultBodyId);
    expect(eventFocusBodyId(toEventView(collision))).toBe(sun.id);
    expect(eventFocusBodyId(toEventView({ ...collision, survivingBodyIds: [] }))).toBe("debris-3-0");
    expect(eventFocusBodyId(toEventView({ ...collision, survivingBodyIds: [], createdBodyIds: [] }))).toBeUndefined();
  });

  it("describes the outcome, speed and angle from backend fields", () => {
    const names: Record<string, string> = { [sun.id]: "Sun", [earth.id]: "Earth" };
    expect(describeEvent(toEventView(collision), (id) => names[id] ?? id)).toBe("Partial erosion: Earth hit Sun at 1.23e+4 m/s relative speed at detection, 30.0° from the normal");
    expect(describeEvent(toEventView({ ...collision, outcome: "something_new" }), (id) => id)).toContain("something_new");
    expect(describeFidelity(collision.fidelitySummary)).toBe("outcome: model · remnantMasses: model · placement: approximation");
  });

  it("renders fidelity labels, model, residuals and warnings so an approximation is never shown as computed", () => {
    render(<EventTimeline events={[toEventView(mergerEvent), toEventView(collision)]} bodyName={(id) => id} />);
    const items = screen.getAllByTestId("event-item");
    expect(items).toHaveLength(2);
    const text = items[0].textContent ?? "";  // newest first
    expect(text).toContain("COLLISION · col-3");
    expect(text).toContain("largest remnant 9.500e+21 kg");
    expect(text).toContain("debris 5.000e+20 kg");
    expect(text).toContain("model ls12 1-provisional");
    expect(screen.getByTestId("event-fidelity").textContent).toContain("placement: approximation");
    expect(screen.getByTestId("event-warnings").textContent).toContain("provisional:CP-SCI-1");
    expect(items[1].textContent).toContain("MERGER");
    expect(items[1].textContent).toContain("spin booked");
  });

  it("lets a collision event highlight a surviving body that is still present", () => {
    const onSelectBody = vi.fn();
    render(<EventTimeline events={[toEventView(collision)]} bodyName={(id) => `name:${id}`} activeBodyIds={new Set([sun.id])} onSelectBody={onSelectBody} />);
    fireEvent.click(screen.getByRole("button", { name: `Highlight surviving body name:${sun.id}` }));
    expect(onSelectBody).toHaveBeenCalledWith(sun.id);
    cleanup();
    render(<EventTimeline events={[toEventView(collision)]} bodyName={(id) => id} activeBodyIds={new Set()} onSelectBody={onSelectBody} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("the inspect button (Stage 8)", () => {
  it("is offered for collision events only, and asks to inspect that event", () => {
    const onInspect = vi.fn();
    render(<EventTimeline events={[toEventView(mergerEvent), toEventView(collision)]} bodyName={(id) => id} onInspect={onInspect} />);
    expect(screen.queryByLabelText(`Inspect collision ${mergerEvent.id}`)).toBeNull();
    fireEvent.click(screen.getByLabelText("Inspect collision col-3"));
    expect(onInspect).toHaveBeenCalledWith("col-3");
  });

  it("is absent when no handler is given", () => {
    render(<EventTimeline events={[toEventView(collision)]} bodyName={(id) => id} />);
    expect(screen.queryByText("Inspect record")).toBeNull();
  });
});
