import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { earth } from "../../test/fixtures";
import { toBodyView } from "../../sim/viewModel";
import { BodyInspector } from "./BodyInspector";
import { ControlPanel } from "./ControlPanel";
import { PlacementHint } from "./PlacementHint";
import { UndoNotice } from "./UndoNotice";

afterEach(cleanup);

const ok = async (..._args: unknown[]) => ({ ok: true }) as const;

describe("PlacementHint", () => {
  it("shows the cursor position in SI metres in the physics frame", () => {
    render(<PlacementHint position={{ x: 1.5e11, y: -2e10, z: 0 }} />);
    expect(screen.getByTestId("placement-readout").textContent).toBe("x 1.5e11 m · y -2e10 m · z 0 m");
  });

  it("shows placeholders while the cursor is off the plane and always lists the controls", () => {
    render(<PlacementHint position={null} />);
    expect(screen.getByTestId("placement-readout").textContent).toBe("x – · y – · z –");
    expect(screen.getByText(/Esc to cancel/)).toBeTruthy();
  });
});

describe("UndoNotice", () => {
  it("names the body and wires Undo and dismiss", () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(<UndoNotice bodyName="Probe" onUndo={onUndo} onDismiss={onDismiss} />);
    expect(screen.getByText("Created Probe")).toBeTruthy();
    fireEvent.click(screen.getByText("Undo"));
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect([onUndo.mock.calls.length, onDismiss.mock.calls.length]).toEqual([1, 1]);
  });
});

describe("BodyInspector close button", () => {
  it("calls onClose; pressing elsewhere in the document never closes it (canvas owns dismissal)", () => {
    const onClose = vi.fn();
    render(<BodyInspector body={toBodyView(earth)} onSave={ok} onDelete={ok} onFocus={() => {}} onClose={onClose} />);
    fireEvent.pointerDown(document.body);
    fireEvent.pointerUp(document.body);
    fireEvent.click(document.body);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Close body inspector"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ControlPanel creation", () => {
  const base = {
    playing: false, stepping: false, canRun: true, disabled: false, simulationTimeS: 0, speedExp: 5,
    stepSeconds: 1e5, onSpeedChange: () => {}, onPlay: () => {}, onPause: () => {}, onStep: () => {},
    onReset: () => {}, onFit: () => {}, onCreate: ok,
  };

  it("ignores a second create request while the first is still in flight", async () => {
    let release!: () => void;
    const onCreate = vi.fn(() => new Promise<{ ok: true }>((resolve) => { release = () => resolve({ ok: true }); }));
    render(<ControlPanel {...base} onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Add body…"));
    fireEvent.click(screen.getByText("Create"));
    fireEvent.click(screen.getByText("Create"));
    expect(onCreate).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.queryByText("Create")).toBeNull());
  });

  it("a picked 3D position creates once even if the same pick is re-rendered", async () => {
    const onCreate = vi.fn(ok);
    const picked = { position: { x: 1e9, y: 2e9, z: 3e9 }, nonce: 1 };
    const { rerender } = render(<ControlPanel {...base} onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Add body…"));
    rerender(<ControlPanel {...base} onCreate={onCreate} pickedPosition={picked} />);
    rerender(<ControlPanel {...base} onCreate={onCreate} pickedPosition={picked} />);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ positionM: { x: 1e9, y: 2e9, z: 3e9 } }));
  });
});
