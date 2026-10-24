// App-level behaviour of universes: identity, switching, isolation of client state, resync and confirmation.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { earth, sun } from "./test/fixtures";

const h = vi.hoisted(() => {
  const gate: { step: null | { promise: Promise<void>; release: () => void }; reset: null | { promise: Promise<void>; release: () => void } } = { step: null, reset: null };
  return {
    canvasProps: { current: null as any },
    gate,
    backend: null as any,
    calls: [] as string[],
  };
});

vi.mock("./components/canvas/UniverseCanvas", () => ({
  UniverseCanvas: (props: any) => {
    h.canvasProps.current = props;
    return <div data-testid="canvas" />;
  },
}));

vi.mock("./api/client", async () => {
  const fx = await import("./test/fixtures");
  const { ApiError } = await import("./api/errors");
  return {
    createApiClient: () => {
      const b = () => h.backend;
      const list = () => ({
        universes: b().universes.map((u: any) => ({ ...u, active: u.id === b().active })),
        activeUniverseId: b().active,
        activationEpoch: b().epoch,
      });
      const base = fx.fakeClient({
        listUniverses: async () => {
          h.calls.push("listUniverses");
          if (b().lost) throw new ApiError("network", "Cannot reach the backend (down)");
          return list();
        },
        activateUniverse: async (id: string) => {
          h.calls.push(`activate:${id}`);
          b().active = id;
          b().epoch += 1;
          return { activeUniverseId: id, activationEpoch: b().epoch };
        },
        createUniverse: async (req: any) => {
          h.calls.push(`create:${JSON.stringify(req)}`);
          const id = `uni-${b().universes.length + 1}`;
          b().universes.push(fx.universe({ id, name: req.source.kind === "preset" ? "Solar System (J2000.0)" : "Universe 2", role: req.source.kind === "preset" ? "preset" : "sandbox", active: false }));
          b().states[id] = fx.state([sun], 0);
          if (req.activate) {
            b().active = id;
            b().epoch += 1;
          }
          return b().universes.at(-1);
        },
        deleteUniverse: async (id: string) => {
          h.calls.push(`delete:${id}`);
        },
      });
      base.scoped = (scope: any) => {
        const id = scope.universeId;
        return {
          ...(base as any),
          scope,
          getState: async () => {
            const lost = b().stateError?.[id];
            if (lost) throw lost;
            return b().states[id];
          },
          getEvents: async () => [],
          step: async () => {
            h.calls.push(`step:${id}`);
            if (h.gate.step) await h.gate.step.promise;
            const err = b().stepError?.[id];
            if (err) throw err;
            return fx.stepResponse([sun, earth], 100);
          },
          reset: async () => {
            h.calls.push(`reset:${id}`);
            if (h.gate.reset) await h.gate.reset.promise;
            return fx.state([]);
          },
        };
      };
      return base;
    },
  };
});

import App from "./App";
import { ApiError } from "./api/errors";
import * as fx from "./test/fixtures";

const canvas = () => h.canvasProps.current;

function deferredGate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

beforeEach(() => {
  h.calls.length = 0;
  h.gate.step = null;
  h.gate.reset = null;
  h.backend = {
    universes: [
      fx.universe({ id: "uni-default", name: "Sandbox", role: "sandbox" }),
      fx.universe({ id: "uni-solar", name: "Solar", role: "preset", presetId: "solar-system-j2000", epochLabel: "J2000.0", simulationTimeS: 500, bodyCount: 1, active: false }),
    ],
    active: "uni-default",
    epoch: 1,
    states: { "uni-default": fx.state([sun, earth], 0), "uni-solar": fx.state([sun], 500) },
    stepError: {},
    stateError: {},
    lost: false,
  };
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
});
afterEach(cleanup);

const switchTo = (name: string) => fireEvent.click(screen.getByRole("button", { name: `Switch to ${name}` }));

