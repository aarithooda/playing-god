// Keeps the client's history cache in step with the backend (UI-2, plan section 11B.4).
//
// Incremental: every time the universe's `revision` changes it asks only for the samples after what it holds, in the
// generation it holds. A failed fetch keeps the cache, marks it stale and is retried on the next revision change or on
// `refresh()`. It never fills in what it did not receive. The hook lives inside the keyed UniverseWorkspace, so it is
// partitioned per universe and activation epoch; a late page after unmount, or one that names another universe, is
// dropped.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScopedClient } from "../../api/client";
import { applyHistoryPage, type HistoryCache } from "./historyModel";

export type HistoryStatus = "idle" | "loading" | "stale" | "error";

export const HISTORY_PAGE_LIMIT = 1000;

export function useHistory(client: ScopedClient, revision: number | null) {
  const [cache, setCache] = useState<HistoryCache | null>(null);
  const [status, setStatus] = useState<HistoryStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  const cacheRef = useRef<HistoryCache | null>(null);
  const running = useRef(false);
  const again = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchAll = useCallback(async () => {
    if (running.current) {
      again.current = true; // the revision moved while fetching: go round once more afterwards
      return;
    }
    running.current = true;
    if (mounted.current) setStatus((s) => (cacheRef.current ? s : "loading"));
    try {
      do {
        again.current = false;
        let more = true;
        while (more) {
          const held = cacheRef.current;
          const page = await client.getHistory({ generation: held?.generation, fromIndex: held?.nextIndex ?? 0, limit: HISTORY_PAGE_LIMIT });
          if (!mounted.current) return;
          if (page.universeId !== client.scope.universeId) throw new Error("the backend returned history of another universe; it was ignored");
          const next = applyHistoryPage(held, page);
          cacheRef.current = next;
          setCache(next);
          more = page.samples.length >= HISTORY_PAGE_LIMIT;
        }
      } while (again.current);
      if (mounted.current) {
        setStatus("idle");
        setError(null);
      }
    } catch (e) {
      if (mounted.current) {
        setStatus("stale"); // what we hold is still shown, flagged as possibly incomplete
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      running.current = false;
    }
  }, [client]);

  useEffect(() => {
    if (revision !== null) void fetchAll();
  }, [revision, fetchAll]);

  return { cache, status, error, refresh: fetchAll };
}

export type HistoryApi = ReturnType<typeof useHistory>;
