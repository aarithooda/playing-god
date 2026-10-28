import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateBodyPanel } from "./CreateBodyPanel";

afterEach(cleanup);

const ok = async (..._args: unknown[]) => ({ ok: true }) as const;

/** M1 (repair 2026-10-28): D-033 DQ-2 (a) — a material is never assigned silently, and D-029 — `bodyType` is display-only. The create
 *  form therefore sends a material only when the user picked one; "not specified" sends none (the backend then resolves the body's
 *  contacts with the exact legacy merge, labelled `material_unspecified`). */
describe("CreateBodyPanel material", () => {
  async function create(role: string | null, material: string | null) {
    const onCreate = vi.fn(ok);
    render(<CreateBodyPanel disabled={false} onCreate={onCreate} />);
    fireEvent.click(screen.getByText("Add body…"));
    if (role) fireEvent.change(screen.getByLabelText("Physics role"), { target: { value: role } });
    if (material !== null) fireEvent.change(screen.getByLabelText("Material"), { target: { value: material } });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    return onCreate.mock.calls[0]![0] as Record<string, unknown>;
  }

  it.each([null, "star", "planet"])("sends no material when none was chosen (role %s)", async (role) => {
    const payload = await create(role, null);
    expect(payload).not.toHaveProperty("material");
  });

  it("sends exactly the material the user chose", async () => {
    const payload = await create("star", "iron");
    expect(payload.material).toEqual({ profileId: "iron", layers: null });
  });

  it("labels the default as not specified, not as an inferred material", () => {
    render(<CreateBodyPanel disabled={false} onCreate={ok} />);
    fireEvent.click(screen.getByText("Add body…"));
    const select = screen.getByLabelText("Material") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.options[0]!.textContent).toMatch(/not specified/i);
    expect(select.options[0]!.textContent).not.toMatch(/automatic|silicate|gas/i);
  });
});