describe("universe identity and navigation", () => {
  it("shows active universe name and role", async () => {
    render(<App />);
    await screen.findByText("Simulation");
    const active = screen.getByTestId("active-universe");
    expect(active.textContent).toMatch(/Sandbox/);
    expect(active.textContent).toMatch(/sandbox/);
    expect(active.textContent).toMatch(/active/);
    expect(screen.getByTestId("universe-badge").textContent).toBe("Sandbox");
  });

  it("switching activates on the backend and shows the other universe's own state and time", async () => {
    render(<App />);
    await screen.findByText("Simulation");
    switchTo("Solar");
    await waitFor(() => expect(screen.getByTestId("universe-badge").textContent).toBe("Solar"));
    expect(h.calls).toContain("activate:uni-solar");
    await waitFor(() => expect(screen.getByText(/5\.000e\+2 s/)).toBeTruthy());
    expect(canvas().bodies.map((b: any) => b.name)).toEqual(["Sun"]);
    expect(screen.getByTestId("active-universe").textContent).toMatch(/preset/);
  });

  it("switching remounts workspace and drops a late step response from the old universe", async () => {
    render(<App />);
    await screen.findByText("Simulation");
    h.gate.step = deferredGate();
    fireEvent.click(screen.getByRole("button", { name: "Step Forward" }));
    await waitFor(() => expect(h.calls).toContain("step:uni-default"));
    switchTo("Solar"); // a step is not a "write": the backend rolls it back, the switch proceeds
    await waitFor(() => expect(screen.getByTestId("universe-badge").textContent).toBe("Solar"));
    await screen.findByText(/5\.000e\+2 s/);
    await act(async () => {
      h.gate.step!.release(); // the old universe's step now "completes" with t = 100
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/5\.000e\+2 s/)).toBeTruthy(); // still the Solar universe's own time
    expect(screen.queryByText(/1\.000e\+2 s/)).toBeNull();
  });

  it("selection and focus are cleared on switch; axes/grid and sidebars persist", async () => {
    render(<App />);
    await screen.findByText("Simulation");
    fireEvent.click(screen.getByRole("button", { name: "Expand Body catalogue & history" }));
    fireEvent.click(screen.getByRole("button", { name: "Axes" }));
    act(() => canvas().onSelectBody(earth.id));
    act(() => canvas().onFocusBody(earth.id));
    await screen.findByText("Body Inspector");
    expect(canvas().focus.bodyId).toBe(earth.id);

    switchTo("Solar");
    await waitFor(() => expect(screen.getByTestId("universe-badge").textContent).toBe("Solar"));
    expect(screen.queryByText("Body Inspector")).toBeNull();
    expect(canvas().selectedBodyId).toBeUndefined();
    expect(canvas().focus).toBeUndefined();
    expect(canvas().viewControls.state.axesVisible).toBe(true);
    expect(screen.getByTestId("sidebar-left").getAttribute("data-open")).toBe("true");
    expect(screen.getByTestId("sidebar-right").getAttribute("data-open")).toBe("true");
  });

  it("switcher disabled while a write is pending", async () => {
    render(<App />);
    await screen.findByText("Simulation");
    h.gate.reset = deferredGate();
    fireEvent.click(screen.getByRole("button", { name: "Reset Universe" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm reset/ }));
    await waitFor(() => expect(h.calls).toContain("reset:uni-default"));
    expect((screen.getByRole("button", { name: "Switch to Solar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/switching is blocked until it finishes/)).toBeTruthy();
    await act(async () => {
      h.gate.reset!.release();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect((screen.getByRole("button", { name: "Switch to Solar" }) as HTMLButtonElement).disabled).toBe(false));
  });
});

describe("presets and creation", () => {
  it("loading a preset creates a new universe and does not delete the current one", async () => {
    render(<App />);
    await screen.findByText("Simulation");
    fireEvent.click(screen.getByRole("button", { name: "Load as new universe" }));
    await waitFor(() => expect(h.calls.some((c) => c.startsWith("create:"))).toBe(true));
    const created = JSON.parse(h.calls.find((c) => c.startsWith("create:"))!.slice(7));
    expect(created).toEqual({ source: { kind: "preset", presetId: "solar-system-j2000" }, activate: true });
    expect(h.calls.some((c) => c.startsWith("delete:"))).toBe(false);
    await waitFor(() => expect(screen.getByTestId("universe-badge").textContent).toBe("Solar System (J2000.0)"));
    expect(screen.getByRole("button", { name: "Switch to Sandbox" })).toBeTruthy(); // the old universe is still there
    expect(screen.getByText(/nothing existing is replaced/)).toBeTruthy();
  });
});

describe("resync", () => {
  it("stale-activation adopts backend active universe", async () => {
    render(<App />);
    await screen.findByText("Simulation");
    // Another tab switched while this one still thinks Sandbox is active.
    h.backend.active = "uni-solar";
    h.backend.epoch = 2;
    h.backend.stepError["uni-default"] = new ApiError("http", "stale activation epoch 1 (current: 2)", 409, "stale_activation");
    fireEvent.click(screen.getByRole("button", { name: "Step Forward" }));
    await waitFor(() => expect(screen.getByTestId("universe-badge").textContent).toBe("Solar"));
    expect(screen.queryByTestId("universes-lost-notice")).toBeNull();
  });

  it("shows a universes-lost notice after a backend restart instead of stale state", async () => {
    render(<App />);
    await screen.findByText("Simulation");
    switchTo("Solar");
    await waitFor(() => expect(screen.getByTestId("universe-badge").textContent).toBe("Solar"));
    // The backend restarted: only a fresh default universe exists, with epoch 1.
    h.backend.universes = [fx.universe({ id: "uni-default", name: "Sandbox" })];
    h.backend.active = "uni-default";
    h.backend.epoch = 1;
    h.backend.stepError["uni-solar"] = new ApiError("http", "unknown universe: uni-solar", 404, "universe_not_found");
    fireEvent.click(screen.getByRole("button", { name: "Step Forward" }));
    const notice = await screen.findByTestId("universes-lost-notice");
    expect(notice.textContent).toMatch(/universes held in memory were lost/);
    await waitFor(() => expect(screen.getByTestId("universe-badge").textContent).toBe("Sandbox"));
  });

  it("an unreachable backend at start is a recoverable error, not an empty screen", async () => {
    h.backend.lost = true;
    render(<App />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Cannot load the universes/);
    h.backend.lost = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Simulation")).toBeTruthy();
  });
});

describe("destructive actions are confirmed", () => {
  it("reset and restore require confirmation", async () => {
    render(<App />);
    await screen.findByText("Simulation");
    fireEvent.click(screen.getByRole("button", { name: "Reset Universe" }));
    expect(h.calls.some((c) => c.startsWith("reset:"))).toBe(false); // the first press only asks
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.calls.some((c) => c.startsWith("reset:"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Reset Universe" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm reset/ }));
    await waitFor(() => expect(h.calls).toContain("reset:uni-default"));
  });

  it("deleting a universe asks first and never deletes the active one", async () => {
    render(<App />);
    await screen.findByText("Simulation");
    const row = screen.getByRole("button", { name: "Switch to Solar" }).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(h.calls.some((c) => c.startsWith("delete:"))).toBe(false);
    fireEvent.click(within(row).getByRole("button", { name: /Delete Solar/ }));
    await waitFor(() => expect(h.calls).toContain("delete:uni-solar"));
    const activeRow = screen.getByRole("button", { name: "Active universe Sandbox" }).closest("li")!;
    expect(within(activeRow).queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

describe("user preferences survive a switch", () => {
  it("the simulation speed is kept when the universe changes", async () => {
    render(<App />);
    await screen.findByText("Simulation");
    const slider = () => screen.getByLabelText(/Sim Speed/) as HTMLInputElement;
    fireEvent.change(slider(), { target: { value: "6.5" } });
    expect(slider().value).toBe("6.5");
    fireEvent.click(screen.getByRole("button", { name: "Switch to Solar" }));
    await waitFor(() => expect(screen.getByTestId("universe-badge").textContent).toBe("Solar"));
    await screen.findByText(/Sim time/);
    expect(slider().value).toBe("6.5");
  });
});

