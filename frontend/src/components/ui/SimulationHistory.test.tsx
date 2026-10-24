import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { earth, sun, state } from "../../test/fixtures";
import { toSimulationView } from "../../sim/viewModel";
import { createTrajectoryHistory, appendTrajectorySnapshot } from "../../sim/trajectoryHistory";
import { SimulationHistory } from "./SimulationHistory";

afterEach(cleanup);

describe("SimulationHistory", () => {
  it("has a truthful empty state before any backend snapshot is available", () => {
    render(<SimulationHistory history={null} />);
    expect(screen.getByRole("status").textContent).toMatch(/backend loads/);
  });

  it("browses copied backend snapshots without calling a seek operation", () => {
    const first = toSimulationView(state([sun, earth], 0));
    const movedEarth = { ...earth, positionM: { x: 1.4e11, y: 3e9, z: 0 } };
    const second = toSimulationView(state([sun, movedEarth], 86400));
    const history = appendTrajectorySnapshot(createTrajectoryHistory(1, first), second);
    render(<SimulationHistory history={history} />);

    expect(screen.getByText(/Live backend state: 1 d/)).toBeTruthy();
    expect(screen.getByText(/position: \(1\.4e11, 3e9, 0\) m/)).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Recorded simulation time" }), { target: { value: "0" } });
    expect(screen.getByText(/Recorded snapshot: 0 s/)).toBeTruthy();
    expect(screen.getByText(/position: \(1\.496e11, 0, 0\) m/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Return to live" }));
    expect(screen.getByText(/Live backend state: 1 d/)).toBeTruthy();
  });

  it("labels trimmed history and disables navigation at the bounds", () => {
    let history = createTrajectoryHistory(2, toSimulationView(state([sun], 0)));
    history = appendTrajectorySnapshot(history, toSimulationView(state([sun], 1)));
    render(<SimulationHistory history={{ ...history, truncated: true }} />);

    expect(screen.getByText(/Older snapshots were trimmed/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous recorded state" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Next recorded state" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("slider", { name: "Recorded simulation time" }), { target: { value: "0" } });
    expect((screen.getByRole("button", { name: "Previous recorded state" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Next recorded state" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
