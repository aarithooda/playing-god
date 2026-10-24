import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";
import { ApiError } from "./errors";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const stateBody = { status: "paused", simulationTimeS: 5, bodies: [], diagnostics: null, universeId: "uni-b", revision: 7 };

function setup(respond: (url: string, init: RequestInit) => Response = () => json(stateBody)) {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => respond(String(url), init ?? {}));
  const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
  const calls = () => fetchImpl.mock.calls.map(([u, i]) => `${(i as RequestInit | undefined)?.method ?? "GET"} ${String(u)}`);
  return { client, calls, fetchImpl };
}

describe("scoped client", () => {
  const scope = { universeId: "uni-b", activationEpoch: 4 };

  it("scoped client sends activationEpoch on every mutation", async () => {
    const { client, calls } = setup((url, init) => {
      if (url.includes("/snapshots") && init.method === "POST" && !url.includes("restore")) {
        return json({ id: "s1", name: "n", createdAtIso: "x", simulationTimeS: 0, bodyCount: 0, revision: 1, controlled: true }, 201);
      }
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (url.includes("/step")) return json({ ...stateBody, advancedS: 1, events: [] });
      if (url.includes("/bodies") && init.method !== "DELETE") {
        return json({ id: "b", name: "n", massKg: 1, radiusM: 1, positionM: { x: 0, y: 0, z: 0 }, velocityMPerS: { x: 0, y: 0, z: 0 }, colorHex: "#ffffff" }, 201);
      }
      return json(stateBody);
    });
    const s = client.scoped(scope);
    const body = { name: "n", massKg: 1, radiusM: 1, positionM: { x: 0, y: 0, z: 0 }, velocityMPerS: { x: 0, y: 0, z: 0 }, colorHex: "#ffffff" };
    await s.createBody(body);
    await s.updateBody("b 1", { massKg: 2 });
    await s.deleteBody("b 1");
    await s.step(10);
    await s.reset();
    await s.createSnapshot("n");
    await s.restoreSnapshot("s1");
    await s.deleteSnapshot("s1");
    const mutations = calls().filter((c) => !c.startsWith("GET"));
    expect(mutations).toHaveLength(8);
    for (const m of mutations) expect(m).toMatch(/\?activationEpoch=4$/);
    expect(mutations.every((m) => m.includes("/api/v1/universes/uni-b/"))).toBe(true);
    expect(mutations[1]).toContain("/bodies/b%201?");
  });

  it("reads carry no epoch and are scoped to the universe", async () => {
    const { client, calls } = setup((url) => {
      if (url.endsWith("/events")) return json({ events: [] });
      if (url.endsWith("/snapshots")) return json({ snapshots: [] });
      if (url.includes("/history")) {
        return json({ universeId: "uni-b", mode: "step", sampleIntervalS: null, generation: 3, firstIndex: 0, nextIndex: 0, droppedBefore: 0, truncated: false, samples: [], bodies: {} });
      }
      return json(stateBody);
    });
    const s = client.scoped(scope);
    const state = await s.getState();
    await s.getEvents();
    await s.listSnapshots();
    const page = await s.getHistory({ generation: 3, fromIndex: 10, bodyIds: ["a", "b"], limit: 50 });
    expect(calls()).toEqual([
      "GET /api/v1/universes/uni-b/state",
      "GET /api/v1/universes/uni-b/events",
      "GET /api/v1/universes/uni-b/snapshots",
      "GET /api/v1/universes/uni-b/history?generation=3&fromIndex=10&bodyIds=a%2Cb&limit=50",
    ]);
    expect(state.revision).toBe(7);
    expect(state.universeId).toBe("uni-b");
    expect(page.generation).toBe(3);
  });

  it("keeps the backend's error code on an HTTP error", async () => {
    const { client } = setup(() => json({ detail: "stale activation epoch 1 (current: 2)", code: "stale_activation" }, 409));
    const err = await client.scoped(scope).step(1).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: "http", status: 409, code: "stale_activation" });
    expect(err.message).toMatch(/stale activation/);
  });

  it("lists, creates, activates and deletes universes and lists presets", async () => {
    const summary = {
      id: "uni-x", name: "X", role: "sandbox", presetId: null, experimentId: null, active: false, simulationTimeS: 0, bodyCount: 0,
      revision: 0, status: "idle", lastFailure: null, createdAtIso: "t", epochLabel: null, historyMode: "step",
    };
    const { client, calls, fetchImpl } = setup((url, init) => {
      if (url.endsWith("/presets")) return json({ presets: [{ id: "p", name: "P", description: "d", available: true, unavailableReason: null, bodyCount: 9, epochLabel: "J2000.0" }] });
      if (url.endsWith("/activate")) return json({ activeUniverseId: "uni-x", activationEpoch: 2, previous: null });
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (init.method === "POST") return json(summary, 201);
      return json({ universes: [summary], activeUniverseId: "uni-x", activationEpoch: 1 });
    });
    expect((await client.listUniverses()).activationEpoch).toBe(1);
    expect((await client.createUniverse({ source: { kind: "preset", presetId: "p" }, activate: true })).id).toBe("uni-x");
    expect(JSON.parse((fetchImpl.mock.calls[1]![1] as RequestInit).body as string)).toEqual({ source: { kind: "preset", presetId: "p" }, activate: true });
    expect(await client.activateUniverse("uni-x")).toEqual({ activeUniverseId: "uni-x", activationEpoch: 2 });
    await client.deleteUniverse("uni-x");
    expect((await client.listPresets())[0]!.bodyCount).toBe(9);
    expect(calls()).toContain("POST /api/v1/universes/uni-x/activate");
    expect(calls()).toContain("DELETE /api/v1/universes/uni-x");
  });

  it("rejects a malformed universe list instead of passing it on", async () => {
    const { client } = setup(() => json({ universes: [{ id: "x" }], activeUniverseId: "x", activationEpoch: 1 }));
    await expect(client.listUniverses()).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("a body without kind is a planet (older backends)", async () => {
    const { client } = setup(() => json({ status: "paused", simulationTimeS: 0, diagnostics: null, bodies: [
      { id: "b", name: "n", massKg: 1, radiusM: 1, positionM: { x: 0, y: 0, z: 0 }, velocityMPerS: { x: 0, y: 0, z: 0 }, colorHex: "#ffffff" },
    ] }));
    const state = await client.getState();
    expect(state.bodies[0]).toMatchObject({ kind: "planet", catalogueEntryId: null });
  });

  it("parses the catalogue with ranges, asymmetric uncertainty and notes, and rejects a missing basis", async () => {
    const prop = (extra = {}) => ({ value: 1, uncertainty: null, basis: "measured", sourceValue: "1 kg", conversion: "x", sources: [{ citation: "c", url: "u", retrieved: "r" }], ...extra });
    const entry = (p: unknown) => ({ id: "e", name: "E", kind: "star", properties: { massKg: p, radiusM: prop({ uncertainty: { minus: 1, plus: 2 } }) }, visual: { colorHex: "#ffffff", note: "display only" }, notes: "" });
    const { client } = setup(() => json({ notes: ["n"], entries: [entry(prop({ uncertainty: { range: [1, 3] }, basis: "estimated", note: "mid" }))] }));
    const c = await client.getCatalogue();
    expect(c.notes).toEqual(["n"]);
    expect(c.entries[0]!.properties.massKg).toMatchObject({ basis: "estimated", uncertainty: { range: [1, 3] }, note: "mid" });
    expect(c.entries[0]!.properties.radiusM.uncertainty).toEqual({ minus: 1, plus: 2 });
    const bad = setup(() => json({ entries: [entry(prop({ basis: "guessed" }))] }));
    await expect(bad.client.getCatalogue()).rejects.toMatchObject({ kind: "invalid-response" });
  });
});
