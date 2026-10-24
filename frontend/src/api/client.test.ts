import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";
import { ApiError } from "./errors";
import { earth, mergerEvent, state, stepResponse, sun } from "../test/fixtures";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(impl: () => Promise<Response>) {
  return vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(impl);
}

describe("api client", () => {
  it("calls the documented paths and methods without rewriting the prefix", async () => {
    const f = mockFetch(async () => jsonResponse(state([sun])));
    const c = createApiClient({ fetchImpl: f as unknown as typeof fetch });
    await c.getState();
    expect(f.mock.calls[0][0]).toBe("/api/v1/simulation/state");
    expect(f.mock.calls[0][1]?.method).toBe("GET");

    f.mockResolvedValueOnce(jsonResponse(stepResponse([sun], 3600)));
    await c.step(3600);
    expect(f.mock.calls[1][0]).toBe("/api/v1/simulation/step");
    expect(f.mock.calls[1][1]?.method).toBe("POST");
    expect(JSON.parse(String(f.mock.calls[1][1]?.body))).toEqual({ dtS: 3600 });

    f.mockResolvedValueOnce(jsonResponse(state([])));
    await c.reset();
    expect(f.mock.calls[2][0]).toBe("/api/v1/simulation/reset");
    expect(f.mock.calls[2][1]?.method).toBe("POST");

    f.mockResolvedValueOnce(jsonResponse({ events: [mergerEvent] }));
    expect(await c.getEvents()).toEqual([mergerEvent]);
    expect(f.mock.calls[3][0]).toBe("/api/v1/events");
  });

  it("uses /healthz (outside /api) for health", async () => {
    const f = mockFetch(async () => jsonResponse({ status: "ok" }));
    expect(await createApiClient({ fetchImpl: f as unknown as typeof fetch }).health()).toBe(true);
    expect(f.mock.calls[0][0]).toBe("/healthz");
  });

  it("sends SI-named bodies for create/patch and encodes ids", async () => {
    const f = mockFetch(async () => jsonResponse(earth));
    const c = createApiClient({ fetchImpl: f as unknown as typeof fetch });
    const { id: _id, ...create } = earth;
    await c.createBody(create);
    expect(f.mock.calls[0][0]).toBe("/api/v1/bodies");
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual(create);
    await c.updateBody("body-x/y", { massKg: 7.3e22 });
    expect(f.mock.calls[1][0]).toBe("/api/v1/bodies/body-x%2Fy");
    expect(f.mock.calls[1][1]?.method).toBe("PATCH");
  });

  it("delete resolves on 204 with no body", async () => {
    const f = mockFetch(async () => new Response(null, { status: 204 }));
    await expect(createApiClient({ fetchImpl: f as unknown as typeof fetch }).deleteBody("body-1")).resolves.toBeUndefined();
    expect(f.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("turns 422 validation detail into a readable message", async () => {
    const f = mockFetch(async () =>
      jsonResponse({ detail: [{ loc: ["body", "massKg"], msg: "Input should be greater than 0", type: "greater_than" }] }, 422),
    );
    const { id: _id, ...create } = earth;
    const err = await createApiClient({ fetchImpl: f as unknown as typeof fetch }).createBody(create).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: "http", status: 422 });
    expect(err.message).toBe("massKg: Input should be greater than 0");
  });

  it("surfaces string detail (404/409) and falls back to the status", async () => {
    const f = mockFetch(async () => jsonResponse({ detail: "body not found" }, 404));
    const c = createApiClient({ fetchImpl: f as unknown as typeof fetch });
    await expect(c.deleteBody("nope")).rejects.toMatchObject({ status: 404, message: "body not found" });
    f.mockResolvedValueOnce(new Response("oops", { status: 502 }));
    await expect(c.getState()).rejects.toMatchObject({ status: 502, message: "HTTP 502" });
  });

  it("maps fetch failures to a network ApiError", async () => {
    const f = mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(createApiClient({ fetchImpl: f as unknown as typeof fetch }).getState()).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("rejects malformed payloads instead of passing them on", async () => {
    const f = mockFetch(async () => jsonResponse({ status: "paused", simulationTimeS: "soon", bodies: [] }));
    const c = createApiClient({ fetchImpl: f as unknown as typeof fetch });
    await expect(c.getState()).rejects.toMatchObject({ kind: "invalid-response" });
    f.mockResolvedValueOnce(jsonResponse({ status: "paused", simulationTimeS: 0, bodies: [{ id: "x" }] }));
    await expect(c.getState()).rejects.toMatchObject({ kind: "invalid-response" });
  });
});

describe("api client: every request settles", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const never = () => new Promise<Response>(() => {}); // a backend that accepts the connection and never answers

  it("a read the backend never answers fails with a timeout instead of waiting forever (even if fetch ignores abort)", async () => {
    const f = mockFetch(never);
    const c = createApiClient({ fetchImpl: f as unknown as typeof fetch, readTimeoutMs: 5_000 });
    const result = c.getState().then(() => "resolved", (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(vi.getTimerCount()).toBe(1); // still waiting
    await vi.advanceTimersByTimeAsync(2);
    const error = (await result) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("timeout");
    expect(error.message).toMatch(/did not answer GET \/api\/v1\/simulation\/state within 5 s/);
  });

  it("aborts the underlying fetch when the deadline passes", async () => {
    const f = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const c = createApiClient({ fetchImpl: f as unknown as typeof fetch, readTimeoutMs: 1_000 });
    const result = c.health().then(() => "resolved", (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(((await result) as ApiError).kind).toBe("timeout"); // not "network": the abort was ours
    expect(f.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("a response whose body never arrives also times out", async () => {
    const stalledBody = { ok: true, status: 200, json: () => new Promise(() => {}) } as unknown as Response;
    const c = createApiClient({ fetchImpl: (async () => stalledBody) as unknown as typeof fetch, readTimeoutMs: 1_000 });
    const result = c.getState().then(() => "resolved", (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(((await result) as ApiError).kind).toBe("timeout");
  });

  it("uses the longer write timeout for steps and mutations than for reads", async () => {
    const c = createApiClient({ fetchImpl: mockFetch(never) as unknown as typeof fetch, readTimeoutMs: 1_000, writeTimeoutMs: 9_000 });
    const read = c.getState().then(() => "resolved", (e: unknown) => e);
    const step = c.step(10).then(() => "resolved", (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(((await read) as ApiError).kind).toBe("timeout");
    let stepSettled = false;
    void step.then(() => (stepSettled = true));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(stepSettled).toBe(false); // the step is still allowed to run
    await vi.advanceTimersByTimeAsync(4_000);
    expect(((await step) as ApiError).kind).toBe("timeout");
  });

  it("a request that finishes in time leaves no timer behind and is not turned into an error later", async () => {
    const c = createApiClient({ fetchImpl: mockFetch(async () => jsonResponse(state([sun]))) as unknown as typeof fetch, readTimeoutMs: 1_000 });
    await expect(c.getState()).resolves.toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000); // would surface an unhandled rejection if the deadline were left armed
  });

  it("still reports an HTTP 503 from the backend with its detail", async () => {
    const f = mockFetch(async () => jsonResponse({ detail: "the simulation is busy (a step is still running)" }, 503));
    const error = await createApiClient({ fetchImpl: f as unknown as typeof fetch }).step(10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
    expect((error as ApiError).message).toMatch(/busy/);
  });
});
