// The list of universes and which one is active. The backend owns both: this hook only mirrors what it last
// reported, and always adopts the backend's active universe and activation epoch when they differ from its own
// (another tab switched, a request was refused as stale, or the backend restarted). Universes live in backend memory
// only, so a restart makes known ids disappear: that is detected and shown as a notice, never as stale state.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type {
  CreateUniverseDto,
  PresetSummaryDto,
  UniverseListDto,
  UniverseScope,
  UniverseSummaryDto,
} from "../api/types";

export type UniversesStatus = "loading" | "ready" | "error";

export const UNIVERSES_LOST_NOTICE =
  "The backend restarted or universes were removed; universes held in memory were lost. Showing the backend's current active universe.";

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useUniverses(client: ApiClient) {
  const [status, setStatus] = useState<UniversesStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<UniverseListDto | null>(null);
  const [presets, setPresets] = useState<PresetSummaryDto[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mounted = useRef(false);
  const known = useRef<{ ids: Set<string>; epoch: number } | null>(null);
  const deletedByUs = useRef(new Set<string>());
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback((): Promise<void> => {
    // Concurrent resyncs (several late refusals at once) share one request.
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const next = await client.listUniverses();
        if (!mounted.current) return;
        const prev = known.current;
        const ids = new Set(next.universes.map((u) => u.id));
        if (prev) {
          const lost = [...prev.ids].some((id) => !ids.has(id) && !deletedByUs.current.has(id));
          if (lost || next.activationEpoch < prev.epoch) setNotice(UNIVERSES_LOST_NOTICE);
        }
        known.current = { ids, epoch: next.activationEpoch };
        deletedByUs.current.clear();
        setList(next);
        setStatus("ready");
        setError(null);
      } catch (e) {
        if (!mounted.current) return;
        // A failed resync keeps whatever was shown before; only a first load becomes a blocking error.
        if (known.current === null) {
          setStatus("error");
          setError(messageOf(e));
        } else {
          setActionError(messageOf(e));
        }
      }
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, [client]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    void client
      .listPresets()
      .then((p) => mounted.current && setPresets(p))
      .catch(() => undefined); // presets are optional: the rest of the app works without them
    return () => {
      mounted.current = false;
    };
  }, [client, refresh]);

  const retry = useCallback(() => {
    setStatus("loading");
    return refresh();
  }, [refresh]);

  const write = useCallback(
    async <T,>(task: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> => {
      setBusy(true);
      setActionError(null);
      try {
        const value = await task();
        await refresh();
        return { ok: true, value };
      } catch (e) {
        const error = messageOf(e);
        if (mounted.current) setActionError(error);
        void refresh(); // the refusal may mean our picture is out of date
        return { ok: false, error };
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [refresh],
  );

  const activate = useCallback((id: string) => write(() => client.activateUniverse(id)), [client, write]);
  const createUniverse = useCallback(
    (request: CreateUniverseDto): Promise<{ ok: true; value: UniverseSummaryDto } | { ok: false; error: string }> =>
      write(() => client.createUniverse(request)),
    [client, write],
  );
  const deleteUniverse = useCallback(
    (id: string) => {
      deletedByUs.current.add(id);
      return write(() => client.deleteUniverse(id));
    },
    [client, write],
  );

  const scope: UniverseScope | null = list ? { universeId: list.activeUniverseId, activationEpoch: list.activationEpoch } : null;

  return {
    status,
    error,
    universes: list?.universes ?? [],
    scope,
    presets,
    notice,
    actionError,
    busy,
    refresh,
    retry,
    activate,
    createUniverse,
    deleteUniverse,
    dismissNotice: useCallback(() => setNotice(null), []),
    dismissActionError: useCallback(() => setActionError(null), []),
  };
}

export type UniversesApi = ReturnType<typeof useUniverses>;
