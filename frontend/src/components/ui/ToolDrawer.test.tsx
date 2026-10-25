import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolDrawer } from "./ToolDrawer";
import { ToolRail, TOOLS, type ToolId } from "./ToolRail";

afterEach(cleanup);

const sections = (extra: Partial<Record<ToolId, React.ReactNode>> = {}): Record<ToolId, React.ReactNode> => ({
  create: <p>create body</p>, universes: <p>universes body</p>, orbitlab: <p>lab</p>, events: <p>events</p>,
  history: <p>history</p>, diagnostics: <p>diagnostics</p>, ...extra,
});

describe("ToolRail", () => {
  it("names every tool, marks the open one as pressed and reports presses", () => {
    const onSelect = vi.fn();
    render(<ToolRail activeTool="events" drawerOpen onSelect={onSelect} />);
    for (const tool of TOOLS) expect(screen.getByRole("button", { name: tool.label })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Events" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "History" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(onSelect).toHaveBeenCalledWith("history");
  });

  it("presses nothing while the drawer is closed", () => {
    render(<ToolRail activeTool="events" drawerOpen={false} onSelect={() => {}} />);
    expect(screen.getAllByRole("button").every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("puts a real count on a tool and in its accessible name", () => {
    render(<ToolRail activeTool="create" drawerOpen onSelect={() => {}} badges={{ events: 3 }} />);
    expect(screen.getByRole("button", { name: "Events (3)" })).toBeTruthy();
  });
});

describe("ToolDrawer", () => {
  it("titles itself after the active tool and closes through an accessible button", () => {
    const onClose = vi.fn();
    render(<ToolDrawer open tool="history" onClose={onClose} sections={sections()} />);
    expect(screen.getByRole("heading", { name: "History" })).toBeTruthy();
    expect(screen.getByTestId("sidebar-left").getAttribute("data-open")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Close History" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows only the active tool", () => {
    render(<ToolDrawer open tool="universes" onClose={() => {}} sections={sections()} />);
    expect(screen.getByTestId("drawer-universes").style.display).toBe("flex");
    expect(screen.getByTestId("drawer-create").style.display).toBe("none");
  });

  it("keeps every tool's content mounted (drafts survive a switch or a close) but hidden", () => {
    const withDraft = sections({ create: <input aria-label="draft" /> });
    const { rerender } = render(<ToolDrawer open tool="create" onClose={() => {}} sections={withDraft} />);
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "keep me" } });
    rerender(<ToolDrawer open tool="events" onClose={() => {}} sections={withDraft} />);
    expect((screen.getByDisplayValue("keep me") as HTMLInputElement).parentElement!.style.display).toBe("none");
    rerender(<ToolDrawer open={false} tool="create" onClose={() => {}} sections={withDraft} />);
    expect(screen.getByTestId("sidebar-left").getAttribute("data-open")).toBe("false");
    expect((screen.getByDisplayValue("keep me") as HTMLInputElement).parentElement!.style.display).toBe("none");
  });
});
