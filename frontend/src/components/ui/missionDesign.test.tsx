// The mission-design panels and the spacecraft inspector, rendered against a fake of the spaceflight hook: what they ask the backend
// for, and that a plan, a flight and an outcome can never be mistaken for one another.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MissionDto } from "../../api/types";
import type { SpaceflightApi } from "../../sim/spaceflight/useSpaceflight";
import { toBodyView } from "../../sim/viewModel";
import { craft, leoOrbit, maneuver, mission, plan, spacecraftBlock } from "../../test/flightFixtures";
import { earth } from "../../test/fixtures";
import { describeEvent } from "./EventTimeline";
import { ManeuverPanel } from "./ManeuverPanel";
import { MissionPanel } from "./MissionPanel";
import { SpacecraftInspector } from "./SpacecraftInspector";
import { SpacecraftPanel, orbitSummary } from "./SpacecraftPanel";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const moon = { ...earth, id: "body-moon", name: "Moon", bodyType: "moon" as const, primaryId: earth.id };
const ok = async () => ({ ok: true as const, value: undefined as never });

function fakeApi(o: Partial<SpaceflightApi> = {}): SpaceflightApi {
  return {
    spacecraft: [], maneuvers: [], missions: [], trajectories: {}, planning: false,
    createSpacecraft: vi.fn(async () => ({ ok: true as const, value: { body: craft(), warnings: [] } })),
    updateSpacecraft: vi.fn(ok), addManeuver: vi.fn(ok), deleteManeuver: vi.fn(ok), createMission: vi.fn(ok), planMission: vi.fn(ok),
    commitMission: vi.fn(ok), abortMission: vi.fn(ok), deleteMission: vi.fn(ok),
    previewOrbit: vi.fn(async () => ({ ok: true as const, value: { orbit: leoOrbit, warnings: [] } })),
    previewManeuver: vi.fn(async () => ({ ok: true as const, value: {
      epochS: 0, basis: "present state", deltaVMagnitudeMPerS: 100, propellantKg: 336, burnDurationS: 0, feasible: true, before: leoOrbit,
      after: { ...leoOrbit, apoapsisAltitudeM: 756_700, eccentricity: 0.026 },
    } })),
    ...o,
  } as SpaceflightApi;
}
const name = (id: string) => ({ [earth.id]: "Earth", "body-moon": "Moon", "craft-111111111111": "Explorer 1" })[id] ?? id;
const settle = async (ms = 350) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe("SpacecraftPanel", () => {
  it("lists spacecraft with where they are and what they can still do", () => {
    const api = fakeApi({ spacecraft: [toBodyView(craft())] });
    const onSelect = vi.fn();
    render(<SpacecraftPanel api={api} bodies={[toBodyView(earth), toBodyView(craft())]} onSelect={onSelect} onCreated={() => {}} disabled={false} />);
    const row = screen.getByTestId("spacecraft-row");
    expect(row.textContent).toContain("Explorer 1");
    expect(row.textContent).toContain("Earth · 400 km × 400 km");
    expect(row.textContent).toContain("Δv 7.102 km/s");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("craft-111111111111");
  });

  it("summarises an escape and an impact trajectory in words", () => {
    expect(orbitSummary({ ...leoOrbit, regime: "escape" })).toBe("escaping Earth");
    expect(orbitSummary({ ...leoOrbit, regime: "suborbital" })).toBe("Earth · impact trajectory");
    expect(orbitSummary(null)).toBe("no body to orbit");
  });

  it("previews the orbit through the backend and creates the spacecraft from the form in SI units", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const onCreated = vi.fn();
    render(<SpacecraftPanel api={api} bodies={[toBodyView(earth), toBodyView(moon)]} onSelect={() => {}} onCreated={onCreated} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "New spacecraft…" }));
    fireEvent.change(screen.getByLabelText(/Periapsis altitude/), { target: { value: "400" } });
    fireEvent.change(screen.getByLabelText("Orbit plane"), { target: { value: moon.id } });
    expect((screen.getByLabelText(/Inclination/) as HTMLInputElement).disabled).toBe(true); // the plane comes from the Moon's orbit
    await settle();
    expect(api.previewOrbit).toHaveBeenLastCalledWith(
      { centralBodyId: earth.id, periapsisAltitudeM: 400_000, eccentricity: 0, argPeriapsisDeg: 0, trueAnomalyDeg: 0, matchPlaneOfBodyId: moon.id }, 15000);
    expect(screen.getByTestId("preview-period").textContent).toBe("1 h 32 min");
    expect(screen.getByTestId("preview-speed").textContent).toBe("7.673 km/s");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create spacecraft" })); });
    expect(api.createSpacecraft).toHaveBeenCalledWith({
      name: "Explorer 1", dryMassKg: 3000, propellantKg: 12000, thrustN: 50000, ispS: 450,
      orbit: { centralBodyId: earth.id, periapsisAltitudeM: 400_000, eccentricity: 0, argPeriapsisDeg: 0, trueAnomalyDeg: 0, matchPlaneOfBodyId: moon.id },
    });
    expect(onCreated).toHaveBeenCalledWith("craft-111111111111");
  });

  it("shows the backend's refusal of an unphysical orbit and does not create it", async () => {
    vi.useFakeTimers();
    const api = fakeApi({ previewOrbit: vi.fn(async () => ({ ok: false as const, error: "a parabolic orbit (eccentricity exactly 1) is not supported" })) });
    render(<SpacecraftPanel api={api} bodies={[toBodyView(earth)]} onSelect={() => {}} onCreated={() => {}} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "New spacecraft…" }));
    fireEvent.change(screen.getByLabelText(/Eccentricity/), { target: { value: "1" } });
    await settle();
    expect(screen.getByTestId("orbit-preview-error").textContent).toContain("parabolic");
    expect((screen.getByRole("button", { name: "Create spacecraft" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says why spacecraft cannot be added instead of offering the form", () => {
    render(<SpacecraftPanel api={fakeApi()} bodies={[toBodyView(earth)]} onSelect={() => {}} onCreated={() => {}} disabled blockedReason="Return to the live state to add a spacecraft." />);
    expect(screen.queryByRole("button", { name: "New spacecraft…" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Return to the live state");
  });
});

describe("ManeuverPanel", () => {
  it("asks for a spacecraft when none is selected", () => {
    render(<ManeuverPanel api={fakeApi()} craft={null} nowS={0} bodyName={name} disabled={false} halted={false} />);
    expect(screen.getByText("Select a spacecraft to plan a burn.")).toBeTruthy();
  });

  it("previews a burn through the backend and executes it as an impulsive node now", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    render(<ManeuverPanel api={api} craft={toBodyView(craft())} nowS={0} bodyName={name} disabled={false} halted={false} />);
    expect((screen.getByRole("button", { name: "Burn now" }) as HTMLButtonElement).disabled).toBe(true); // nothing to burn yet
    fireEvent.change(screen.getByLabelText(/Prograde/), { target: { value: "100" } });
    await settle();
    expect(api.previewManeuver).toHaveBeenLastCalledWith("craft-111111111111", { at: "now", mode: "impulsive", progradeMPerS: 100, normalMPerS: 0, radialMPerS: 0 });
    expect(screen.getByTestId("preview-apoapsis").textContent).toBe("400 km → 756.7 km");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Burn now" })); });
    expect(api.addManeuver).toHaveBeenCalledWith("craft-111111111111", { at: "now", mode: "impulsive", progradeMPerS: 100, normalMPerS: 0, radialMPerS: 0, label: "Manual burn" });
  });

  it("schedules a finite retrograde burn at the next apoapsis as a node", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    render(<ManeuverPanel api={api} craft={toBodyView(craft())} nowS={0} bodyName={name} disabled={false} halted={false} />);
    fireEvent.change(screen.getByLabelText("When"), { target: { value: "apoapsis" } });
    fireEvent.change(screen.getByLabelText("Burn"), { target: { value: "finite" } });
    fireEvent.change(screen.getByLabelText(/Prograde/), { target: { value: "-50" } });
    await settle();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add manoeuvre node" })); });
    expect(api.addManeuver).toHaveBeenCalledWith("craft-111111111111", { at: "apoapsis", mode: "finite", progradeMPerS: -50, normalMPerS: 0, radialMPerS: 0, label: "Manual node" });
  });

  it("lists nodes with their real status and offers no burns without an engine or while halted", () => {
    const api = fakeApi({ maneuvers: [
      maneuver({ id: "mnv-1", status: "planned", startS: 5000, endS: 5120, mode: "finite", label: "Raise" }),
      maneuver({ id: "mnv-2", status: "executed", deliveredDeltaVMPerS: 100, propellantUsedKg: 336, progradeMPerS: -100, label: "Lower" }),
      maneuver({ id: "mnv-3", status: "failed", failure: "no propellant on board", label: "Late" }),
      maneuver({ id: "mnv-9", spacecraftId: "craft-other" }),
    ] });
    const { rerender } = render(<ManeuverPanel api={api} craft={toBodyView(craft())} nowS={1400} bodyName={name} disabled={false} halted />);
    const nodes = screen.getAllByTestId("maneuver-node");
    expect(nodes.map((n) => n.getAttribute("data-status"))).toEqual(["failed", "executed", "planned"]); // newest first, other craft's node absent
    expect(nodes[2]!.textContent).toContain("T − 1 h 0 min");
    expect(nodes[2]!.textContent).toContain("burn 2 min 0 s");
    expect(nodes[1]!.textContent).toContain("retrograde 100 m/s");
    expect(nodes[1]!.textContent).toContain("delivered 100 m/s");
    expect(nodes[0]!.textContent).toContain("no propellant on board");
    expect(screen.getByText(/stopped at a collision/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Burn now" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<ManeuverPanel api={api} craft={toBodyView(craft({ spacecraft: spacecraftBlock({ ispS: 0, thrustN: 0 }) }))} nowS={0} bodyName={name} disabled={false} halted={false} />);
    expect(screen.getByText(/no engine/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Burn now" })).toBeNull();
  });
});

describe("MissionPanel", () => {
  const bodies = [toBodyView(earth), toBodyView(moon), toBodyView(craft())];
  const panel = (missions: MissionDto[], api = fakeApi({ spacecraft: [toBodyView(craft())], missions })) => {
    render(<MissionPanel api={api} bodies={bodies} nowS={1000} bodyName={name} disabled={false} halted={false} onPlay={() => {}} playing={false} />);
    return api;
  };

  it("creates a mission to the natural destination (a satellite of the body the spacecraft orbits) in SI units", async () => {
    const api = panel([]);
    fireEvent.click(screen.getByRole("button", { name: "New mission…" }));
    expect((screen.getByLabelText("Destination") as HTMLSelectElement).value).toBe("body-moon");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create mission" })); });
    expect(api.createMission).toHaveBeenCalledWith({
      name: "Explorer 1 to Moon", spacecraftId: "craft-111111111111", destinationBodyId: "body-moon",
      objective: { type: "orbit", periapsisAltitudeM: 100_000, direction: "prograde", toleranceM: 50_000 },
    });
  });

  it("a draft offers only to design the transfer, with the chosen options", async () => {
    const api = panel([mission()]);
    expect(screen.getByTestId("mission-status").textContent).toBe("Draft");
    expect(screen.queryByRole("button", { name: "Commit plan" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Transfer"), { target: { value: "fixed" } });
    fireEvent.change(screen.getByLabelText(/Flight time/), { target: { value: "3" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Design transfer" })); });
    expect(api.planMission).toHaveBeenCalledWith("msn-1", { burnMode: "impulsive", transferTimeS: 259200 });
  });

  it("a proposed plan is labelled a proposal, shows the planner's numbers, and can be committed", async () => {
    const api = panel([mission({ status: "planned", phase: "proposed (not committed)", plan, planRevision: 1 })]);
    expect(screen.getByTestId("mission-status").textContent).toBe("Planned · proposal");
    const facts = screen.getByTestId("mission-plan");
    expect(facts.textContent).toContain("Proposed plan (a prediction; nothing is scheduled yet)");
    expect(screen.getByTestId("plan-departure").textContent).toBe("3.115 km/s · T − 1 h 2 min");
    expect(screen.getByTestId("plan-insertion").textContent).toBe("815.6 m/s");
    expect(screen.getByTestId("plan-flight-time").textContent).toBe("3 d 24 h");
    expect(screen.getByTestId("plan-orbit").textContent).toBe("99.99 km to 100.1 km");
    expect(facts.textContent).toContain("Two-body estimate");
    expect(screen.queryByRole("button", { name: "Run the simulation" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Commit plan" })); });
    expect(api.commitMission).toHaveBeenCalledWith("msn-1");
  });

  it("a committed plan is scheduled, not completed: it offers to run or abort, never to commit again", () => {
    panel([mission({ status: "planned", phase: "awaiting departure", plan, committed: true, maneuverIds: ["mnv-1", "mnv-2"] })]);
    expect(screen.getByTestId("mission-status").textContent).toBe("Planned · scheduled");
    expect(screen.queryByRole("button", { name: "Commit plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Design/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Run the simulation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Abort mission" })).toBeTruthy();
    expect(screen.queryByTestId("mission-outcome")).toBeNull();
  });

  it("a completed mission shows the checked conditions of the actual state and the plan-versus-simulation agreement", () => {
    panel([mission({
      status: "completed", phase: "orbit verified", plan, committed: true,
      checks: [{ id: "bound", label: "Bound orbit about the destination (eccentricity < 1)", ok: true, actual: 0.00004, target: "< 1", tolerance: null, unit: "" },
        { id: "periapsis", label: "Periapsis altitude within tolerance", ok: true, actual: 99_950, target: 100_000, tolerance: 50_000, unit: "m" }],
      agreement: [{ maneuverId: "mnv-2", role: "insertion", positionDifferenceM: 0.00003, velocityDifferenceMPerS: 1.8e-8, positionToleranceM: 1000, velocityToleranceMPerS: 1, ok: true }],
    })]);
    expect(screen.getByTestId("mission-status").textContent).toBe("Completed");
    const checks = within(screen.getByTestId("mission-checks")).getAllByRole("listitem");
    expect(checks.map((c) => c.getAttribute("data-ok"))).toEqual(["true", "true"]);
    expect(checks[1]!.textContent).toContain("actual 99.95 km, target 100 km ± 50 km");
    expect(screen.getByTestId("mission-agreement").textContent).toContain("Before the insertion");
    expect(screen.getByTestId("mission-agreement").textContent).toContain("Tolerance 1 km and 1 m/s");
    expect(screen.getByTestId("mission-outcome").textContent).toContain("hold in the simulated state, not only in the plan");
    expect(screen.queryByRole("button", { name: "Abort mission" })).toBeNull();
  });

  it("an unsuccessful mission says so and why, with the conditions that were not met", () => {
    panel([mission({
      status: "failed", phase: "failed", plan, committed: true, reasons: ["the spacecraft reached the destination but was not captured into orbit: bound orbit not met"],
      checks: [{ id: "bound", label: "Bound orbit about the destination (eccentricity < 1)", ok: false, actual: 1.31, target: "< 1", tolerance: null, unit: "" }],
    })]);
    expect(screen.getByTestId("mission-status").textContent).toBe("Unsuccessful");
    expect(screen.getByTestId("mission-reasons").textContent).toContain("was not captured into orbit");
    expect(within(screen.getByTestId("mission-checks")).getByRole("listitem").getAttribute("data-ok")).toBe("false");
    expect(screen.queryByTestId("mission-outcome")).toBeNull();
  });

  it("an unsupported mission is reported as unsupported with the planner's reason, and can be redesigned or deleted", () => {
    panel([mission({ status: "unsupported", phase: "not supported", reasons: ["Interplanetary transfers (escape, heliocentric cruise, arrival) are not implemented."] })]);
    expect(screen.getByTestId("mission-status").textContent).toBe("Unsupported");
    expect(screen.getByTestId("mission-reasons").textContent).toContain("not implemented");
    expect(screen.queryByTestId("mission-plan")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("a spacecraft with an open mission cannot be given a second one", () => {
    panel([mission({ status: "in_progress", committed: true, plan, phase: "coasting to Moon" })]);
    expect((screen.getByRole("button", { name: "New mission…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("mission-status").textContent).toBe("In progress");
    expect(screen.getByTestId("mission-phase").textContent).toBe("coasting to Moon");
  });
});

describe("SpacecraftInspector", () => {
  const props = { onUpdate: vi.fn(async () => ({ ok: true as const })), onDelete: vi.fn(async () => ({ ok: true as const })), onFocus: vi.fn(), onOpenMissions: vi.fn() };

  it("shows the orbit and propulsion the backend reported, and that this is a spacecraft", () => {
    render(<SpacecraftInspector craft={toBodyView(craft())} {...props} />);
    expect(screen.getByTestId("spacecraft-kind").textContent).toBe("Spacecraft · orbiting Earth");
    expect(screen.getByTestId("readout-altitude").textContent).toBe("400 km");
    expect(screen.getByTestId("readout-orbital-speed").textContent).toBe("7.673 km/s");
    expect(screen.getByTestId("readout-period").textContent).toBe("1 h 32 min");
    expect(screen.getByTestId("readout-eccentricity").textContent).toBe("0.00000");
    expect(screen.getByTestId("readout-delta-v").textContent).toBe("7.102 km/s");
    expect(screen.getByTestId("readout-propellant").textContent).toBe("12,000 kg of 12,000 kg");
    expect(screen.getByTestId("element-inclination").textContent).toBe("51.6°");
    expect(screen.getByRole("meter", { name: "Propellant" }).getAttribute("aria-valuenow")).toBe("12000");
    expect(screen.queryByTestId("regime-note")).toBeNull();
  });

  it("warns about an escape or an impact trajectory in words", () => {
    const escaping = { ...leoOrbit, regime: "escape" as const, apoapsisAltitudeM: null, apoapsisRadiusM: null, periodS: null };
    const { rerender } = render(<SpacecraftInspector craft={toBodyView(craft({ spacecraft: spacecraftBlock({ orbit: escaping }) }))} {...props} />);
    expect(screen.getByTestId("spacecraft-kind").textContent).toBe("Spacecraft · leaving Earth");
    expect(screen.getByTestId("readout-apoapsis").textContent).toBe("none (escape)");
    expect(screen.getByTestId("regime-note").textContent).toContain("escape trajectory");
    rerender(<SpacecraftInspector craft={toBodyView(craft({ spacecraft: spacecraftBlock({ orbit: { ...leoOrbit, regime: "suborbital" } }) }))} {...props} />);
    expect(screen.getByTestId("regime-note").textContent).toContain("it will impact");
  });

  it("edits propulsion through the spacecraft route and asks before deleting", async () => {
    render(<SpacecraftInspector craft={toBodyView(craft())} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit propulsion" }));
    fireEvent.change(screen.getByLabelText(/Propellant/, { selector: "input" }), { target: { value: "9000" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply" })); });
    expect(props.onUpdate).toHaveBeenCalledWith("craft-111111111111", { dryMassKg: 3000, propellantKg: 9000, thrustN: 50000, ispS: 450 });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete spacecraft" })); });
    expect(props.onDelete).toHaveBeenCalledWith("craft-111111111111");
  });

  it("blocks edits while playing and shows the mission the spacecraft is flying", () => {
    render(<SpacecraftInspector craft={toBodyView(craft())} mission={mission({ status: "in_progress", committed: true, phase: "coasting to Moon" })}
      editBlockedReason="Pause to edit: changes are applied between steps." {...props} />);
    expect((screen.getByRole("button", { name: "Edit propulsion" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("mission-status").textContent).toBe("In progress");
    expect(screen.getByText("coasting to Moon")).toBeTruthy();
  });
});

describe("event descriptions", () => {
  it("a burn and a contact are described from the backend's fields", () => {
    const burn = { id: "burn-1", type: "maneuver" as const, simulationTimeS: 10, bodyIds: ["craft-111111111111"], maneuverId: "mnv-1", phase: "impulse" as const, mode: "impulsive" as const,
      referenceBodyId: earth.id, commandedDeltaVMPerS: 150, deliveredDeltaVMPerS: 150, propellantUsedKg: 501, missionId: null, label: "raise" };
    expect(describeEvent(burn, name)).toBe("Explorer 1: impulsive burn, 150.0 m/s delivered of 150.0 m/s commanded (frame of Earth)");
    expect(describeEvent({ ...burn, phase: "ignition" }, name)).toContain("ignited its engine for a 150.0 m/s burn");
    const contact = { id: "halt-2", type: "contact" as const, simulationTimeS: 99, estimatedContactTimeS: 99, bodyIds: ["craft-111111111111", earth.id], relativeSpeedMPerS: 7933, refined: true, involvesSpacecraft: true };
    expect(describeEvent(contact, name)).toContain("Explorer 1 and Earth came into contact at 7.93e+3 m/s");
    expect(describeEvent(contact, name)).toContain("nothing was merged or broken");
  });
});
