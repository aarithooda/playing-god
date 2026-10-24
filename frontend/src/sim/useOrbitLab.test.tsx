import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { comparison, experiment, fakeClient, modificationOf, orbitSystem } from "../test/fixtures";
import { useComparison, useOrbitLab } from "./useOrbitLab";

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => vi.useRealTimers());
afterEach(cleanup);

describe("useOrbitLab", () => {
  it("loads the systems and the experiments the backend already has", async () => {
    const client = fakeClient({ listExperiments: async () => [experiment()] });
    const { result } = renderHook(() => useOrbitLab(client, () => {}));
    await flush();
    expect(result.current.systems).toEqual([orbitSystem]);
    expect(result.current.experiments.map((e) => e.id)).toEqual(["exp-1"]);
    expect(result.current.experimentById("exp-1")?.baselineUniverseId).toBe("uni-base");
    expect(result.current.experimentById("nope")).toBeUndefined();
  });

  it("starting an experiment calls the backend, refreshes the lists and tells the app the universes changed", async () => {
    let created = false;
    const createExperiment = vi.fn(async () => ((created = true), experiment()));
    const onChanged = vi.fn();
    const client = fakeClient({ createExperiment, listExperiments: async () => (created ? [experiment()] : []) });
    const { result } = renderHook(() => useOrbitLab(client, onChanged));
    await flush();
    let r: any;
    await act(async () => void (r = await result.current.startExperiment("exp01-sun-emb-j2000")));
    expect(createExperiment).toHaveBeenCalledWith("exp01-sun-emb-j2000");
    expect(r).toEqual({ ok: true });
    expect(result.current.experiments).toHaveLength(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("failed modified-run creation shows error and no success state", async () => {
    const onChanged = vi.fn();
    const client = fakeClient({
      listExperiments: async () => [experiment()],
      createModifiedRun: async () => {
        throw new ApiError("http", "speed factor 1.1000001 is not allowed", 422, "factor_not_allowed");
      },
    });
    const { result } = renderHook(() => useOrbitLab(client, onChanged));
    await flush();
    let r: any;
    await act(async () => void (r = await result.current.createModifiedRun("exp-1", 1.1, false)));
    expect(r).toEqual({ ok: false, error: "speed factor 1.1000001 is not allowed" });
    expect(result.current.error).toBe("speed factor 1.1000001 is not allowed");
    expect(result.current.experimentById("exp-1")?.modifiedUniverseId).toBeNull(); // nothing shown as created
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("no success before backend confirmation", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    let state = experiment();
    const onChanged = vi.fn();
    const client = fakeClient({
      listExperiments: async () => [state],
      createModifiedRun: async (_e: string, req: any) => {
        await gate; // the backend has not answered yet
        state = experiment({ modifiedUniverseId: "uni-mod", modification: modificationOf(req.speedFactor) });
        return state;
      },
    });
    const { result } = renderHook(() => useOrbitLab(client, onChanged));
    await flush();
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.createModifiedRun("exp-1", 1.1, false);
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.experimentById("exp-1")?.modifiedUniverseId).toBeNull(); // nothing is shown as created
    expect(onChanged).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await pending;
    });
    expect(result.current.experimentById("exp-1")?.modifiedUniverseId).toBe("uni-mod");
    expect(result.current.busy).toBe(false);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("creates the modified run with the chosen factor and body, and replaces only when asked to", async () => {
    let state = experiment();
    const createModifiedRun = vi.fn(async (_e: string, req: any) => ((state = experiment({ modifiedUniverseId: "uni-mod", modification: modificationOf(req.speedFactor) })), state));
    const onChanged = vi.fn();
    const client = fakeClient({ createModifiedRun, listExperiments: async () => [state] });
    const { result } = renderHook(() => useOrbitLab(client, onChanged));
    await flush();
    await act(async () => void (await result.current.createModifiedRun("exp-1", 1.05, false)));
    expect(createModifiedRun).toHaveBeenLastCalledWith("exp-1", { bodyId: "body-earth", speedFactor: 1.05, replaceExisting: false });
    expect(result.current.experimentById("exp-1")?.modification?.speedFactor).toBe(1.05);
    await act(async () => void (await result.current.createModifiedRun("exp-1", 0.9, true)));
    expect(createModifiedRun).toHaveBeenLastCalledWith("exp-1", { bodyId: "body-earth", speedFactor: 0.9, replaceExisting: true });
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("deleting an experiment refreshes everything", async () => {
    let exists = true;
    const deleteExperiment = vi.fn(async () => void (exists = false));
    const onChanged = vi.fn();
    const client = fakeClient({ deleteExperiment, listExperiments: async () => (exists ? [experiment()] : []) });
    const { result } = renderHook(() => useOrbitLab(client, onChanged));
    await flush();
    await act(async () => void (await result.current.deleteExperiment("exp-1")));
    expect(deleteExperiment).toHaveBeenCalledWith("exp-1");
    expect(result.current.experiments).toEqual([]);
    expect(onChanged).toHaveBeenCalled();
  });

  it("an unknown experiment id (for example after a backend restart) triggers a re-read instead of staying silent", async () => {
    const listExperiments = vi.fn(async () => []);
    const client = fakeClient({ listExperiments });
    const { result } = renderHook(() => useOrbitLab(client, () => {}));
    await flush();
    listExperiments.mockClear();
    await act(async () => void (await result.current.refresh()));
    expect(listExperiments).toHaveBeenCalledTimes(1);
  });

  it("a failing experiment list is a visible error, not an empty success", async () => {
    const client = fakeClient({
      listExperiments: async () => {
        throw new ApiError("network", "Cannot reach the backend (down)");
      },
    });
    const { result } = renderHook(() => useOrbitLab(client, () => {}));
    await flush();
    expect(result.current.error).toMatch(/Cannot reach/);
    expect(result.current.experiments).toEqual([]);
  });
});

describe("useComparison", () => {
  it("fetches the comparison of an experiment's body and refetches when the trigger changes", async () => {
    const getComparison = vi.fn(async () => comparison());
    const client = fakeClient({ getComparison });
    const { result, rerender } = renderHook(({ t }) => useComparison(client, "exp-1", "body-earth", t), { initialProps: { t: 1 } });
    await flush();
    expect(getComparison).toHaveBeenCalledWith("exp-1", "body-earth");
    expect(result.current.comparison?.commonSampleCount).toBe(4);
    rerender({ t: 2 });
    await flush();
    expect(getComparison).toHaveBeenCalledTimes(2);
  });

  it("does nothing without an experiment", async () => {
    const getComparison = vi.fn(async () => comparison());
    const client = fakeClient({ getComparison });
    const { result } = renderHook(() => useComparison(client, null, "body-earth", 1));
    await flush();
    expect(getComparison).not.toHaveBeenCalled();
    expect(result.current.comparison).toBeNull();
  });

  it("keeps the last comparison and reports the error when a refresh fails", async () => {
    let fail = false;
    const client = fakeClient({
      getComparison: async () => {
        if (fail) throw new ApiError("timeout", "The backend did not answer GET comparison");
        return comparison();
      },
    });
    const { result, rerender } = renderHook(({ t }) => useComparison(client, "exp-1", "body-earth", t), { initialProps: { t: 1 } });
    await flush();
    fail = true;
    rerender({ t: 2 });
    await flush();
    expect(result.current.error).toMatch(/did not answer/);
    expect(result.current.comparison?.commonSampleCount).toBe(4);
  });

  it("a late answer for a previous request never overwrites a newer one", async () => {
    const gates: Array<() => void> = [];
    const results = [comparison({ commonSampleCount: 1, timesS: [0], baselinePositionM: [[1, 0, 0]], modifiedPositionM: [[1, 0, 0]], separationM: [0] }), comparison()];
    let call = 0;
    const client = fakeClient({
      getComparison: () => {
        const mine = call++;
        return new Promise((resolve) => gates.push(() => resolve(results[mine]!)));
      },
    });
    const { result, rerender } = renderHook(({ t }) => useComparison(client, "exp-1", "body-earth", t), { initialProps: { t: 1 } });
    await flush();
    rerender({ t: 2 });
    await flush();
    await act(async () => {
      gates[1]!(); // the newer request answers first
      await Promise.resolve();
    });
    await act(async () => {
      gates[0]!(); // then the older one, late
      await Promise.resolve();
    });
    expect(result.current.comparison?.commonSampleCount).toBe(4);
  });

  it("clears the comparison when the experiment changes", async () => {
    const client = fakeClient();
    const { result, rerender } = renderHook(({ id }) => useComparison(client, id, "body-earth", 1), { initialProps: { id: "exp-1" as string | null } });
    await flush();
    expect(result.current.comparison).not.toBeNull();
    rerender({ id: null });
    await flush();
    expect(result.current.comparison).toBeNull();
  });
});
