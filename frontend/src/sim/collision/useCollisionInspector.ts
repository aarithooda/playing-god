import { useCallback, useEffect, useRef, useState } from "react";
import type { ScopedClient } from "../../api/client";
import type { CollisionDetailDto, ReplayReportDto } from "../../api/types";

export interface CollisionInspectorState {
  eventId: string | null;
  detail: CollisionDetailDto | null;
  status: "loading" | "ready" | "error";
  error?: string;
  replay: ReplayReportDto | null;
  replayBusy: boolean;
  open(eventId: string): void;
  close(): void;
  runReplay(): void;
}

/** Loads one collision record at a time and runs its dry-run replay. A late answer for an older request, or for another universe, is
 *  discarded (the same token discipline as the other hooks). Read-only: it never changes the simulation. */
export function useCollisionInspector(client: ScopedClient): CollisionInspectorState {
  const [eventId, setEventId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CollisionDetailDto | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | undefined>(undefined);
  const [replay, setReplay] = useState<ReplayReportDto | null>(null);
  const [replayBusy, setReplayBusy] = useState(false);
  const token = useRef(0);
  const universe = `${client.scope.universeId}#${client.scope.activationEpoch}`;

  const close = useCallback(() => {
    token.current += 1;
    setEventId(null);
    setDetail(null);
    setReplay(null);
    setReplayBusy(false);
  }, []);

  useEffect(() => {
    close(); // another universe or epoch: the open record no longer belongs here
  }, [universe, close]);

  const open = useCallback(
    (id: string) => {
      const mine = ++token.current;
      setEventId(id);
      setDetail(null);
      setReplay(null);
      setStatus("loading");
      setError(undefined);
      client.getCollision(id).then(
        (d) => {
          if (token.current !== mine) return;
          setDetail(d);
          setStatus("ready");
        },
        (e: unknown) => {
          if (token.current !== mine) return;
          setError(e instanceof Error ? e.message : "The record could not be loaded.");
          setStatus("error");
        },
      );
    },
    [client],
  );

  const runReplay = useCallback(() => {
    if (eventId === null) return;
    const mine = token.current;
    setReplayBusy(true);
    client.replayCollision(eventId).then(
      (r) => {
        if (token.current !== mine) return;
        setReplay(r);
        setReplayBusy(false);
      },
      (e: unknown) => {
        if (token.current !== mine) return;
        setError(e instanceof Error ? e.message : "The replay failed.");
        setStatus("error");
        setReplayBusy(false);
      },
    );
  }, [client, eventId]);

  return { eventId, detail, status, error, replay, replayBusy, open, close, runReplay };
}
