import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InitialDifferencesDto } from "../../api/types";
import { comparison, experiment, modificationOf, orbitSystem } from "../../test/fixtures";
import { ComparisonPanel } from "./ComparisonPanel";
import { OrbitLabPanel } from "./OrbitLabPanel";
import { RunBadge } from "./RunBadge";

afterEach(cleanup);

describe("RunBadge", () => {
  it("run badge distinguishes baseline and modified", () => {
    const { rerender } = render(<RunBadge role="baseline" modification={null} controlled firstUncontrolledAtS={null} />);
    expect(screen.getByTestId("run-badge").textContent).toBe("Orbit Lab · BASELINE");
    rerender(<RunBadge role="modified" modification={modificationOf(1.1)} controlled firstUncontrolledAtS={null} />);
    expect(screen.getByTestId("run-badge").textContent).toBe("Orbit Lab · MODIFIED ×1.10 speed");
    rerender(<RunBadge role="modified" modification={modificationOf(0.95)} controlled firstUncontrolledAtS={null} />);
    expect(screen.getByTestId("run-badge").textContent).toBe("Orbit Lab · MODIFIED ×0.95 speed");
  });

  it("shows uncontrolled warning", () => {
    render(<RunBadge role="modified" modification={modificationOf(1.1)} controlled={false} firstUncontrolledAtS={2 * 86400} />);
    const warn = screen.getByTestId("run-uncontrolled");
    expect(warn.textContent).toBe("Uncontrolled since t = 2 d");
    expect(warn.getAttribute("role")).toBe("status");
  });

  it("a controlled run shows no warning", () => {
    render(<RunBadge role="modified" modification={modificationOf(1.1)} controlled firstUncontrolledAtS={null} />);
    expect(screen.queryByTestId("run-uncontrolled")).toBeNull();
  });
});

const handlers = () => ({
  onStart: vi.fn(), onCreateRun: vi.fn(), onActivate: vi.fn(), onDelete: vi.fn(), onDismissError: vi.fn(),
  getInitialDifferences: vi.fn(async (_id: string): Promise<InitialDifferencesDto> => ({
    experimentId: "exp-1", baselineUniverseId: "uni-base", modifiedUniverseId: "uni-mod",
    differences: [{ bodyId: "body-earth", field: "velocityMPerS", baseline: [1, 2, 3], modified: [1.1, 2.2, 3.3] }], configEqual: true,
  })),
});
const base = { systems: [orbitSystem], busy: false, error: null, switchDisabled: false, activeUniverseId: "uni-base" };

