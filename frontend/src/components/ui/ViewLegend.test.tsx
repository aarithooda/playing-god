import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ViewLegend } from "./ViewLegend";

afterEach(cleanup);

describe("ViewLegend", () => {
  it("shows nothing while both overlays are off", () => {
    const { container } = render(<ViewLegend showAxes={false} showGrid={false} cellMeters={2e10} />);
    expect(container.innerHTML).toBe("");
  });

  it("states the grid cell and that the axes extend through the origin", () => {
    const { rerender } = render(<ViewLegend showAxes={false} showGrid cellMeters={2e10} />);
    expect(screen.getByTestId("view-legend").textContent).toMatch(/2e10 m per cell/);
    expect(screen.getByTestId("view-legend").textContent).not.toMatch(/Axes/);
    rerender(<ViewLegend showAxes showGrid={false} cellMeters={2e10} />);
    expect(screen.getByTestId("view-legend").textContent).toMatch(/Axes extend through \(0, 0, 0\)/);
    expect(screen.getByTestId("view-legend").textContent).not.toMatch(/per cell/);
  });
});
