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
function renderOpen(ui: React.ReactElement) {
  const r = render(ui);
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  return r;
}
const notes = ["Catalogue entries are single bodies, not validated systems: nothing here has positions or velocities.", "Colour is a display choice, not a physical property."];

describe("CataloguePanel", () => {
  it("shows estimated badge and uncertainty", () => {
    renderOpen(<CataloguePanel entries={[betelgeuseEntry, earthEntry]} notes={notes} onAdd={() => {}} disabled={false} />);
    const bet = screen.getByTestId("catalogue-entry-betelgeuse");
    expect(within(bet).getByText("Estimated")).toBeTruthy();
    expect(bet.textContent).toMatch(/range/i);
    expect(bet.textContent).toMatch(/16\.5.19 M/); // the published range, as published
    expect(bet.textContent).toMatch(/model-dependent/);
    const earthRow = screen.getByTestId("catalogue-entry-earth");
    expect(within(earthRow).queryByText("Estimated")).toBeNull();
    expect(earthRow.textContent).toMatch(/±/);
    expect(earthRow.textContent).toMatch(/JPL SSD Planetary Physical Parameters/);
  });

  it("labels colour as display only and says entries are not validated systems", () => {
    renderOpen(<CataloguePanel entries={[earthEntry]} notes={notes} onAdd={() => {}} disabled={false} />);
    expect(screen.getByText(/Colour is a display choice/)).toBeTruthy();
    expect(screen.getByText(/single bodies, not validated systems/)).toBeTruthy();
    expect(screen.getByTitle("Colour: display only, not a physical property")).toBeTruthy();
  });

  it("discloses an illustrative value", () => {
    const illustrative = { ...earthEntry, id: "toy", name: "Toy", properties: { ...earthEntry.properties, massKg: { ...earthEntry.properties.massKg, basis: "illustrative" as const } } };
    renderOpen(<CataloguePanel entries={[illustrative]} notes={notes} onAdd={() => {}} disabled={false} />);
    expect(within(screen.getByTestId("catalogue-entry-toy")).getByText("Illustrative")).toBeTruthy();
  });

  it("add hands over the entry and never mutates the catalogue", () => {
    const entries = structuredClone([earthEntry]);
    const frozen = JSON.stringify(entries);
    const onAdd = vi.fn();
    renderOpen(<CataloguePanel entries={entries} notes={notes} onAdd={onAdd} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Earth to this universe…" }));
    expect(onAdd).toHaveBeenCalledWith(entries[0]);
    expect(JSON.stringify(entries)).toBe(frozen);
  });

  it("is empty-safe and disabled while the universe is not usable", () => {
    const { container, rerender } = render(<CataloguePanel entries={[]} notes={[]} onAdd={() => {}} disabled={false} />);
    expect(container.innerHTML).toBe("");
    rerender(<CataloguePanel entries={[earthEntry]} notes={notes} onAdd={() => {}} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect((screen.getByRole("button", { name: "Add Earth to this universe…" }) as HTMLButtonElement).disabled).toBe(true);
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
