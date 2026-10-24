// UI-2 history inside the app: viewing recorded samples, the rules while doing so, and isolation between universes.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { earth, sun } from "./test/fixtures";

const h = vi.hoisted(() => ({
  canvasProps: { current: null as any },
  backend: null as any,
  calls: [] as string[],
  historyGate: null as null | { promise: Promise<void>; release: () => void },
}));

vi.mock("./components/canvas/UniverseCanvas", () => ({
  UniverseCanvas: (props: any) => {
    h.canvasProps.current = props;
    return <div data-testid="canvas" />;
  },
}));

vi.mock("./api/client", async () => {
  const fx = await import("./test/fixtures");
  return {
    createApiClient: () => {
      const b = () => h.backend;
      const base = fx.fakeClient({
        listUniverses: async () => ({
          universes: b().universes.map((u: any) => ({ ...u, active: u.id === b().active })),
          activeUniverseId: b().active,
          activationEpoch: b().epoch,
        }),
        activateUniverse: async (id: string) => {
          b().active = id;
          b().epoch += 1;
          return { activeUniverseId: id, activationEpoch: b().epoch };
        },
      });
      base.scoped = (scope: any) => {
        const id = scope.universeId;
        return {
          ...(base as any),
          scope,
          getState: async () => ({ ...fx.state(b().live[id].bodies, b().live[id].t), universeId: id, revision: b().live[id].revision }),
          getEvents: async () => [],
          step: async () => {
            h.calls.push(`step:${id}`);
            const l = b().live[id];
            l.t += 100;
            l.revision += 1;
            return { ...fx.stepResponse(l.bodies, l.t), universeId: id, revision: l.revision };
          },
          getHistory: async (q: any) => {
            h.calls.push(`history:${id}:${q.generation ?? "-"}:${q.fromIndex ?? 0}`);
            if (h.historyGate) await h.historyGate.promise;
            const hist = b().history[id];
            if (hist.error) throw hist.error;
            const from = q.generation === hist.generation ? (q.fromIndex ?? 0) : 0;
            const samples = hist.samples.filter((s: any) => s.index >= from);
            return {
              universeId: id, mode: "step", sampleIntervalS: null, generation: hist.generation, firstIndex: from,
              nextIndex: hist.samples.length, droppedBefore: 0, truncated: false, samples, bodies: hist.bodies,
            };
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
const meta = (b: any) => ({ name: b.name, colorHex: b.colorHex, radiusM: b.radiusM, kind: b.kind });
// Recorded samples: Earth moves 1e9 m per sample along x (Sun stays); sample i is at t = 100 i.
const recorded = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({
    index: i, simulationTimeS: i * 100, segment: 0,
    positionsM: { [sun.id]: [0, 0, 0], [earth.id]: [offset + i * 1e9, 0, 0] },
  }));

beforeEach(() => {
  h.calls.length = 0;
  h.historyGate = null;
  h.backend = {
    universes: [fx.universe({ id: "uni-default", name: "Sandbox" }), fx.universe({ id: "uni-solar", name: "Solar", role: "preset", active: false })],
    active: "uni-default",
    epoch: 1,
    live: {
      "uni-default": { bodies: [sun, earth], t: 400, revision: 5 },
      "uni-solar": { bodies: [sun], t: 0, revision: 1 },
    },
    history: {
      "uni-default": { generation: 1, samples: recorded(5), bodies: { [sun.id]: meta(sun), [earth.id]: meta(earth) } },
      "uni-solar": { generation: 9, samples: [{ index: 0, simulationTimeS: 0, segment: 0, positionsM: { [sun.id]: [0, 0, 0] } }], bodies: { [sun.id]: meta(sun) } },
    },
  };
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
});
afterEach(cleanup);

async function openTimeline() {
  await screen.findByText("Simulation");
  fireEvent.click(screen.getByRole("button", { name: "Expand Body catalogue & history" }));
  await screen.findByLabelText("History position");
}
const earthX = () => canvas().bodies.find((b: any) => b.id === earth.id).position[0];

describe("history in the app", () => {
  it("shows the recorded history of the active universe and the live time", async () => {
    render(<App />);
    await openTimeline();
    expect(screen.getByTestId("history-time").textContent).toBe("Live: t = 6.67 min");
    expect((screen.getByLabelText("History position") as HTMLInputElement).max).toBe("4");
    expect(h.calls).toContain("history:uni-default:-:0");
  });

  it("entering history pauses play and disables edits", async () => {
    render(<App />);
    await openTimeline();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(h.calls.some((c) => c === "step:uni-default")).toBe(true));
    expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true); // playing

    act(() => void fireEvent.change(screen.getByLabelText("History position"), { target: { value: "1" } }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(false)); // paused
    const stepsBefore = h.calls.filter((c) => c === "step:uni-default").length;

    expect(screen.getByText(/Viewing recorded history — the simulation is not advancing/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Step Forward" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reset Universe" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add body…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Body Inspector")).toBeNull();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("diag-live-only")).toBeTruthy();
    // the scene shows sample 1 (Earth at 1e9 m), not the live state
    expect(earthX()).toBeCloseTo(1e9 / canvas().transform.metersPerUnit, 6);
    await new Promise((r) => setTimeout(r, 400));
    expect(h.calls.filter((c) => c === "step:uni-default").length).toBe(stepsBefore); // nothing advanced meanwhile
  });

  it("selecting a body while viewing history does not open the live inspector", async () => {
    render(<App />);
    await openTimeline();
    fireEvent.change(screen.getByLabelText("History position"), { target: { value: "2" } });
    act(() => canvas().onSelectBody(earth.id));
    expect(screen.queryByText("Body Inspector")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Return to live" }));
    expect(await screen.findByText("Body Inspector")).toBeTruthy();
  });

  it("return to live shows the live state again; Play from history returns to live first", async () => {
    render(<App />);
    await openTimeline();
    const liveX = earthX();
    fireEvent.change(screen.getByLabelText("History position"), { target: { value: "1" } });
    expect(earthX()).not.toBe(liveX);
    fireEvent.click(screen.getByRole("button", { name: "Return to live" }));
    expect(earthX()).toBe(liveX);
    expect(screen.queryByText(/Viewing recorded history/)).toBeNull();

    fireEvent.change(screen.getByLabelText("History position"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(screen.queryByText(/Viewing recorded history/)).toBeNull());
    await waitFor(() => expect(h.calls).toContain("step:uni-default"));
  });

  it("a live step adds the new sample incrementally (and does not move the viewed one)", async () => {
    render(<App />);
    await openTimeline();
    h.backend.history["uni-default"].samples = recorded(6);
    fireEvent.click(screen.getByRole("button", { name: "Step Forward" }));
    await waitFor(() => expect(h.calls).toContain("history:uni-default:1:5"));
    await waitFor(() => expect((screen.getByLabelText("History position") as HTMLInputElement).max).toBe("5"));
  });

  it("history fetch failure keeps what is shown and says so", async () => {
    render(<App />);
    await openTimeline();
    h.backend.history["uni-default"].error = new ApiError("timeout", "The backend did not answer GET history");
    fireEvent.click(screen.getByRole("button", { name: "Step Forward" }));
    expect(await screen.findByText(/History may be incomplete: could not update/)).toBeTruthy();
    expect((screen.getByLabelText("History position") as HTMLInputElement).max).toBe("4"); // still there
    h.backend.history["uni-default"].error = undefined;
    h.backend.history["uni-default"].samples = recorded(6);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/History may be incomplete/)).toBeNull());
    expect((screen.getByLabelText("History position") as HTMLInputElement).max).toBe("5");
  });

  it("history page from old workspace is ignored (a switch discards the in-flight fetch)", async () => {
    render(<App />);
    await screen.findByText("Simulation");
    let release!: () => void;
    h.historyGate = { promise: new Promise<void>((r) => (release = r)), release: () => release() };
    fireEvent.click(screen.getByRole("button", { name: "Step Forward" })); // triggers a history fetch that will hang
    await waitFor(() => expect(h.calls.filter((c) => c.startsWith("history:uni-default")).length).toBeGreaterThan(0));
    h.historyGate = null;
    fireEvent.click(screen.getByRole("button", { name: "Switch to Solar" }));
    await waitFor(() => expect(screen.getByTestId("universe-badge").textContent).toBe("Solar"));
    fireEvent.click(screen.getByRole("button", { name: "Expand Body catalogue & history" }));
    await screen.findByLabelText("History position");
    expect((screen.getByLabelText("History position") as HTMLInputElement).max).toBe("0"); // Solar's one sample
    await act(async () => {
      release(); // the old universe's page arrives late
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((screen.getByLabelText("History position") as HTMLInputElement).max).toBe("0"); // nothing of Sandbox leaked in
    expect(screen.queryByText(/History may be incomplete/)).toBeNull();
  });

  it("a new generation (reset or restore) returns to live and replaces the timeline", async () => {
    render(<App />);
    await openTimeline();
    fireEvent.change(screen.getByLabelText("History position"), { target: { value: "3" } });
    expect(screen.getByText(/Viewing recorded history/)).toBeTruthy();
    // the backend restored a snapshot elsewhere: new generation, shorter history, new revision
    h.backend.history["uni-default"] = { ...h.backend.history["uni-default"], generation: 2, samples: recorded(2) };
    h.backend.live["uni-default"].revision += 1;
    fireEvent.click(screen.getByRole("button", { name: "Return to live" })); // leave, then step to trigger the refetch
    fireEvent.click(screen.getByRole("button", { name: "Step Forward" }));
    await waitFor(() => expect((screen.getByLabelText("History position") as HTMLInputElement).max).toBe("1"));
  });
});

describe("Show paths", () => {
  it("passes recorded paths to the renderer through the trajectories input: all bodies, or the selected one", async () => {
    render(<App />);
    await openTimeline();
    expect(canvas().trajectories.map((t: any) => t.bodyId).sort()).toEqual([earth.id, sun.id].sort());
    const t = canvas().trajectories.find((x: any) => x.bodyId === earth.id);
    expect(t.key).toBe("uni-default:1:" + earth.id);
    expect(t.role).toBe("active");
    expect(t.samples).toHaveLength(6); // five recorded samples plus the authoritative live body position
    expect(t.samples[4].positionM).toEqual({ x: 4e9, y: 0, z: 0 });
    expect(t.samples[5].positionM).toEqual(earth.positionM);
    act(() => canvas().onSelectBody(earth.id));
    expect(canvas().trajectories.map((x: any) => x.bodyId)).toEqual([earth.id]);
    fireEvent.click(screen.getByRole("button", { name: "Show paths" }));
    expect(canvas().trajectories).toEqual([]);
  });

  it("viewing history does not change what the paths show (they are the recorded history, not the viewed sample)", async () => {
    render(<App />);
    await openTimeline();
    const before = canvas().trajectories.find((x: any) => x.bodyId === earth.id).samples.length;
    fireEvent.change(screen.getByLabelText("History position"), { target: { value: "1" } });
    expect(canvas().trajectories.find((x: any) => x.bodyId === earth.id).samples.length).toBe(before - 1); // history view hides the live-only endpoint
  });
});
