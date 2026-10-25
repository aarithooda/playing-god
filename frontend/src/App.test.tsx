import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { earth, sun } from "./test/fixtures";
import { openTool, waitForWorkspace } from "./test/appHelpers";

const h = vi.hoisted(() => ({ stateMode: "normal" as "normal" | "hang" | "fail-once", failed: false, empty: false, canvasProps: { current: null as any }, calls: [] as string[] }));

vi.mock("./components/canvas/UniverseCanvas", () => ({
  UniverseCanvas: (props: any) => {
    // Record every callback the canvas could be asked to run, so tests can prove panels never trigger them.
    h.canvasProps.current = {
      ...props,
      onClearSelection: (...a: unknown[]) => (h.calls.push("clear"), props.onClearSelection(...a)),
      onPlacementConfirm: (...a: unknown[]) => (h.calls.push("confirm"), props.onPlacementConfirm(...a)),
      onSelectBody: (...a: unknown[]) => (h.calls.push("select"), props.onSelectBody(...a)),
    };
    return <div data-testid="canvas" />;
  },
}));
vi.mock("./api/client", async () => {
  const fx = await import("./test/fixtures");
  const { ApiError } = await import("./api/errors");
  return {
    createApiClient: () =>
      fx.fakeClient({
        getState: async () => {
          if (h.stateMode === "hang") return new Promise<never>(() => {}); // backend reachable, simulation silent
          if (h.stateMode === "fail-once" && !h.failed) {
            h.failed = true;
            throw new ApiError("timeout", "The backend did not answer GET /api/v1/simulation/state within 8 s");
          }
          return fx.state(h.empty ? [] : [fx.sun, fx.earth]);
        },
      }),
  };
});

import App from "./App";

const canvas = () => h.canvasProps.current;
const setWidth = (w: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  act(() => void window.dispatchEvent(new Event("resize")));
};

beforeEach(() => {
  h.empty = false;
  h.stateMode = "normal";
  h.failed = false;
  h.calls.length = 0;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
});
afterEach(cleanup);

describe("App layout", () => {
  it("starts with the Add drawer open beside the rail and no inspector until a body is selected", async () => {
    render(<App />);
    await waitForWorkspace();
    expect(screen.getByTestId("sidebar-left").getAttribute("data-open")).toBe("true");
    expect(screen.getByTestId("sidebar-left").getAttribute("data-tool")).toBe("create");
    expect(screen.getByTestId("sidebar-right").getAttribute("data-open")).toBe("false");
    expect(canvas().leftInset).toBe(64 + 344);
    expect(canvas().rightInset).toBe(0);
    await waitFor(() => expect(screen.getByTestId("backend-status").textContent).toMatch(/connected/));
  });

  it("puts Event History and the diagnostics panel in their own tools of the left drawer", async () => {
    render(<App />);
    await waitForWorkspace();
    const left = screen.getByTestId("sidebar-left");
    openTool("Events");
    expect(within(left).getByText("Event History")).toBeTruthy();
    expect(within(left).getByText("No events yet.")).toBeTruthy();
    openTool("Diagnostics");
    expect(within(left).getByRole("button", { name: /system diagnostics/i })).toBeTruthy();
    expect(screen.getByTestId("diag-mass")).toBeTruthy(); // the diagnostics tool shows its totals without a further click
  });

  it("reports panel insets to the canvas as the drawer and the inspector open and close (both open on a wide window)", async () => {
    render(<App />);
    await waitForWorkspace();
    act(() => canvas().onSelectBody(earth.id));
    expect([canvas().leftInset, canvas().rightInset]).toEqual([408, 340]);
    fireEvent.click(screen.getByRole("button", { name: "Close Add bodies" }));
    expect([canvas().leftInset, canvas().rightInset]).toEqual([64, 340]);
    openTool("History");
    expect([canvas().leftInset, canvas().rightInset]).toEqual([408, 340]);
  });

  it("pressing the open tool again closes the drawer", async () => {
    render(<App />);
    await waitForWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByTestId("sidebar-left").getAttribute("data-open")).toBe("false");
    expect(canvas().leftInset).toBe(64);
  });

  it("on a narrow window opening one side closes the other", async () => {
    setWidth(1000);
    render(<App />);
    await waitForWorkspace();
    act(() => canvas().onSelectBody(earth.id));
    expect([canvas().leftInset, canvas().rightInset]).toEqual([64, 320]);
    openTool("Events");
    expect([canvas().leftInset, canvas().rightInset]).toEqual([64 + 320, 0]);
  });

  it("shrinking the window with the drawer and the inspector open closes the drawer", async () => {
    render(<App />);
    await waitForWorkspace();
    act(() => canvas().onSelectBody(earth.id));
    expect([canvas().leftInset, canvas().rightInset]).toEqual([408, 340]);
    setWidth(900);
    expect([canvas().leftInset, canvas().rightInset]).toEqual([64, 320]);
  });

  it("selecting a body shows the inspector; an empty-canvas click dismisses it and returns the space", async () => {
    render(<App />);
    await waitForWorkspace();
    expect(canvas().rightInset).toBe(0);
    act(() => canvas().onSelectBody(earth.id));
    expect(canvas().rightInset).toBe(340);
    expect(await screen.findByText("Body Inspector")).toBeTruthy();
    expect(screen.getByTestId("sidebar-right").getAttribute("data-open")).toBe("true");
    act(() => canvas().onClearSelection());
    expect(screen.queryByText("Body Inspector")).toBeNull();
    expect(canvas().rightInset).toBe(0);
  });

  it("clicking controls or panels never dismisses the inspector, selects, or places a body", async () => {
    render(<App />);
    await waitForWorkspace();
    act(() => canvas().onSelectBody(sun.id));
    await screen.findByText("Body Inspector");
    h.calls.length = 0;
    for (const target of [screen.getByRole("button", { name: "Fit view to all bodies" }), screen.getByText("Event History"), screen.getByTestId("sidebar-right")]) {
      fireEvent.pointerDown(target);
      fireEvent.pointerUp(target);
      fireEvent.click(target);
    }
    expect(screen.getByText("Body Inspector")).toBeTruthy();
    expect(h.calls).toEqual([]);
  });
});

