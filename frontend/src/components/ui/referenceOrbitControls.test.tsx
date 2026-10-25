import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewToolbar } from "./ViewToolbar";
import type { ViewControlContract } from "../../sim/viewControlContract";

afterEach(cleanup);

const controls = {
  state: { axesVisible: false, gridEnabled: false, gridShownForPlacement: false, canFitView: true, canFocusSelected: false },
  actions: { setAxesVisible: () => {}, setGridVisible: () => {}, fitView: () => {}, focusSelected: () => {} },
} as unknown as ViewControlContract;

describe("Solar System guide toggles (D-064)", () => {
  it("are offered only when the caller supports them, and say the guides are display only", () => {
    render(<ViewToolbar controls={controls} paths onPathsChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Orbit guides" })).toBeNull();
    cleanup();

    const onGuides = vi.fn();
    const onBelt = vi.fn();
    render(<ViewToolbar controls={controls} guides={{ orbits: true, onOrbitsChange: onGuides, belt: false, onBeltChange: onBelt }} />);
    const guides = screen.getByRole("button", { name: "Orbit guides" });
    const belt = screen.getByRole("button", { name: "Asteroid belt" });
    expect(guides.getAttribute("aria-pressed")).toBe("true");
    expect(belt.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(guides);
    fireEvent.click(belt);
    expect(onGuides).toHaveBeenCalledWith(false);
    expect(onBelt).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("reference-orbits-note").textContent).toMatch(/not simulated/);
  });
});
