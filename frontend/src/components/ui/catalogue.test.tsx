// Catalogue panel, custom stars/planets and the physical-vs-displayed radius distinction (M5).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { betelgeuseEntry, earth, earthEntry, sun } from "../../test/fixtures";
import { toBodyView } from "../../sim/viewModel";
import { BodyInspector } from "./BodyInspector";
import { CataloguePanel } from "./CataloguePanel";
import { ControlPanel } from "./ControlPanel";

afterEach(cleanup);

const ok = async (..._args: unknown[]) => ({ ok: true }) as const;

describe("CataloguePanel", () => {
  it("shows image-and-name tiles in a three-column grid and starts placement from a tile", () => {
    const entries = structuredClone([earthEntry]);
    const frozen = JSON.stringify(entries);
    const onPlace = vi.fn();
    render(<CataloguePanel entries={entries} onPlace={onPlace} disabled={false} />);
    fireEvent.click(screen.getByRole("tab", { name: "Planets" }));
    const tile = screen.getByRole("button", { name: "Place Earth" });
    expect(within(tile).getByRole("img").getAttribute("src")).toMatch(/earth_diffuse/);
    expect(tile.textContent).toBe("Earth");
    expect(tile.parentElement?.getAttribute("style")).toContain("repeat(3, minmax(0, 1fr))");
    fireEvent.click(tile);
    expect(onPlace).toHaveBeenCalledWith(entries[0]);
    expect(JSON.stringify(entries)).toBe(frozen);
  });

  it("is empty-safe and disabled while the universe is not usable", () => {
    const { container, rerender } = render(<CataloguePanel entries={[]} onPlace={() => {}} disabled={false} />);
    expect(container.innerHTML).toBe("");
    rerender(<CataloguePanel entries={[earthEntry]} onPlace={() => {}} disabled />);
    fireEvent.click(screen.getByRole("tab", { name: "Planets" }));
    expect((screen.getByRole("button", { name: "Place Earth" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("custom stars and planets", () => {
  const base = {
    playing: false, stepping: false, canRun: true, disabled: false, simulationTimeS: 0, speedExp: 5, stepSeconds: 1e5,
    onSpeedChange: () => {}, onPlay: () => {}, onPause: () => {}, onStep: () => {}, onReset: () => {}, onFit: () => {},
  };

  it("create star sends kind star", async () => {
    const onCreate = vi.fn(ok);
    render(<ControlPanel {...base} onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Add body…"));
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "star" } });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ kind: "star" });
  });

  it("a plain body does not send a kind (the backend default is planet)", async () => {
    const onCreate = vi.fn(ok);
    render(<ControlPanel {...base} onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Add body…"));
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0]).not.toHaveProperty("kind");
    expect(onCreate.mock.calls[0]![0]).not.toHaveProperty("catalogueEntryId");
  });

  it("catalogue entry prefills form without mutating the catalogue", async () => {
    const entry = structuredClone(betelgeuseEntry);
    const before = JSON.stringify(entry);
    const onCreate = vi.fn(ok);
    const { rerender } = render(<ControlPanel {...base} onCreate={onCreate} />);
    rerender(<ControlPanel {...base} onCreate={onCreate} catalogueRequest={{ entry, nonce: 1 }} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Betelgeuse");
    expect(Number((screen.getByLabelText("Mass (kg)") as HTMLInputElement).value)).toBe(entry.properties.massKg.value);
    expect(Number((screen.getByLabelText("Physical radius (m)") as HTMLInputElement).value)).toBe(entry.properties.radiusM.value);
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("star");
    expect(screen.getByText(/Started from the catalogue entry Betelgeuse/)).toBeTruthy();
    // the user edits the copy; the entry is untouched
    fireEvent.change(screen.getByLabelText("Mass (kg)"), { target: { value: "1e31" } });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ name: "Betelgeuse", massKg: 1e31, kind: "star", catalogueEntryId: "betelgeuse", colorHex: "#ff6a3d" });
    expect(JSON.stringify(entry)).toBe(before);
  });

  it("a catalogue body starts at rest: position and velocity come from the user, not the catalogue", () => {
    const { rerender } = render(<ControlPanel {...base} onCreate={ok} />);
    rerender(<ControlPanel {...base} onCreate={ok} catalogueRequest={{ entry: earthEntry, nonce: 1 }} />);
    for (const axis of ["X", "Y", "Z"]) expect((screen.getByLabelText(`Velocity (m/s) ${axis}`) as HTMLInputElement).value).toBe("0");
  });

  it("a second request for the same entry (new nonce) re-prefills after the form was edited", () => {
    const { rerender } = render(<ControlPanel {...base} onCreate={ok} catalogueRequest={{ entry: earthEntry, nonce: 1 }} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "edited" } });
    rerender(<ControlPanel {...base} onCreate={ok} catalogueRequest={{ entry: earthEntry, nonce: 2 }} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Earth");
  });
});

describe("physical radius vs displayed size", () => {
  it("inspector labels physical radius and states display size is exaggerated", () => {
    render(<BodyInspector body={toBodyView(earth)} onSave={ok} onDelete={ok} onFocus={() => {}} />);
    expect(screen.getByText(/rendered visual radius is exaggerated/i)).toBeTruthy();
    expect((screen.getByLabelText("Physical radius (m)") as HTMLInputElement).value).toBe("6.371e6"); // never the display size
  });

  it("the radius readout reports the radius actually drawn when crowding reduced it", () => {
    const { rerender } = render(<BodyInspector body={toBodyView(earth)} onSave={ok} onDelete={ok} onFocus={() => {}} />);
    expect(screen.getByTestId("inspect-visual-radius").textContent).toMatch(/Rendered visual radius: 2\.\d\d scene units \(display only\)\./);
    rerender(<BodyInspector body={toBodyView(earth)} onSave={ok} onDelete={ok} onFocus={() => {}} drawnRadiusUnits={0.21} />);
    expect(screen.getByTestId("inspect-visual-radius").textContent).toMatch(/0\.21 scene units .*reduced from 2\.\d\d so nearby bodies do not overlap/);
  });

  it("changing the type sends only the kind", async () => {
    const onSave = vi.fn(ok);
    render(<BodyInspector body={toBodyView(earth)} onSave={onSave} onDelete={ok} onFocus={() => {}} />);
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("planet");
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "star" } });
    fireEvent.click(screen.getByText("Apply"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(earth.id, { kind: "star" }));
  });

  it("type and a field edit are saved together, and Revert restores the confirmed type", async () => {
    const onSave = vi.fn(ok);
    render(<BodyInspector body={toBodyView(sun)} onSave={onSave} onDelete={ok} onFocus={() => {}} />);
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("star");
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "planet" } });
    fireEvent.click(screen.getByText("Revert"));
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("star");
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "planet" } });
    fireEvent.change(screen.getByLabelText("Mass (kg)"), { target: { value: "2e30" } });
    fireEvent.click(screen.getByText("Apply"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(sun.id, { massKg: 2e30, kind: "planet" }));
  });

  it("invalid mass shows field error and sends nothing", () => {
    const onSave = vi.fn(ok);
    render(<BodyInspector body={toBodyView(earth)} onSave={onSave} onDelete={ok} onFocus={() => {}} />);
    fireEvent.change(screen.getByLabelText("Mass (kg)"), { target: { value: "-5" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Must be > 0/)).toBeTruthy();
  });

  it("server 409 detail shown verbatim", async () => {
    const onSave = vi.fn(async (..._a: unknown[]) => ({ ok: false, error: "body would overlap body-x (centre distance 3 m < 7 m)" }) as const);
    render(<BodyInspector body={toBodyView(earth)} onSave={onSave} onDelete={ok} onFocus={() => {}} />);
    fireEvent.change(screen.getByLabelText("Physical radius (m)"), { target: { value: "1e9" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(await screen.findByText("body would overlap body-x (centre distance 3 m < 7 m)")).toBeTruthy();
  });

  it("revert leaves confirmed values", () => {
    render(<BodyInspector body={toBodyView(earth)} onSave={ok} onDelete={ok} onFocus={() => {}} />);
    const mass = screen.getByLabelText("Mass (kg)") as HTMLInputElement;
    fireEvent.change(mass, { target: { value: "1" } });
    fireEvent.click(screen.getByText("Revert"));
    expect(mass.value).toBe("5.972e24");
  });

  it("apply disabled while playing with explanation", () => {
    const onSave = vi.fn(ok);
    render(<BodyInspector body={toBodyView(earth)} onSave={onSave} onDelete={ok} onFocus={() => {}} editBlockedReason="Pause to edit: changes are applied between steps." />);
    fireEvent.change(screen.getByLabelText("Mass (kg)"), { target: { value: "1e20" } });
    expect((screen.getByText("Apply") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Delete") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Pause to edit/)).toBeTruthy();
    fireEvent.click(screen.getByText("Apply"));
    expect(onSave).not.toHaveBeenCalled();
  });
});
