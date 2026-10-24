import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewLegend } from "./ViewLegend";
import { ViewPanel } from "./ViewPanel";

afterEach(cleanup);

const base = { axes: false, grid: false, gridShownForPlacement: false, onAxesChange: () => {}, onGridChange: () => {} };

describe("ViewPanel", () => {
  it("offers Axes and Grid as two separate toggle buttons that reflect their state", () => {
    const { rerender } = render(<ViewPanel {...base} />);
    expect(screen.getByRole("button", { name: "Axes" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("false");
    rerender(<ViewPanel {...base} axes />);
    expect(screen.getByRole("button", { name: "Axes" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("each button changes only its own setting", () => {
    const onAxesChange = vi.fn();
    const onGridChange = vi.fn();
    render(<ViewPanel {...base} onAxesChange={onAxesChange} onGridChange={onGridChange} grid />);
    fireEvent.click(screen.getByRole("button", { name: "Axes" }));
    expect(onAxesChange).toHaveBeenLastCalledWith(true);
    expect(onGridChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(onGridChange).toHaveBeenLastCalledWith(false); // it was on, so the click turns it off
  });

  it("explains a grid that is shown only for placement, without pressing the Grid button", () => {
    render(<ViewPanel {...base} gridShownForPlacement />);
    expect(screen.getByTestId("grid-placement-note")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("does not show the placement note once the user has the grid on themselves", () => {
    render(<ViewPanel {...base} grid gridShownForPlacement />);
    expect(screen.queryByTestId("grid-placement-note")).toBeNull();
  });
});

describe("ViewLegend", () => {
  it("shows nothing while both overlays are off", () => {
    const { container } = render(<ViewLegend showAxes={false} showGrid={false} cellMeters={2e10} axisHalfLengthM={2e11} />);
    expect(container.innerHTML).toBe("");
  });

  it("states the grid cell and the axis length in metres for the overlays that are visible", () => {
    const { rerender } = render(<ViewLegend showAxes={false} showGrid cellMeters={2e10} axisHalfLengthM={2e11} />);
    expect(screen.getByTestId("view-legend").textContent).toMatch(/2e10 m per cell/);
    expect(screen.getByTestId("view-legend").textContent).not.toMatch(/Axes/);
    rerender(<ViewLegend showAxes showGrid={false} cellMeters={2e10} axisHalfLengthM={2e11} />);
    expect(screen.getByTestId("view-legend").textContent).toMatch(/Axes through \(0, 0, 0\), ±2e11 m/);
    expect(screen.getByTestId("view-legend").textContent).not.toMatch(/per cell/);
  });
});