describe("App focus", () => {
  it("connects the shared view toolbar to the scene, overview, and selected-body focus", async () => {
    render(<App />);
    await waitForWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Axes" }));
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(canvas().viewControls.state.axesVisible).toBe(true);
    expect(canvas().viewControls.state.gridEnabled).toBe(true);

    act(() => canvas().onSelectBody(earth.id));
    const focus = screen.getByRole("button", { name: "Focus selected body" }) as HTMLButtonElement;
    expect(focus.disabled).toBe(false);
    fireEvent.click(focus);
    expect(canvas().focus.bodyId).toBe(earth.id);

    const frameBefore = canvas().frameEpoch;
    fireEvent.click(screen.getByRole("button", { name: "Fit view to all bodies" }));
    expect(canvas().frameEpoch).toBe(frameBefore + 1);
  });

  it("a focus request names the body and the inspector shows Focused only for that body until the camera lets go", async () => {
    render(<App />);
    await waitForWorkspace();
    act(() => canvas().onSelectBody(earth.id));
    await screen.findByText("Body Inspector");
    expect(screen.queryByTestId("focused-badge")).toBeNull();

    act(() => canvas().onFocusBody(earth.id));
    expect(canvas().focus.bodyId).toBe(earth.id);
    expect(canvas().focus.radius).toBeGreaterThan(0);
    expect(screen.getByTestId("focused-badge").textContent).toBe("Focused");

    act(() => canvas().onSelectBody(sun.id)); // inspecting a different body: the camera is still on Earth
    expect(screen.queryByTestId("focused-badge")).toBeNull();
    act(() => canvas().onSelectBody(earth.id));
    expect(screen.getByTestId("focused-badge")).toBeTruthy();

    act(() => canvas().onFocusRelease()); // user panned away / scene refitted / body gone
    expect(screen.queryByTestId("focused-badge")).toBeNull();
  });

  it("each new focus request gets a new nonce so repeated focusing restarts the move", async () => {
    render(<App />);
    await waitForWorkspace();
    act(() => canvas().onFocusBody(sun.id));
    const first = canvas().focus.nonce;
    act(() => canvas().onFocusBody(sun.id));
    expect(canvas().focus.nonce).toBe(first + 1);
  });
});

describe("App first use", () => {
  it("starts empty with one clear call to action that opens the create form", async () => {
    h.empty = true;
    render(<App />);
    const cta = await screen.findByRole("button", { name: "Add your first body" });
    expect(screen.getByText("The universe is empty")).toBeTruthy();
    fireEvent.click(cta);
    expect(await screen.findByRole("button", { name: "Create" })).toBeTruthy();
  });

  it("shows no call to action when bodies exist", async () => {
    render(<App />);
    await waitForWorkspace();
    expect(screen.queryByRole("button", { name: "Add your first body" })).toBeNull();
  });
});

