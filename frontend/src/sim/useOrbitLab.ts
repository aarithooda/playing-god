// Orbit Lab state outside any one universe: which systems exist, which experiments the backend holds, and the
// actions that create or remove runs. An experiment spans two universes (baseline and modified), so this lives in App
// beside the universe list. A success is only ever reported after the backend confirmed it.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ComparisonDto, ExperimentDto, OrbitLabSystemDto } from "../api/types";

export type LabResult = { ok: true } | { ok: false; error: string };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useOrbitLab(client: ApiClient, onChanged: () => void | Promise<void>) {
  const [systems, setSystems] = useState<OrbitLabSystemDto[]>([]);
  const [experiments, setExperiments] = useState<ExperimentDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const refresh = useCallback(async () => {
    try {
      const list = await client.listExperiments();
      if (mounted.current) {
        setExperiments(list);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(messageOf(e)); // never an empty success: the old list stays and the error shows
    }
  }, [client]);

  useEffect(() => {
    mounted.current = true;
    client
      .listOrbitLabSystems()
      .then((s) => mounted.current && setSystems(s))
      .catch((e) => mounted.current && setError(messageOf(e)));
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [client, refresh]);

  const run = useCallback(
    async (task: () => Promise<unknown>): Promise<LabResult> => {
      setBusy(true);
      setError(null);
      try {
        await task();
      } catch (e) {
        const msg = messageOf(e);
        if (mounted.current) {
          setError(msg);
          setBusy(false);
        }
        return { ok: false, error: msg };
      }
      await refresh();
      await onChangedRef.current();
      if (mounted.current) setBusy(false);
      return { ok: true };
    },
    [refresh],
  );

  const startExperiment = useCallback((systemId: string) => run(() => client.createExperiment(systemId)), [client, run]);
  const createModifiedRun = useCallback(
    (experimentId: string, speedFactor: number, replaceExisting: boolean, bodyId = "body-earth") =>
      run(() => client.createModifiedRun(experimentId, { bodyId, speedFactor, replaceExisting })),
    [client, run],
  );
  const deleteExperiment = useCallback((experimentId: string) => run(() => client.deleteExperiment(experimentId)), [client, run]);
  const experimentById = useCallback((id: string | null | undefined) => (id ? experiments.find((e) => e.id === id) : undefined), [experiments]);

  return {
    systems,
    experiments,
    error,
    busy,
    refresh,
    startExperiment,
    createModifiedRun,
    deleteExperiment,
    experimentById,
    dismissError: useCallback(() => setError(null), []),
  };
}

export type OrbitLabApi = ReturnType<typeof useOrbitLab>;

/**
 * The backend's comparison of an experiment's two runs for one body. Refetched whenever `trigger` changes (the active
 * run's revision). A late answer for an older request is dropped; a failed refresh keeps the last comparison and reports
 * the error.
 */
export function useComparison(client: ApiClient, experimentId: string | null, bodyId: string | null, trigger: number | string | null) {
  const [comparison, setComparison] = useState<ComparisonDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!experimentId || !bodyId) return;
    const mine = ++seq.current;
    try {
      const c = await client.getComparison(experimentId, bodyId);
      if (mounted.current && mine === seq.current) {
        setComparison(c);
        setError(null);
      }
    } catch (e) {
      if (mounted.current && mine === seq.current) setError(messageOf(e));
    }
  }, [client, experimentId, bodyId]);

  useEffect(() => {
    seq.current += 1; // anything still in flight belongs to the previous experiment
    if (!experimentId || !bodyId) {
      setComparison(null);
      setError(null);
      return;
    }
    void load();
  }, [experimentId, bodyId, trigger, load]);

  return { comparison, error, refresh: load };
}
