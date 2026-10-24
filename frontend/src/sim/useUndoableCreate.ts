import { useCallback, useEffect, useState } from "react";
import type { BodyCreateDto } from "../api/types";
import type { ActionResult, CreateResult } from "./useSimulation";

/** How long the "Undo" offer stays available after a body is created. */
export const UNDO_WINDOW_MS = 5_000;

export interface UndoableCreate {
  id: string;
  name: string;
}

interface Options {
  createBody: (body: BodyCreateDto) => Promise<CreateResult>;
  deleteBody: (id: string) => Promise<ActionResult>;
  /** The offer is withdrawn as soon as simulated time moves: undo never pretends to rewind a run. */
  simulationTimeS: number | undefined;
  windowMs?: number;
}

/**
 * Short undo for the most recent create. Undo is the ordinary DELETE of the body just created, offered
 * only while the simulation has not advanced and for a few seconds; it is not a state rewind.
 */
export function useUndoableCreate({ createBody, deleteBody, simulationTimeS, windowMs = UNDO_WINDOW_MS }: Options) {
  const [undoable, setUndoable] = useState<UndoableCreate | null>(null);

  useEffect(() => {
    setUndoable(null);
  }, [simulationTimeS]);

  useEffect(() => {
    if (!undoable) return;
    const timer = setTimeout(() => setUndoable(null), windowMs);
    return () => clearTimeout(timer);
  }, [undoable, windowMs]);

  const create = useCallback(
    async (body: BodyCreateDto): Promise<CreateResult> => {
      const result = await createBody(body);
      if (result.ok) setUndoable({ id: result.id, name: body.name });
      else setUndoable(null);
      return result;
    },
    [createBody],
  );

  const undo = useCallback(async (): Promise<ActionResult> => {
    if (!undoable) return { ok: false, error: "nothing to undo" };
    const target = undoable;
    setUndoable(null);
    return deleteBody(target.id);
  }, [undoable, deleteBody]);

  const dismiss = useCallback(() => setUndoable(null), []);

  return { undoable, create, undo, dismiss };
}
