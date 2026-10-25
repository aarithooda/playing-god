import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { earth, mergerEvent, sun } from "../../test/fixtures";
import { toBodyView, toEventView } from "../../sim/viewModel";
import { BodyInspector } from "./BodyInspector";
import { CreateBodyPanel } from "./CreateBodyPanel";
import { SimulationBar } from "./SimulationBar";
import type { ViewControlContract } from "../../sim/viewControlContract";
import { EventTimeline } from "./EventTimeline";

afterEach(cleanup);

const ok = async (..._args: unknown[]) => ({ ok: true }) as const;

describe("BodyInspector", () => {
  it("renders nothing without a selection", () => {
    const { container } = render(<BodyInspector body={null} onSave={ok} onDelete={ok} onFocus={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("labels radius in metres and shows the confirmed SI values", () => {
    render(<BodyInspector body={toBodyView(earth)} onSave={ok} onDelete={ok} onFocus={() => {}} />);
    expect((screen.getByLabelText("Physical radius (m)") as HTMLInputElement).value).toBe("6.371e6");
    expect(screen.queryByText(/km/)).toBeNull();
    expect(screen.getByTestId("inspect-visual-radius").textContent).toMatch(/Rendered visual radius: .* scene units/);
    expect((screen.getByLabelText("Mass (kg)") as HTMLInputElement).value).toBe("5.972e24");
  });

  it("PATCHes only the edited field and clears the draft on success", async () => {
    const onSave = vi.fn(ok);
    render(<BodyInspector body={toBodyView(earth)} onSave={onSave} onDelete={ok} onFocus={() => {}} />);
    const mass = screen.getByLabelText("Mass (kg)") as HTMLInputElement;
    fireEvent.change(mass, { target: { value: "7.3e22" } });
    fireEvent.click(screen.getByText("Apply"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(earth.id, { massKg: 7.3e22 }));
    await waitFor(() => expect(mass.value).toBe("5.972e24")); // back to confirmed state
  });

  it("validates locally and does not call the API for invalid input", () => {
    const onSave = vi.fn(ok);
    render(<BodyInspector body={toBodyView(earth)} onSave={onSave} onDelete={ok} onFocus={() => {}} />);
    fireEvent.change(screen.getByLabelText("Physical radius (m)"), { target: { value: "-3" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Must be > 0/)).toBeTruthy();
    expect((screen.getByLabelText("Physical radius (m)") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByLabelText("Physical radius (m)") as HTMLInputElement).getAttribute("aria-describedby")).toBe("inspect-radius-error");
  });

  it("keeps the draft and shows the server error when the backend rejects the edit", async () => {
    const onSave = vi.fn(async (..._args: unknown[]) => ({ ok: false, error: "massKg: too large" }) as const);
    render(<BodyInspector body={toBodyView(earth)} onSave={onSave} onDelete={ok} onFocus={() => {}} />);
    const mass = screen.getByLabelText("Mass (kg)") as HTMLInputElement;
    fireEvent.change(mass, { target: { value: "1e30" } });
    fireEvent.click(screen.getByText("Apply"));
    await screen.findByText("massKg: too large");
    expect(mass.value).toBe("1e30");
  });

  it("untouched fields follow live backend updates while a draft field is preserved", () => {
    const { rerender } = render(<BodyInspector body={toBodyView(earth)} onSave={ok} onDelete={ok} onFocus={() => {}} />);
    fireEvent.change(screen.getByLabelText("Mass (kg)"), { target: { value: "123" } });
    const moved = { ...toBodyView(earth), positionM: { x: 1e11, y: 2e10, z: 0 } };
    rerender(<BodyInspector body={moved} onSave={ok} onDelete={ok} onFocus={() => {}} />);
    expect((screen.getByLabelText("Mass (kg)") as HTMLInputElement).value).toBe("123");
    expect((screen.getByLabelText("Position (m) X") as HTMLInputElement).value).toBe("1e11");
    expect((screen.getByLabelText("Position (m) Y") as HTMLInputElement).value).toBe("2e10");
  });

  it("requires explicit confirmation before deleting a body", async () => {
    const onDelete = vi.fn(ok);
    render(<BodyInspector body={toBodyView(sun)} onSave={ok} onDelete={onDelete} onFocus={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete Sun?")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep body" }));
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete body" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(sun.id));
  });
});

const viewControls: ViewControlContract = {
  state: { axesVisible: false, gridEnabled: false, gridShownForPlacement: false, canFitView: true, canFocusSelected: false },
  actions: { setAxesVisible: () => {}, setGridVisible: () => {}, fitView: () => {}, focusSelected: () => {} },
};

describe("SimulationBar", () => {
  const bar = {
    playing: false,
    stepping: false,
    canRun: true,
    disabled: false,
    simulationTimeS: 3600,
    speedExp: 5,
    stepSeconds: 1e5,
    onSpeedChange: () => {},
    onPlay: () => {},
    onPause: () => {},
    onStep: () => {},
    onReset: () => {},
    viewControls,
  };

  it("wires Play / Pause / Step / Reset to handlers", () => {
    const h = { onPlay: vi.fn(), onPause: vi.fn(), onStep: vi.fn(), onReset: vi.fn() };
    const { rerender } = render(<SimulationBar {...bar} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Step Forward" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset Universe" }));
    expect(h.onReset).not.toHaveBeenCalled(); // reset discards the state: it asks for a second press
    fireEvent.click(screen.getByRole("button", { name: /Confirm reset/ }));
    expect([h.onPlay, h.onStep, h.onReset].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
    rerender(<SimulationBar {...bar} {...h} playing />);
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull(); // one control: it shows the action that applies now
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(h.onPause).toHaveBeenCalledTimes(1);
  });

  it("disables Play and Step when there is nothing to simulate", () => {
    render(<SimulationBar {...bar} canRun={false} />);
    expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Step Forward" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the confirmed simulated time, the step size and the run state", () => {
    const { rerender } = render(<SimulationBar {...bar} simulationTimeS={100000} />);
    expect(screen.getByText(/Sim time: 1.16 d/)).toBeTruthy();
    expect(screen.getByTestId("sim-time").textContent).toBe("1.16 d");
    expect(screen.getByLabelText(/Sim Speed: 1.16 d per step/)).toBeTruthy();
    expect(screen.getByTestId("sim-state").textContent).toBe("Paused");
    rerender(<SimulationBar {...bar} playing />);
    expect(screen.getByTestId("sim-state").textContent).toBe("Running");
    rerender(<SimulationBar {...bar} historyView onReturnToLive={() => {}} />);
    expect(screen.getByTestId("sim-state").textContent).toBe("Showing history");
    expect((screen.getByRole("button", { name: "Step Forward" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reset Universe" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("never invents a time before the backend reports one, and makes no rate claim while paused", () => {
    render(<SimulationBar {...bar} simulationTimeS={null} disabled />);
    expect(screen.getByTestId("sim-time").textContent).toBe("—");
    expect(screen.getByTestId("sim-rate").textContent).toBe("");
    expect(screen.getByTestId("sim-state").textContent).toBe("Waiting for the simulation");
  });

  it("offers ambient sound only as an explicit, unpressed toggle", () => {
    const toggle = vi.fn();
    render(<SimulationBar {...bar} sound={{ on: false, available: true, toggle }} />);
    const button = screen.getByRole("button", { name: "Ambient sound" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});

describe("CreateBodyPanel", () => {
  const base = { disabled: false, onCreate: ok };

  it("creates a body from validated SI inputs", async () => {
    const onCreate = vi.fn(ok);
    render(<CreateBodyPanel {...base} onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Add body…"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Moon" } });
    fireEvent.change(screen.getByLabelText("Mass (kg)"), { target: { value: "7.342e22" } });
    fireEvent.submit(screen.getByRole("form", { name: "Create body" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      name: "Moon",
      massKg: 7.342e22,
      radiusM: 6.371e6,
      positionM: { x: 1.496e11, y: 0, z: 0 },
      velocityMPerS: { x: 0, y: 29780, z: 0 },
    });
  });

  it("does not call the API for an invalid new body and shows backend rejections", async () => {
    const onCreate = vi.fn(async (..._args: unknown[]) => ({ ok: false, error: "name: too long" }) as const);
    render(<CreateBodyPanel {...base} onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Add body…"));
    fireEvent.change(screen.getByLabelText("Mass (kg)"), { target: { value: "0" } });
    fireEvent.submit(screen.getByRole("form", { name: "Create body" }));
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Mass (kg)"), { target: { value: "1e20" } });
    fireEvent.submit(screen.getByRole("form", { name: "Create body" }));
    await screen.findByText("name: too long");
  });

  it("starts and cancels 3D placement from the position fields", () => {
    const onPlacementModeChange = vi.fn();
    const { rerender } = render(<CreateBodyPanel {...base} onPlacementModeChange={onPlacementModeChange} />);
    fireEvent.click(screen.getByText("Add body…"));
    fireEvent.click(screen.getByText("Choose position in 3D"));
    expect(onPlacementModeChange).toHaveBeenLastCalledWith(true);

    rerender(<CreateBodyPanel {...base} placementMode onPlacementModeChange={onPlacementModeChange} />);
    fireEvent.click(screen.getByText("Cancel 3D placement"));
    expect(onPlacementModeChange).toHaveBeenLastCalledWith(false);
  });

  it("creates a body immediately at the picked 3D position", async () => {
    const onCreate = vi.fn(ok);
    const { rerender } = render(<CreateBodyPanel {...base} onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Add body…"));
    rerender(<CreateBodyPanel {...base} onCreate={onCreate} pickedPosition={{ position: { x: 1.2e11, y: -3e10, z: 7e9 }, nonce: 1 }} />);
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
        positionM: { x: 1.2e11, y: -3e10, z: 7e9 },
      }));
    });
  });
});

describe("EventTimeline", () => {
  it("shows an empty state with no fabricated events", () => {
    render(<EventTimeline events={[]} bodyName={(id) => id} />);
    expect(screen.getByText("No events yet.")).toBeTruthy();
    expect(screen.queryAllByTestId("event-item")).toHaveLength(0);
  });

  it("renders real merger events with names, simulation time, and result mass", () => {
    const names: Record<string, string> = { [sun.id]: "Sun", [earth.id]: "Earth" };
    render(<EventTimeline events={[toEventView(mergerEvent)]} bodyName={(id) => names[id] ?? id} />);
    const item = screen.getByTestId("event-item");
    expect(item.textContent).toContain("MERGER");
    expect(item.textContent).toContain("Earth merged into Sun");
    expect(item.textContent).toContain("t = 2 h");
    expect(item.textContent).toContain("1.989e+30 kg");
    expect(item.textContent).toContain("relative speed at detection");
    expect(item.textContent).toContain("detected at t = 2 h");
    expect(item.textContent).toContain("estimated contact t = 1.94 h");
    expect(item.textContent).not.toMatch(/relative speed at (estimated )?contact/);
    expect(item.textContent).toContain("straight-line estimate, not exact; detection time is at integrator-step granularity");
    expect(item.textContent).toContain("spin booked (0, 0, 1.000e40) kg·m²/s");
    expect(item.textContent).toContain("no rotation dynamics");
  });

  it("lets an event highlight its still-active surviving body", () => {
    const onSelectBody = vi.fn();
    render(
      <EventTimeline
        events={[toEventView(mergerEvent)]}
        bodyName={(id) => id === sun.id ? "Sun" : id}
        activeBodyIds={new Set([mergerEvent.resultBodyId])}
        onSelectBody={onSelectBody}
      />,
    );

    const highlight = screen.getByRole("button", { name: "Highlight surviving body Sun" });
    expect(highlight.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(highlight);
    expect(onSelectBody).toHaveBeenCalledWith(mergerEvent.resultBodyId);
  });

  it("does not offer selection for a merger result absent from the current backend state", () => {
    render(
      <EventTimeline
        events={[toEventView(mergerEvent)]}
        bodyName={(id) => id}
        activeBodyIds={new Set()}
        onSelectBody={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /Highlight surviving body/ })).toBeNull();
  });

  it("labels an unavailable contact estimate without inventing a timestamp", () => {
    render(<EventTimeline events={[toEventView({ ...mergerEvent, estimatedContactTimeS: null })]} bodyName={(id) => id} />);
    expect(screen.getByTestId("event-item").textContent).toContain("estimated contact unavailable");
  });
});