describe("OrbitLabPanel before an experiment", () => {
  it("offers the question and starts the experiment", () => {
    const h = handlers();
    render(<OrbitLabPanel {...base} {...h} experiment={undefined} experiments={[]} />);
    expect(screen.getByText(/How does changing a planet's initial velocity affect its subsequent orbit/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start Experiment 01" }));
    expect(h.onStart).toHaveBeenCalledWith("exp01-sun-emb-j2000");
  });

  it("lists existing experiments so a reload does not lose them", () => {
    const h = handlers();
    render(<OrbitLabPanel {...base} {...h} experiment={undefined} experiments={[experiment()]} activeUniverseId="uni-default" />);
    fireEvent.click(screen.getByRole("button", { name: /Open baseline/ }));
    expect(h.onActivate).toHaveBeenCalledWith("uni-base");
  });

  it("shows nothing but a hint when the backend offers no system", () => {
    render(<OrbitLabPanel {...base} {...handlers()} systems={[]} experiment={undefined} experiments={[]} />);
    expect(screen.queryByRole("button", { name: "Start Experiment 01" })).toBeNull();
  });
});

describe("OrbitLabPanel with a baseline", () => {
  it("shows bodies, epoch, frame, units, model note and digest, and the EMB's initial velocity in m/s and km/s", () => {
    render(<OrbitLabPanel {...base} {...handlers()} experiment={experiment()} experiments={[experiment()]} />);
    const panel = screen.getByRole("region", { name: "Orbit Lab" });
    expect(panel.textContent).toMatch(/J2000\.0/);
    expect(panel.textContent).toMatch(/Ecliptic and mean equinox/);
    expect(panel.textContent).toMatch(/SI: m, kg, s, m\/s/);
    expect(panel.textContent).toMatch(/dddddddd/); // the digest, shortened or whole
    expect(screen.getByText(/Two-body model: Sun \+ Earth–Moon barycentre; positions are barycentres; not a forecast/)).toBeTruthy();
    expect(screen.getByTestId("initial-velocity").textContent).toMatch(/-29800/);
    expect(screen.getByTestId("initial-speed").textContent).toMatch(/30286\.01 m\/s \(30\.286 km\/s\)/);
  });

  it("preview shows baseline and modified speed before creation", () => {
    const h = handlers();
    render(<OrbitLabPanel {...base} {...h} experiment={experiment()} experiments={[experiment()]} />);
    expect(screen.getByRole("button", { name: "Create modified run" }).hasAttribute("disabled")).toBe(true); // nothing chosen yet
    expect(screen.getByText(/Choose a speed factor/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("×1.10"));
    const preview = screen.getByTestId("velocity-preview");
    expect(preview.textContent).toMatch(/preview/i);
    expect(preview.textContent).toMatch(/30286\.01 m\/s \(30\.286 km\/s\)/);
    expect(preview.textContent).toMatch(/33314\.61 m\/s \(33\.315 km\/s\)/); // 1.10 × 30286.011
    expect(preview.textContent).toMatch(/Nothing has been created yet/);
    expect(h.onCreateRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create modified run" }));
    expect(h.onCreateRun).toHaveBeenCalledWith("exp-1", 1.1, false);
  });

  it("offers exactly the system's factors", () => {
    render(<OrbitLabPanel {...base} {...handlers()} experiment={experiment()} experiments={[experiment()]} />);
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual(["0.9", "0.95", "1.05", "1.1"]);
  });

  it("a failed creation shows the backend's reason and no created state", () => {
    render(<OrbitLabPanel {...base} {...handlers()} error="speed factor 1.1000001 is not allowed" experiment={experiment()} experiments={[experiment()]} />);
    expect(screen.getByRole("alert").textContent).toMatch(/not allowed/);
    expect(screen.queryByTestId("modification-record")).toBeNull();
    expect(screen.queryByText(/Initial-state check/)).toBeNull();
  });

  it("shows run navigation only once a modified run exists", () => {
    render(<OrbitLabPanel {...base} {...handlers()} experiment={experiment()} experiments={[experiment()]} />);
    expect(screen.queryByRole("button", { name: /Go to modified run/ })).toBeNull();
  });

  it("deleting needs another universe to be active, and is confirmed", () => {
    const h = handlers();
    const { rerender } = render(<OrbitLabPanel {...base} {...h} experiment={experiment()} experiments={[experiment()]} />);
    expect(screen.getByText(/Switch to another universe first/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete experiment" })).toBeNull();
    rerender(<OrbitLabPanel {...base} {...h} activeUniverseId="uni-default" experiment={experiment()} experiments={[experiment()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete experiment" }));
    expect(h.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Delete both runs/ }));
    expect(h.onDelete).toHaveBeenCalledWith("exp-1");
  });
});

describe("OrbitLabPanel with a modified run", () => {
  const withRun = experiment({ modifiedUniverseId: "uni-mod", modification: modificationOf(1.1) });

  it("records the original and modified velocity, factor, body and baseline, and verifies the single difference", async () => {
    const h = handlers();
    render(<OrbitLabPanel {...base} {...h} experiment={withRun} experiments={[withRun]} />);
    const record = screen.getByTestId("modification-record");
    expect(record.textContent).toMatch(/×1\.10/);
    expect(record.textContent).toMatch(/body-earth/);
    expect(record.textContent).toMatch(/uni-base/);
    expect(record.textContent).toMatch(/m\/s/);
    expect(record.textContent).toMatch(/-1000\.00.*29786\.60.*12\.00/); // original components
    expect(record.textContent).toMatch(/-1100\.00.*32765\.26.*13\.20/); // modified components
    await waitFor(() => expect(screen.getByTestId("initial-check").textContent).toMatch(/Exactly one difference: velocityMPerS of body-earth/));
    expect(screen.getByTestId("initial-check").textContent).toMatch(/configuration identical/i);
    expect(h.getInitialDifferences).toHaveBeenCalledWith("exp-1");
  });

  it("warns when the initial states differ in more than the velocity", async () => {
    const h = handlers();
    h.getInitialDifferences.mockResolvedValue({
      experimentId: "exp-1", baselineUniverseId: "uni-base", modifiedUniverseId: "uni-mod", configEqual: false,
      differences: [{ bodyId: "body-earth", field: "velocityMPerS", baseline: 1, modified: 2 }, { bodyId: "body-earth", field: "massKg", baseline: 1, modified: 2 }],
    });
    render(<OrbitLabPanel {...base} {...h} experiment={withRun} experiments={[withRun]} />);
    const check = await screen.findByTestId("initial-check");
    await waitFor(() => expect(check.textContent).toMatch(/2 differences/));
    expect(check.textContent).toMatch(/massKg/);
    expect(check.textContent).toMatch(/configuration differs/i);
    expect(check.getAttribute("role")).toBe("alert");
  });

  it("switches between the runs, with the active one marked", () => {
    const h = handlers();
    const { rerender } = render(<OrbitLabPanel {...base} {...h} experiment={withRun} experiments={[withRun]} />);
    expect((screen.getByRole("button", { name: /Go to baseline/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Go to modified run/ }));
    expect(h.onActivate).toHaveBeenCalledWith("uni-mod");
    rerender(<OrbitLabPanel {...base} {...h} activeUniverseId="uni-mod" experiment={withRun} experiments={[withRun]} />);
    expect((screen.getByRole("button", { name: /Go to modified run/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Go to baseline/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("recreating needs a choice and a confirmation, and not from the run to be replaced", () => {
    const h = handlers();
    const { rerender } = render(<OrbitLabPanel {...base} {...h} experiment={withRun} experiments={[withRun]} />);
    fireEvent.click(screen.getByLabelText("×0.90"));
    fireEvent.click(screen.getByRole("button", { name: "Recreate modified run" }));
    expect(h.onCreateRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Recreate \(discards/ }));
    expect(h.onCreateRun).toHaveBeenCalledWith("exp-1", 0.9, true);
    rerender(<OrbitLabPanel {...base} {...h} activeUniverseId="uni-mod" experiment={withRun} experiments={[withRun]} />);
    expect((screen.getByRole("button", { name: "Recreate modified run" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Switch to the baseline to recreate/)).toBeTruthy();
  });

  it("everything that would switch or change universes is blocked while a write is pending", () => {
    render(<OrbitLabPanel {...base} {...handlers()} switchDisabled experiment={withRun} experiments={[withRun]} />);
    expect((screen.getByRole("button", { name: /Go to modified run/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("ComparisonPanel", () => {
  it("comparison flags different simulation times", () => {
    const c = comparison({
      baseline: { universeId: "uni-base", simulationTimeS: 10 * 86400, sampleCount: 11 },
      modified: { universeId: "uni-mod", simulationTimeS: 3 * 86400, sampleCount: 4 }, timesDiffer: true, comparedUpToS: 3 * 86400,
    });
    render(<ComparisonPanel comparison={c} error={null} onRefresh={() => {}} />);
    expect(screen.getByTestId("comparison-times").textContent).toMatch(/Baseline t = 10 d.*Modified t = 3 d/);
    const warn = screen.getByTestId("comparison-time-mismatch");
    expect(warn.textContent).toMatch(/different simulation times/);
    expect(warn.textContent).toMatch(/compared up to t = 3 d/);
  });

  it("matching times are not flagged", () => {
    render(<ComparisonPanel comparison={comparison()} error={null} onRefresh={() => {}} />);
    expect(screen.queryByTestId("comparison-time-mismatch")).toBeNull();
    expect(screen.getByTestId("comparison-times").textContent).toMatch(/Baseline t = 3 d.*Modified t = 3 d/);
  });

  it("draws the separation against time with labelled axes and reads out a chosen sample", () => {
    render(<ComparisonPanel comparison={comparison()} error={null} onRefresh={() => {}} />);
    const svg = screen.getByRole("img", { name: /Separation of the two runs/ });
    expect(within(svg as unknown as HTMLElement).getByText("t (days)")).toBeTruthy();
    expect(within(svg as unknown as HTMLElement).getByText(/separation \(m\)/)).toBeTruthy();
    expect(svg.querySelector("polyline")!.getAttribute("points")!.split(" ")).toHaveLength(4);
    const slider = screen.getByLabelText("Common sample") as HTMLInputElement;
    expect(slider.max).toBe("3");
    fireEvent.change(slider, { target: { value: "2" } });
    const read = screen.getByTestId("comparison-readout");
    expect(read.textContent).toMatch(/t = 2 d/);
    expect(read.textContent).toMatch(/Separation: 5\.000e\+8 m/);
    expect(read.textContent).toMatch(/Baseline position/);
    expect(read.textContent).toMatch(/Modified position/);
  });

  it("says what is missing instead of drawing nothing", () => {
    const none = comparison({ commonSampleCount: 0, timesS: [], baselinePositionM: [], modifiedPositionM: [], separationM: [], comparedUpToS: null, issues: ["no modified run has been created yet"] });
    render(<ComparisonPanel comparison={none} error={null} onRefresh={() => {}} />);
    expect(screen.getByText(/no modified run has been created yet/)).toBeTruthy();
    expect(screen.getByText(/Not enough common samples/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("reports window progress and completeness", () => {
    const { rerender } = render(<ComparisonPanel comparison={comparison()} error={null} onRefresh={() => {}} />);
    expect(screen.getByTestId("comparison-window").textContent).toMatch(/Window: 730 d.*incomplete/);
    rerender(<ComparisonPanel comparison={comparison({ windowCompleteBoth: true, complete: true })} error={null} onRefresh={() => {}} />);
    expect(screen.getByTestId("comparison-window").textContent).toMatch(/Window: 730 d, complete/);
    expect(screen.getByTestId("comparison-window").textContent).not.toMatch(/incomplete/);
  });

  it("shows the uncontrolled warning and every backend issue", () => {
    const c = comparison({ controlled: false, firstUncontrolledAtS: 5 * 86400, issues: ["the modified run is uncontrolled since t = 432000 s (a physical edit was made after it was created)"] });
    render(<ComparisonPanel comparison={c} error={null} onRefresh={() => {}} />);
    expect(screen.getByTestId("comparison-uncontrolled").textContent).toMatch(/Uncontrolled since t = 5 d/);
    expect(screen.getByText(/a physical edit was made after it was created/)).toBeTruthy();
  });

  it("shows a refresh failure while keeping the last comparison", () => {
    render(<ComparisonPanel comparison={comparison()} error="The backend did not answer GET comparison" onRefresh={() => {}} />);
    expect(screen.getByRole("alert").textContent).toMatch(/did not answer/);
    expect(screen.getByRole("img", { name: /Separation/ })).toBeTruthy();
  });

  it("comparison never calls mutating endpoints (the panel only reads what it is given and can ask to refresh)", () => {
    const onRefresh = vi.fn();
    render(<ComparisonPanel comparison={comparison()} error={null} onRefresh={onRefresh} />);
    fireEvent.change(screen.getByLabelText("Common sample"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh comparison" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