describe("App CRUD feedback", () => {
  it("shows the bottom message for a successful body addition", async () => {
    render(<App />);
    await waitForWorkspace();
    fireEvent.click(screen.getByText("Add body…"));
    fireEvent.click(screen.getByText("Create"));
    expect((await screen.findByTestId("crud-feedback")).textContent).toMatch(/Added/);
    expect(screen.queryByText(/Created /)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText(/Undid adding/)).toBeTruthy();
  });
});
describe("App: connection health and simulation loading are different states", () => {
  it("says the backend is reachable while the simulation state is still loading (no 'Connecting' when connected)", async () => {
    h.stateMode = "hang";
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("backend-status").textContent).toMatch(/connected/));
    expect(screen.getByText(/Backend reachable\. Loading the simulation state/)).toBeTruthy();
    expect(screen.queryByText(/Connecting to the simulation backend/)).toBeNull();
  });

  it("turns a failed load into an explained, recoverable error and Retry recovers", async () => {
    h.stateMode = "fail-once";
    render(<App />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Cannot load the simulation: The backend did not answer/);
    expect(alert.textContent).toMatch(/answers health checks, but the simulation itself did not respond/);
    expect(screen.getByTestId("backend-status").textContent).toMatch(/connected/);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitForWorkspace();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("App view aids: axes and grid", () => {
  const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");
  const startPlacement = () => {
    fireEvent.click(screen.getByRole("button", { name: "Add body…" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose position in 3D" }));
  };
  const stopPlacement = () => fireEvent.click(screen.getByRole("button", { name: "Cancel 3D placement" }));

  it("starts with both off and passes the display scale to the canvas", async () => {
    render(<App />);
    await waitForWorkspace();
    expect([canvas().viewControls.state.axesVisible, canvas().viewControls.state.gridEnabled || canvas().placementMode]).toEqual([false, false]);
    expect(pressed("Axes")).toBe("false");
    expect(pressed("Grid")).toBe("false");
    expect(canvas().transform.metersPerUnit).toBeGreaterThan(0);
    expect(screen.queryByTestId("view-legend")).toBeNull();
  });

  it("toggles axes and grid independently and labels the visible overlay", async () => {
    render(<App />);
    await waitForWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Axes" }));
    expect([canvas().viewControls.state.axesVisible, canvas().viewControls.state.gridEnabled || canvas().placementMode]).toEqual([true, false]);
    expect(screen.getByTestId("view-legend").textContent).toMatch(/Axes extend through/);
    expect(screen.getByTestId("view-legend").textContent).not.toMatch(/per cell/);

    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect([canvas().viewControls.state.axesVisible, canvas().viewControls.state.gridEnabled || canvas().placementMode]).toEqual([true, true]);
    expect(screen.getByTestId("view-legend").textContent).toMatch(/m per cell/);

    fireEvent.click(screen.getByRole("button", { name: "Axes" }));
    expect([canvas().viewControls.state.axesVisible, canvas().viewControls.state.gridEnabled || canvas().placementMode]).toEqual([false, true]);
  });

  it("shows the grid while placing a body without changing the user's Grid setting, then restores it", async () => {
    render(<App />);
    await waitForWorkspace();
    startPlacement();
    expect((canvas().viewControls.state.gridEnabled || canvas().placementMode)).toBe(true); // temporary aid
    expect(pressed("Grid")).toBe("false"); // the user's own choice is untouched
    expect(screen.getByTestId("grid-placement-note")).toBeTruthy();
    stopPlacement();
    expect((canvas().viewControls.state.gridEnabled || canvas().placementMode)).toBe(false); // back to what the user chose
    expect(screen.queryByTestId("grid-placement-note")).toBeNull();
  });

  it("keeps a grid the user turned on across placement, and never touches the axes", async () => {
    render(<App />);
    await waitForWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    startPlacement();
    expect([canvas().viewControls.state.axesVisible, canvas().viewControls.state.gridEnabled || canvas().placementMode]).toEqual([false, true]);
    stopPlacement();
    expect([canvas().viewControls.state.axesVisible, canvas().viewControls.state.gridEnabled || canvas().placementMode]).toEqual([false, true]);
    expect(pressed("Grid")).toBe("true");
  });

  it("turning the grid off during placement does not lose the placement aid, and it ends with the user's choice", async () => {
    render(<App />);
    await waitForWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Grid" })); // on
    startPlacement();
    fireEvent.click(screen.getByRole("button", { name: "Grid" })); // user turns it off while placing
    expect((canvas().viewControls.state.gridEnabled || canvas().placementMode)).toBe(true); // still shown for placement
    stopPlacement();
    expect((canvas().viewControls.state.gridEnabled || canvas().placementMode)).toBe(false);
  });
});
