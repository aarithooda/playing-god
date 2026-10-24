import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistorySampleDto } from "../../api/types";
import { applyHistoryPage, type HistoryCache } from "../../sim/history/historyModel";
import type { HistoryNavigation } from "../../sim/history/useHistoryNavigation";
import type { EventView } from "../../sim/viewModel";
import { HistoryTimeline } from "./HistoryTimeline";
import { ViewPanel } from "./ViewPanel";

afterEach(cleanup);

const meta = { name: "A", colorHex: "#ff0000", radiusM: 10, kind: "planet" };
const sample = (i: number): HistorySampleDto => ({ index: i, simulationTimeS: i * 86400, segment: 0, positionsM: { a: [i, 0, 0] } });
const cacheOf = (indices: number[], o: Partial<HistoryCache> = {}): HistoryCache => ({
  ...applyHistoryPage(null, { universeId: "u1", mode: "grid", sampleIntervalS: 86400, generation: 1, firstIndex: indices[0] ?? 0, nextIndex: (indices[indices.length - 1] ?? -1) + 1, droppedBefore: 0, truncated: false, samples: indices.map(sample), bodies: { a: meta } }),
  ...o,
});
const nav = (o: Partial<HistoryNavigation> = {}): HistoryNavigation => ({
  mode: "live", position: null, replaying: false, rate: 1, seek: vi.fn(), stepBy: vi.fn(), replay: vi.fn(), stopReplay: vi.fn(), returnToLive: vi.fn(), setRate: vi.fn(), ...o,
});
const base = { status: "idle" as const, error: null, liveTimeS: 4 * 86400, events: [] as EventView[], onRefresh: () => {} };

describe("HistoryTimeline", () => {
  it("says there is nothing recorded yet", () => {
    render(<HistoryTimeline {...base} cache={null} nav={nav()} />);
    expect(screen.getByText(/No recorded history yet/)).toBeTruthy();
  });

  it("HistoryTimeline shows live and viewed times and incomplete banner", () => {
    const n = nav();
    const { rerender } = render(<HistoryTimeline {...base} cache={cacheOf([0, 1, 2, 3, 4])} nav={n} />);
    expect(screen.getByTestId("history-time").textContent).toBe("Live: t = 4 d");
    expect(screen.queryByText(/Viewing recorded history/)).toBeNull();
    expect(screen.queryByText(/History may be incomplete/)).toBeNull();

    rerender(<HistoryTimeline {...base} cache={cacheOf([0, 1, 2, 3, 4])} nav={nav({ mode: "history", position: 2 })} />);
    expect(screen.getByTestId("history-time").textContent).toBe("t = 2 d (sample 3 of 5)");
    expect(screen.getByText(/Viewing recorded history — the simulation is not advancing/)).toBeTruthy();
    expect(screen.getByTestId("history-live-time").textContent).toBe("Live: t = 4 d");

    rerender(<HistoryTimeline {...base} status="stale" error="The backend did not answer GET history" cache={cacheOf([0, 1])} nav={nav()} />);
    expect(screen.getByText(/History may be incomplete: could not update.*did not answer/)).toBeTruthy();

    rerender(<HistoryTimeline {...base} cache={cacheOf([0, 1, 4], { gaps: [2] })} nav={nav()} />);
    expect(screen.getByText(/History may be incomplete: some samples were not received/)).toBeTruthy();

    rerender(<HistoryTimeline {...base} cache={cacheOf([0, 1], { truncated: true })} nav={nav()} />);
    expect(screen.getByText(/History may be incomplete: the backend stopped recording/)).toBeTruthy();
  });

  it("says when the oldest samples were discarded", () => {
    const { rerender } = render(<HistoryTimeline {...base} cache={cacheOf([5, 6], { droppedBefore: 5 })} nav={nav()} />);
    expect(screen.getByText(/Oldest samples discarded/)).toBeTruthy();
    rerender(<HistoryTimeline {...base} cache={cacheOf([5, 6], { clientTrimmed: true })} nav={nav()} />);
    expect(screen.getByText(/Oldest samples discarded/)).toBeTruthy();
  });

  it("the slider seeks by position and the buttons step, replay and return to live", () => {
    const n = nav({ mode: "history", position: 1 });
    render(<HistoryTimeline {...base} cache={cacheOf([0, 1, 2, 3])} nav={n} />);
    const slider = screen.getByLabelText("History position") as HTMLInputElement;
    expect(slider.max).toBe("3");
    expect(slider.value).toBe("1");
    fireEvent.change(slider, { target: { value: "3" } });
    expect(n.seek).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: "Previous sample" }));
    expect(n.stepBy).toHaveBeenLastCalledWith(-1);
    fireEvent.click(screen.getByRole("button", { name: "Next sample" }));
    expect(n.stepBy).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(n.replay).toHaveBeenCalledWith(1);
    fireEvent.change(screen.getByLabelText("Replay speed"), { target: { value: "5" } });
    expect(n.setRate).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByRole("button", { name: "Return to live" }));
    expect(n.returnToLive).toHaveBeenCalled();
  });

  it("offers Stop while replaying, and Return to live only in history", () => {
    const { rerender } = render(<HistoryTimeline {...base} cache={cacheOf([0, 1, 2])} nav={nav()} />);
    expect(screen.queryByRole("button", { name: "Return to live" })).toBeNull();
    const n = nav({ mode: "history", position: 0, replaying: true });
    rerender(<HistoryTimeline {...base} cache={cacheOf([0, 1, 2])} nav={n} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(n.stopReplay).toHaveBeenCalled();
  });

  it("marks recorded merger events on the timeline at their simulation time", () => {
    const ev = (id: string, t: number): EventView => ({ id, type: "merger", simulationTimeS: t, bodyIds: ["a", "b"], resultBodyId: "a", resultMassKg: 1, relativeSpeedMPerS: 1, kineticEnergyLostJ: 1 } as EventView);
    render(<HistoryTimeline {...base} cache={cacheOf([0, 1, 2, 3, 4])} nav={nav()} events={[ev("e1", 2 * 86400), ev("e2", 99 * 86400)]} />);
    const markers = screen.getAllByTestId("history-event-marker");
    expect(markers).toHaveLength(1); // the second event is outside the recorded span and is not drawn
    expect(markers[0]!.style.left).toBe("50%");
    expect(markers[0]!.getAttribute("title")).toMatch(/Merger at t = 2 d/);
  });
});

describe("Show paths", () => {
  const view = { axes: false, grid: false, gridShownForPlacement: false, onAxesChange: () => {}, onGridChange: () => {} };
  it("is a toggle in the View panel, off by default, with a hint for crowded scenes", () => {
    const onPathsChange = vi.fn();
    const { rerender } = render(<ViewPanel {...view} paths={false} onPathsChange={onPathsChange} />);
    const b = screen.getByRole("button", { name: "Show paths" });
    expect(b.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(b);
    expect(onPathsChange).toHaveBeenCalledWith(true);
    rerender(<ViewPanel {...view} paths pathsNote="Select a body to show its path (more than 20 bodies)." onPathsChange={onPathsChange} />);
    expect(screen.getByText(/Select a body to show its path/)).toBeTruthy();
  });

  it("existing callers without paths support show no paths control", () => {
    render(<ViewPanel {...view} />);
    expect(screen.queryByRole("button", { name: "Show paths" })).toBeNull();
  });
});
