import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/errors";
import { fakeClient, solarPreset, universe } from "../../test/fixtures";
import { ConfirmButton } from "./ConfirmButton";
import { PresetPicker } from "./PresetPicker";
import { SnapshotPanel } from "./SnapshotPanel";
import { UniverseSwitcher } from "./UniverseSwitcher";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ConfirmButton", () => {
  it("needs a second press, and Cancel disarms it", () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Reset" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm: Reset" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
  });

  it("disarms itself after a few seconds", () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Reset" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    act(() => void vi.advanceTimersByTime(7000));
    expect(screen.queryByRole("button", { name: "Confirm: Reset" })).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("UniverseSwitcher", () => {
  const baseProps = {
    switchDisabled: false, busy: false, error: null, onActivate: vi.fn(), onCreateEmpty: vi.fn(), onDelete: vi.fn(), onDismissError: vi.fn(),
  };

  it("labels each Orbit Lab role and marks the active universe", () => {
    render(
      <UniverseSwitcher
        {...baseProps}
        universes={[
          universe({ id: "a", name: "Baseline", role: "baseline", active: true }),
          universe({ id: "b", name: "Modified x1.10", role: "modified", active: false, simulationTimeS: 86400 }),
        ]}
      />,
    );
    expect(screen.getByTestId("active-universe").textContent).toMatch(/Orbit Lab baseline/);
    const other = screen.getByRole("button", { name: "Switch to Modified x1.10" });
    expect(other.textContent).toMatch(/t = 1 d/);
    expect((screen.getByRole("button", { name: "Active universe Baseline" }) as HTMLButtonElement).disabled).toBe(true);
    // experiment runs are deleted through the experiment, never from the list
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("explains why switching is blocked", () => {
    render(
      <UniverseSwitcher
        {...baseProps}
        switchDisabled
        switchDisabledReason="A change is still being saved."
        universes={[universe({ id: "a", active: true }), universe({ id: "b", name: "B", active: false })]}
      />,
    );
    expect((screen.getByRole("button", { name: "Switch to B" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("A change is still being saved.")).toBeTruthy();
  });
});

describe("PresetPicker", () => {
  it("loads the chosen available preset and says it creates a new universe", () => {
    const onLoad = vi.fn();
    render(<PresetPicker presets={[solarPreset]} disabled={false} onLoad={onLoad} />);
    fireEvent.click(screen.getByRole("button", { name: "Load as new universe" }));
    expect(onLoad).toHaveBeenCalledWith("solar-system-j2000");
    expect(screen.getByText(/nothing existing is replaced/)).toBeTruthy();
  });

  it("an unavailable preset cannot be loaded and shows why", () => {
    const onLoad = vi.fn();
    render(
      <PresetPicker
        presets={[{ ...solarPreset, available: false, unavailableReason: "source file does not match its recorded hash" }]}
        disabled={false}
        onLoad={onLoad}
      />,
    );
    expect(screen.getByText(/does not match its recorded hash/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Load as new universe" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders nothing when the backend offers no presets", () => {
    const { container } = render(<PresetPicker presets={[]} disabled={false} onLoad={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("SnapshotPanel", () => {
  const snap = { id: "s1", name: "before", createdAtIso: "t", simulationTimeS: 172800, bodyCount: 2, revision: 3, controlled: true };
  let onBusy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    onBusy = vi.fn();
  });
  const scoped = (o = {}) => fakeClient(o).scoped({ universeId: "uni-default", activationEpoch: 1 });

  it("lists snapshots with their time and saves a new one with its name", async () => {
    const createSnapshot = vi.fn(async () => snap);
    const listSnapshots = vi.fn(async () => [snap]);
    render(<SnapshotPanel client={scoped({ createSnapshot, listSnapshots })} disabled={false} onBeforeRestore={() => {}} onRestored={() => {}} onBusyChange={onBusy} />);
    expect((await screen.findByTestId("snapshot-item")).textContent).toMatch(/before.*t = 2 d.*2 bodies/);
    fireEvent.change(screen.getByLabelText("Snapshot name"), { target: { value: " my save " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(createSnapshot).toHaveBeenCalledWith("my save"));
    await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
    expect(onBusy).toHaveBeenCalledWith(true);
  });

  it("restore needs confirmation, pauses first, then asks the workspace to reload", async () => {
    const restoreSnapshot = vi.fn(async () => ({ status: "paused" as const, simulationTimeS: 0, bodies: [], diagnostics: null, diagnosticsIssue: null }));
    const onBeforeRestore = vi.fn();
    const onRestored = vi.fn();
    render(
      <SnapshotPanel client={scoped({ listSnapshots: async () => [snap], restoreSnapshot })} disabled={false} onBeforeRestore={onBeforeRestore} onRestored={onRestored} onBusyChange={onBusy} />,
    );
    await screen.findByTestId("snapshot-item");
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(restoreSnapshot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Restore \(discards/ }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    expect(restoreSnapshot).toHaveBeenCalledWith("s1");
    expect(onBeforeRestore).toHaveBeenCalledTimes(1);
  });

  it("shows the backend's refusal and does not claim success", async () => {
    const restoreSnapshot = vi.fn(async () => {
      throw new ApiError("http", "restore failed, nothing was changed: boom", 500, "restore_failed");
    });
    const onRestored = vi.fn();
    render(<SnapshotPanel client={scoped({ listSnapshots: async () => [snap], restoreSnapshot })} disabled={false} onBeforeRestore={() => {}} onRestored={onRestored} onBusyChange={onBusy} />);
    await screen.findByTestId("snapshot-item");
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(screen.getByRole("button", { name: /Restore \(discards/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/nothing was changed: boom/);
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("a blocked universe shows the reason instead of controls", () => {
    render(<SnapshotPanel client={scoped()} disabled={false} blockedReason="The baseline is immutable." onBeforeRestore={() => {}} onRestored={() => {}} onBusyChange={onBusy} />);
    expect(screen.getByText("The baseline is immutable.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
