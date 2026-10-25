// Orbit Lab inside the app: the Experiment 01 workflow, run identity, protections and what reaches the renderer.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { earth, sun } from "./test/fixtures";

const h = vi.hoisted(() => ({
  canvasProps: { current: null as any },
  backend: null as any,
  calls: [] as string[],
}));

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
      const emb = { ...earth, id: "body-earth", name: "Earth (Earth–Moon barycentre)" };
      const meta = { "body-sun": { name: "Sun", colorHex: "#fdb813", radiusM: 6.957e8, kind: "star" }, "body-earth": { name: emb.name, colorHex: "#3b82f6", radiusM: 6.371e6, kind: "planet" } };
      const histOf = (id: string) => {
        const k = id === "uni-mod" ? 1.1 : 1;
        return {
          universeId: id, mode: "grid" as const, sampleIntervalS: 86400, generation: id === "uni-mod" ? 7 : 3, firstIndex: 0, nextIndex: 4,
          droppedBefore: 0, truncated: false, bodies: meta,
          samples: [0, 1, 2, 3].map((i) => ({ index: i, simulationTimeS: i * 86400, segment: 0, positionsM: { "body-sun": [0, 0, 0] as [number, number, number], "body-earth": [1.5e11 + i * 2.5e9 * k, 0, 0] as [number, number, number] } })),
        };
      };
      const base = fx.fakeClient({
        listUniverses: async () => list(),
        activateUniverse: async (id: string) => {
          h.calls.push(`activate:${id}`);
          b().active = id;
          b().epoch += 1;
          return { activeUniverseId: id, activationEpoch: b().epoch };
        },
        listExperiments: async () => b().experiments,
        createExperiment: async (systemId: string) => {
          h.calls.push(`createExperiment:${systemId}`);
          b().universes.push(fx.universe({ id: "uni-base", name: "Orbit Lab · Baseline", role: "baseline", experimentId: "exp-1", active: false }));
          b().active = "uni-base";
          b().epoch += 1;
          b().live["uni-base"] = { bodies: [sun, emb], t: 3 * 86400, revision: 1 };
          const e = fx.experiment();
          b().experiments = [e];
          return e;
        },
        createModifiedRun: async (_id: string, req: any) => {
          h.calls.push(`createModifiedRun:${JSON.stringify(req)}`);
          if (b().refuse) throw new ApiError("http", b().refuse, 422, "factor_not_allowed");
          b().universes.push(fx.universe({ id: "uni-mod", name: "Orbit Lab · Modified", role: "modified", experimentId: "exp-1", active: false }));
          b().live["uni-mod"] = { bodies: [sun, { ...emb, velocityMPerS: { x: -32780, y: -5940, z: 0.3 } }], t: 3 * 86400, revision: 1 };
          const e = fx.experiment({ modifiedUniverseId: "uni-mod", modification: fx.modificationOf(req.speedFactor) });
          b().experiments = [e];
          return e;
        },
        deleteExperiment: async (id: string) => {
          h.calls.push(`deleteExperiment:${id}`);
          b().universes = b().universes.filter((u: any) => !u.experimentId);
          b().experiments = [];
        },
        getInitialDifferences: async (id: string) => {
          h.calls.push(`initialDifferences:${id}`);
          return { experimentId: id, baselineUniverseId: "uni-base", modifiedUniverseId: "uni-mod", differences: [{ bodyId: "body-earth", field: "velocityMPerS", baseline: [1], modified: [2] }], configEqual: true };
        },
        getComparison: async (id: string, body: string) => {
          h.calls.push(`comparison:${id}:${body}`);
          const skew = b().mismatch
            ? { baseline: { universeId: "uni-base", simulationTimeS: 10 * 86400, sampleCount: 11 }, modified: { universeId: "uni-mod", simulationTimeS: 3 * 86400, sampleCount: 4 }, timesDiffer: true }
            : {};
          return fx.comparison({ ...skew, controlled: b().controlled, firstUncontrolledAtS: b().controlled ? null : 86400, issues: b().controlled ? [] : ["the modified run is uncontrolled since t = 86400 s (a physical edit was made after it was created)"] });
        },
      });
      const scopedOf = (scope: any) => {
        const id = scope.universeId;
        return {
          ...(base as any),
          scope,
          getState: async () => ({ ...fx.state(b().live[id]?.bodies ?? [sun, earth], b().live[id]?.t ?? 0), universeId: id, revision: b().live[id]?.revision ?? 0 }),
          getEvents: async () => [],
          getHistory: async () => {
            h.calls.push(`history:${id}`);
            return id === "uni-default" ? { ...histOf(id), samples: [], nextIndex: 0, bodies: {} } : histOf(id);
          },
          getProvenance: async () => ({ sourceKind: "experiment", controlled: id === "uni-mod" ? b().controlled : true, firstUncontrolledAtS: id === "uni-mod" && !b().controlled ? 86400 : null, audit: [] }),
          step: async () => {
            h.calls.push(`step:${id}`);
            return { ...fx.stepResponse(b().live[id].bodies, b().live[id].t + 100), universeId: id, revision: ++b().live[id].revision };
          },
          reset: async () => {
            h.calls.push(`reset:${id}`);
            return fx.state([]);
          },
          createBody: async () => {
            h.calls.push(`createBody:${id}`);
            return {} as any;
          },
        };
      };
      base.scoped = scopedOf;
      return base;
    },
  };
});

