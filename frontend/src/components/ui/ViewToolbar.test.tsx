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
    render(<ViewToolbar controls={view} playing={false} canRun onPlay={vi.fn()} onPause={vi.fn()} disabled={false} />);

    expect(screen.getByRole("button", { name: "Axes" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Axes" }));
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(view.actions.setAxesVisible).toHaveBeenCalledWith(true);
    expect(view.actions.setGridVisible).toHaveBeenCalledWith(false);
  });

  it("offers overview and selected-body focus, disabling focus until a body is selected", () => {
    const view = controls();
    const { rerender } = render(<ViewToolbar controls={view} playing={false} canRun onPlay={vi.fn()} onPause={vi.fn()} disabled={false} />);
    const overview = screen.getByRole("button", { name: "Fit view to all bodies" }) as HTMLButtonElement;
    const focus = screen.getByRole("button", { name: "Focus selected body" }) as HTMLButtonElement;
    expect(overview.disabled).toBe(false);
    expect(focus.disabled).toBe(true);
    fireEvent.click(overview);
    expect(view.actions.fitView).toHaveBeenCalledTimes(1);

    const selected = controls({ canFocusSelected: true });
    rerender(<ViewToolbar controls={selected} playing={false} canRun onPlay={vi.fn()} onPause={vi.fn()} disabled={false} />);
    const enabledFocus = screen.getByRole("button", { name: "Focus selected body" }) as HTMLButtonElement;
    expect(enabledFocus.disabled).toBe(false);
    fireEvent.click(enabledFocus);
    expect(selected.actions.focusSelected).toHaveBeenCalledTimes(1);
  });


  it("keeps playback controls beside axes and grid", () => {
    const view = controls();
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const { rerender } = render(<ViewToolbar controls={view} playing={false} canRun onPlay={onPlay} onPause={onPause} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    rerender(<ViewToolbar controls={view} playing onPlay={onPlay} onPause={onPause} canRun disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });
  it("keeps the grid preference off while showing the placement aid", () => {
    render(<ViewToolbar controls={controls({ gridShownForPlacement: true })} playing={false} canRun onPlay={vi.fn()} onPause={vi.fn()} disabled={false} />);
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("grid-placement-note").textContent).toMatch(/temporarily on for placement/);
  });
});
