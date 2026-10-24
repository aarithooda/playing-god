import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BodyCreateDto } from "../api/types";
import { UNDO_WINDOW_MS, useUndoableCreate } from "./useUndoableCreate";
import type { ActionResult, CreateResult } from "./useSimulation";

const dto = { name: "Probe" } as unknown as BodyCreateDto;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(timeS = 0, createResult: CreateResult = { ok: true, id: "body-7" }) {
  const createBody = vi.fn(async () => createResult);
  const deleteBody = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));
  const hook = renderHook(
    ({ t }) => useUndoableCreate({ createBody, deleteBody, simulationTimeS: t }),
    { initialProps: { t: timeS } },
  );
  return { createBody, deleteBody, ...hook };
}

describe("useUndoableCreate", () => {
  it("offers undo after a successful create and undo deletes exactly that body", async () => {
    const { result, deleteBody } = setup();
    await act(async () => void (await result.current.create(dto)));
    expect(result.current.undoable).toEqual({ id: "body-7", name: "Probe" });
    await act(async () => void (await result.current.undo()));
    expect(deleteBody).toHaveBeenCalledWith("body-7");
    expect(result.current.undoable).toBeNull();
  });

  it("offers nothing when the create fails", async () => {
    const { result } = setup(0, { ok: false, error: "overlap" });
    await act(async () => void (await result.current.create(dto)));
    expect(result.current.undoable).toBeNull();
  });

  it("withdraws the offer after the window", async () => {
    const { result } = setup();
    await act(async () => void (await result.current.create(dto)));
    act(() => void vi.advanceTimersByTime(UNDO_WINDOW_MS - 1));
    expect(result.current.undoable).not.toBeNull();
    act(() => void vi.advanceTimersByTime(2));
    expect(result.current.undoable).toBeNull();
  });

  it("withdraws the offer as soon as simulated time changes", async () => {
    const { result, rerender } = setup(100);
    await act(async () => void (await result.current.create(dto)));
    rerender({ t: 100 }); // unchanged time keeps it
    expect(result.current.undoable).not.toBeNull();
    rerender({ t: 200 });
    expect(result.current.undoable).toBeNull();
  });

  it("undo with nothing offered does not call delete", async () => {
    const { result, deleteBody } = setup();
    await act(async () => void (await result.current.undo()));
    expect(deleteBody).not.toHaveBeenCalled();
  });
});
