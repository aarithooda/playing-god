import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { SIDEBAR_OPEN_WIDTH, SIDEBAR_RAIL_WIDTH } from "./layout";

afterEach(cleanup);

describe("Sidebar", () => {
  it("is as wide as the layout says when open and when collapsed", () => {
    const { rerender } = render(<Sidebar side="right" title="Controls" open onToggle={() => {}}><p>body</p></Sidebar>);
    expect(screen.getByTestId("sidebar-right").style.width).toBe(`${SIDEBAR_OPEN_WIDTH}px`);
    rerender(<Sidebar side="right" title="Controls" open={false} onToggle={() => {}}><p>body</p></Sidebar>);
    expect(screen.getByTestId("sidebar-right").style.width).toBe(`${SIDEBAR_RAIL_WIDTH}px`);
  });

  it("asks to toggle through an accessible button", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<Sidebar side="left" title="History" open={false} onToggle={onToggle}><p>x</p></Sidebar>);
    const button = screen.getByRole("button", { name: "Expand History" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenLastCalledWith(true);
    rerender(<Sidebar side="left" title="History" open onToggle={onToggle}><p>x</p></Sidebar>);
    fireEvent.click(screen.getByRole("button", { name: "Collapse History" }));
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it("keeps its content mounted (drafts survive) but hidden while collapsed", () => {
    const { rerender } = render(<Sidebar side="right" title="Controls" open onToggle={() => {}}><input aria-label="draft" /></Sidebar>);
    const input = screen.getByLabelText("draft") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "keep me" } });
    rerender(<Sidebar side="right" title="Controls" open={false} onToggle={() => {}}><input aria-label="draft" /></Sidebar>);
    const hidden = screen.getByDisplayValue("keep me") as HTMLInputElement;
    expect(hidden.value).toBe("keep me");
    expect(hidden.parentElement!.style.display).toBe("none");
  });
});
