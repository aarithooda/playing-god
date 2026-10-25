import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewControlContract } from "../../sim/viewControlContract";
import { ViewToolbar } from "./ViewToolbar";

afterEach(cleanup);

function controls(overrides: Partial<ViewControlContract["state"]> = {}): ViewControlContract {
  return {
    state: {
      axesVisible: false,
      gridEnabled: false,
      gridShownForPlacement: false,
      canFitView: true,
      canFocusSelected: false,
      ...overrides,
    },
    actions: {
      setAxesVisible: vi.fn(),
      setGridVisible: vi.fn(),
      fitView: vi.fn(),
      focusSelected: vi.fn(),
    },
  };
}

describe("ViewToolbar", () => {
  it("keeps Axes and Grid independent and reports their pressed states", () => {
    const view = controls({ axesVisible: false, gridEnabled: true });
    render(<ViewToolbar controls={view} />);

    expect(screen.getByRole("button", { name: "Axes" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Axes" }));
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(view.actions.setAxesVisible).toHaveBeenCalledWith(true);
    expect(view.actions.setGridVisible).toHaveBeenCalledWith(false);
  });

  it("offers overview and selected-body focus, disabling focus until a body is selected", () => {
    const view = controls();
    const { rerender } = render(<ViewToolbar controls={view} />);
    const overview = screen.getByRole("button", { name: "Fit view to all bodies" }) as HTMLButtonElement;
    const focus = screen.getByRole("button", { name: "Focus selected body" }) as HTMLButtonElement;
    expect(overview.disabled).toBe(false);
    expect(focus.disabled).toBe(true);
    fireEvent.click(overview);
    expect(view.actions.fitView).toHaveBeenCalledTimes(1);

    const selected = controls({ canFocusSelected: true });
    rerender(<ViewToolbar controls={selected} />);
    const enabledFocus = screen.getByRole("button", { name: "Focus selected body" }) as HTMLButtonElement;
    expect(enabledFocus.disabled).toBe(false);
    fireEvent.click(enabledFocus);
    expect(selected.actions.focusSelected).toHaveBeenCalledTimes(1);
  });


  it("switches between the Universe and Exploration views and says which one is active", () => {
    const onSizeModeChange = vi.fn();
    const { rerender } = render(<ViewToolbar controls={controls()} sizeMode="exploration" onSizeModeChange={onSizeModeChange} />);
    expect(screen.getByRole("button", { name: "Exploration View" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Universe View" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Universe View" }));
    expect(onSizeModeChange).toHaveBeenCalledWith("universe");
    rerender(<ViewToolbar controls={controls()} sizeMode="universe" onSizeModeChange={onSizeModeChange} />);
    expect(screen.getByRole("button", { name: "Universe View" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("does not show the placement note once the user has the grid on themselves", () => {
    render(<ViewToolbar controls={controls({ gridEnabled: true, gridShownForPlacement: true })} />);
    expect(screen.queryByTestId("grid-placement-note")).toBeNull();
  });

  it("keeps the grid preference off while showing the placement aid", () => {
    render(<ViewToolbar controls={controls({ gridShownForPlacement: true })} />);
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("grid-placement-note").textContent).toMatch(/temporarily on for placement/);
  });
});
