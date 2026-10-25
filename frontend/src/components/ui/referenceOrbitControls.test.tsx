import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewPanel } from "./ViewPanel";

afterEach(cleanup);

describe("Solar System guide toggles (D-064)", () => {
  it("are offered only when the caller supports them, and say the guides are display only", () => {
    render(<ViewPanel paths onPathsChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Orbit guides" })).toBeNull();
    cleanup();

    const onGuides = vi.fn();
    const onBelt = vi.fn();
    render(<ViewPanel referenceOrbits onReferenceOrbitsChange={onGuides} mainBelt={false} onMainBeltChange={onBelt} />);
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