import App from "./App";
import * as fx from "./test/fixtures";
import { openTool, waitForWorkspace } from "./test/appHelpers";

const canvas = () => h.canvasProps.current;

beforeEach(() => {
  h.calls.length = 0;
  h.backend = {
    universes: [fx.universe({ id: "uni-default", name: "Sandbox" })],
    active: "uni-default",
    epoch: 1,
    live: { "uni-default": { bodies: [sun, earth], t: 0, revision: 0 } },
    experiments: [],
    controlled: true,
    refuse: null,
    mismatch: false,
  };
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
});
afterEach(cleanup);

async function startExperiment() {
  await waitForWorkspace();
  openTool("Orbit Lab");
  fireEvent.click(await screen.findByRole("button", { name: "Start Experiment 01" }));
  await screen.findByTestId("run-badge");
}

async function createRun(factorLabel = "×1.10") {
  fireEvent.click(await screen.findByLabelText(factorLabel));
  fireEvent.click(screen.getByRole("button", { name: "Create modified run" }));
  await screen.findByTestId("modification-record");
}

describe("Orbit Lab workflow in the app", () => {
  it("starting Experiment 01 creates the baseline, switches to it and names the run", async () => {
    render(<App />);
    await startExperiment();
    expect(h.calls).toContain("createExperiment:exp01-sun-emb-j2000");
    expect(screen.getByTestId("run-badge").textContent).toBe("Orbit Lab · BASELINE");
    expect(screen.getByTestId("active-universe").textContent).toMatch(/Orbit Lab baseline/);
    expect(screen.getByTestId("initial-velocity")).toBeTruthy();
    expect(screen.getByText(/Two-body model: Sun \+ Earth–Moon barycentre; positions are barycentres; not a forecast/)).toBeTruthy();
    expect(screen.queryByTestId("modification-record")).toBeNull();
    expect(screen.queryByRole("region", { name: "Comparison" })).toBeNull(); // nothing to compare yet
  });

  it("the preview is shown before anything is created, then the run is created with the exact factor", async () => {
    render(<App />);
    await startExperiment();
    fireEvent.click(screen.getByLabelText("×1.10"));
    expect(screen.getByTestId("velocity-preview").textContent).toMatch(/Nothing has been created yet/);
    expect(h.calls.some((c) => c.startsWith("createModifiedRun"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Create modified run" }));
    await screen.findByTestId("modification-record");
    const sent = JSON.parse(h.calls.find((c) => c.startsWith("createModifiedRun"))!.slice("createModifiedRun:".length));
    expect(sent).toEqual({ bodyId: "body-earth", speedFactor: 1.1, replaceExisting: false });
    // the new run exists in the switcher, but it was not activated by creating it
    openTool("Universes");
    expect(screen.getByRole("button", { name: "Switch to Orbit Lab · Modified" })).toBeTruthy();
    expect(screen.getByTestId("run-badge").textContent).toBe("Orbit Lab · BASELINE");
    openTool("Orbit Lab");
    await waitFor(() => expect(screen.getByTestId("initial-check").textContent).toMatch(/Exactly one difference/));
  });

  it("failed modified-run creation shows error and no success state", async () => {
    h.backend.refuse = "speed factor 1.1 is not allowed";
    render(<App />);
    await startExperiment();
    fireEvent.click(screen.getByLabelText("×1.10"));
    fireEvent.click(screen.getByRole("button", { name: "Create modified run" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/speed factor 1\.1 is not allowed/);
    expect(screen.queryByTestId("modification-record")).toBeNull();
    expect(screen.queryByRole("region", { name: "Comparison" })).toBeNull();
    openTool("Universes");
    expect(screen.queryByRole("button", { name: "Switch to Orbit Lab · Modified" })).toBeNull();
  });

  it("switching to the modified run changes the badge; both runs reach the renderer as active and reference trajectories", async () => {
    render(<App />);
    await startExperiment();
    await createRun();
    // on the baseline: its own path is the active one, the modified run's path is the dashed reference
    await waitFor(() => expect(canvas().trajectories.map((t: any) => t.role).sort()).toEqual(["active", "reference"]));
    let [active, reference] = ["active", "reference"].map((r) => canvas().trajectories.find((t: any) => t.role === r));
    expect(active.universeId).toBe("uni-base");
    expect(reference.universeId).toBe("uni-mod");
    expect(active.bodyId).toBe("body-earth");
    expect(active.key).toBe("uni-base:3:body-earth");
    expect(reference.key).toBe("uni-mod:7:body-earth");
    expect(active.samples[3].positionM.x).toBe(1.5e11 + 3 * 2.5e9);
    expect(reference.samples[3].positionM.x).toBeCloseTo(1.5e11 + 3 * 2.5e9 * 1.1, 0); // never mixed with the baseline's samples

    fireEvent.click(screen.getByRole("button", { name: "Go to modified run" }));
    await waitFor(() => expect(screen.getByTestId("run-badge").textContent).toBe("Orbit Lab · MODIFIED ×1.10 speed"));
    await waitFor(() => expect(canvas().trajectories.find((t: any) => t.role === "active")?.universeId).toBe("uni-mod"));
    [active, reference] = ["active", "reference"].map((r) => canvas().trajectories.find((t: any) => t.role === r));
    expect(active.universeId).toBe("uni-mod");
    expect(reference.universeId).toBe("uni-base");
    expect(h.calls).toContain("activate:uni-mod");
  });

  it("the comparison shows both times and the separation, and never calls mutating endpoints", async () => {
    render(<App />);
    await startExperiment();
    await createRun();
    const panel = await screen.findByRole("region", { name: "Comparison" });
    expect(within(panel).getByTestId("comparison-times").textContent).toMatch(/Baseline t = 3 d.*Modified t = 3 d/);
    expect(within(panel).getByRole("img", { name: /Separation/ })).toBeTruthy();
    const before = h.calls.length;
    fireEvent.change(within(panel).getByLabelText("Common sample"), { target: { value: "1" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Refresh comparison" }));
    await waitFor(() => expect(h.calls.slice(before).some((c) => c.startsWith("comparison:"))).toBe(true));
    const mutating = h.calls.filter((c) => /^(step|reset|createBody|activate|delete)/.test(c));
    expect(mutating).toEqual([]);
  });

  it("different simulation times are flagged, not hidden", async () => {
    h.backend.mismatch = true;
    render(<App />);
    await startExperiment();
    await createRun();
    const panel = await screen.findByRole("region", { name: "Comparison" });
    expect(within(panel).getByTestId("comparison-times").textContent).toMatch(/Baseline t = 10 d.*Modified t = 3 d/);
    expect(within(panel).getByTestId("comparison-time-mismatch").textContent).toMatch(/different simulation times/);
  });

  it("the baseline cannot be edited from the UI, and says why", async () => {
    render(<App />);
    await startExperiment();
    openTool("Add");
    expect((screen.getByRole("button", { name: "Add body…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Add body…" }).getAttribute("title")).toMatch(/immutable reference/);
    act(() => canvas().onSelectBody("body-earth"));
    await screen.findByText("Body Inspector");
    expect(screen.getAllByText(/immutable reference/).length).toBeGreaterThan(0);
    const inspector = screen.getByText("Body Inspector").closest("div")!.parentElement!;
    fireEvent.change(within(inspector).getByLabelText("Mass (kg)"), { target: { value: "1e24" } });
    expect((within(inspector).getByText("Apply") as HTMLButtonElement).disabled).toBe(true);
    expect((within(inspector).getByText("Delete") as HTMLButtonElement).disabled).toBe(true);
    // snapshots are refused for the baseline too
    openTool("Universes");
    expect(screen.getByText(/immutable reference: it cannot be snapshotted or restored/)).toBeTruthy();
  });

  it("shows uncontrolled warning on the run badge and in the comparison once the modified run was edited", async () => {
    render(<App />);
    await startExperiment();
    await createRun();
    fireEvent.click(screen.getByRole("button", { name: "Go to modified run" }));
    await waitFor(() => expect(screen.getByTestId("run-badge").textContent).toMatch(/MODIFIED/));
    expect(screen.queryByTestId("run-uncontrolled")).toBeNull();
    h.backend.controlled = false; // the backend now reports a physical edit
    fireEvent.click(screen.getByRole("button", { name: "Step Forward" }));
    expect((await screen.findByTestId("run-uncontrolled")).textContent).toBe("Uncontrolled since t = 1 d");
    expect((await screen.findByTestId("comparison-uncontrolled")).textContent).toMatch(/Uncontrolled since t = 1 d/);
  });

  it("deleting the experiment needs another universe, is confirmed, and refreshes the lists", async () => {
    render(<App />);
    await startExperiment();
    await createRun();
    expect(screen.getByText(/Switch to another universe first/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete experiment" })).toBeNull();
    openTool("Universes");
    fireEvent.click(screen.getByRole("button", { name: "Switch to Sandbox" }));
    await waitForWorkspace();
    openTool("Orbit Lab");
    fireEvent.click(await screen.findByRole("button", { name: "Delete experiment" }));
    expect(h.calls.some((c) => c.startsWith("deleteExperiment"))).toBe(false); // the first press only asks
    fireEvent.click(screen.getByRole("button", { name: /Delete both runs/ }));
    await waitFor(() => expect(h.calls).toContain("deleteExperiment:exp-1"));
    await screen.findByRole("button", { name: "Start Experiment 01" });
    expect(screen.queryByRole("region", { name: "Comparison" })).toBeNull();
    openTool("Universes");
    expect(screen.queryByRole("button", { name: /Switch to Orbit Lab/ })).toBeNull();
  });

  it("an experiment survives a page reload: it is found again and can be opened", async () => {
    h.backend.universes.push(fx.universe({ id: "uni-base", name: "Orbit Lab · Baseline", role: "baseline", experimentId: "exp-1", active: false }));
    h.backend.live["uni-base"] = { bodies: [sun, earth], t: 0, revision: 1 };
    h.backend.experiments = [fx.experiment()];
    render(<App />);
    await waitForWorkspace();
    openTool("Orbit Lab");
    fireEvent.click(await screen.findByRole("button", { name: /Open baseline of/ }));
    await screen.findByTestId("run-badge");
    expect(screen.getByTestId("run-badge").textContent).toBe("Orbit Lab · BASELINE");
  });
});
