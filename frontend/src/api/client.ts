import { ApiError, describeDetail } from "./errors";
import { parseBodyDto, parseEventList, parseStateDto, parseStepResponse } from "./parse";
import type {
  BodyCreateDto,
  BodyDto,
  BodyUpdateDto,
  SimulationEventDto,
  SimulationStateDto,
  StepResponseDto,
} from "./types";

const V1 = "/api/v1";

export interface ApiClient {
  health(): Promise<boolean>;
  getState(): Promise<SimulationStateDto>;
  createBody(body: BodyCreateDto): Promise<BodyDto>;
  updateBody(id: string, patch: BodyUpdateDto): Promise<BodyDto>;
  deleteBody(id: string): Promise<void>;
  step(dtS: number): Promise<StepResponseDto>;
  reset(): Promise<SimulationStateDto>;
  getEvents(): Promise<SimulationEventDto[]>;
}

export interface ApiClientOptions {
  /** Prefix for all paths; "" uses same-origin (the Vite dev proxy forwards to the backend). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Longest wait for a read (health, state, events). The backend answers reads without waiting for a step. */
  readTimeoutMs?: number;
  /** Longest wait for a mutation or step: above the backend's step budget (10 s) and lock wait (15 s). */
  writeTimeoutMs?: number;
}

export const DEFAULT_READ_TIMEOUT_MS = 8_000;
export const DEFAULT_WRITE_TIMEOUT_MS = 35_000;

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const base = options.baseUrl ?? "";
  const doFetch = options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const readTimeoutMs = options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const writeTimeoutMs = options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;

  /**
   * One bounded request. Every call settles: a backend that accepts the connection but never answers (a long or
   * stuck step) ends in an ApiError("timeout") instead of leaving the caller waiting forever. The timer covers the
   * response body too. The deadline both aborts the fetch and rejects directly, so it works even with a `fetch`
   * that ignores the abort signal. A timed-out *write* has an unknown outcome on the server: callers must re-read
   * the state rather than assume it did or did not happen.
   */
  async function call(method: string, path: string, timeoutMs: number, body?: unknown, wantJson = true): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutError = () =>
      new ApiError("timeout", `The backend did not answer ${method} ${path} within ${Math.round(timeoutMs / 100) / 10} s`);
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(timeoutError());
      }, timeoutMs);
    });
    deadline.catch(() => undefined); // never an unhandled rejection when the request wins the race

    const work = (async (): Promise<unknown> => {
      let res: Response;
      try {
        res = await doFetch(base + path, {
          method,
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        if (controller.signal.aborted) throw timeoutError();
        throw new ApiError("network", `Cannot reach the backend (${e instanceof Error ? e.message : String(e)})`);
      }
      if (!res.ok) {
        let parsed: unknown;
        try {
          parsed = await res.json();
        } catch {
          parsed = undefined;
        }
        throw new ApiError("http", describeDetail(parsed, `HTTP ${res.status}`), res.status);
      }
      if (!wantJson) return undefined;
      try {
        return await res.json();
      } catch {
        if (controller.signal.aborted) throw timeoutError();
        throw new ApiError("invalid-response", "Response was not valid JSON");
      }
    })();

    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
      work.catch(() => undefined); // a late failure of the abandoned request is not an unhandled rejection
    }
  }

  return {
    async health() {
      const data = (await call("GET", "/healthz", readTimeoutMs)) as { status?: unknown } | null;
      return data?.status === "ok";
    },
    async getState() {
      return parseStateDto(await call("GET", `${V1}/simulation/state`, readTimeoutMs));
    },
    async createBody(body) {
      return parseBodyDto(await call("POST", `${V1}/bodies`, writeTimeoutMs, body));
    },
    async updateBody(id, patch) {
      return parseBodyDto(await call("PATCH", `${V1}/bodies/${encodeURIComponent(id)}`, writeTimeoutMs, patch));
    },
    async deleteBody(id) {
      await call("DELETE", `${V1}/bodies/${encodeURIComponent(id)}`, writeTimeoutMs, undefined, false);
    },
    async step(dtS) {
      return parseStepResponse(await call("POST", `${V1}/simulation/step`, writeTimeoutMs, { dtS }));
    },
    async reset() {
      return parseStateDto(await call("POST", `${V1}/simulation/reset`, writeTimeoutMs));
    },
    async getEvents() {
      return parseEventList(await call("GET", `${V1}/events`, readTimeoutMs)).events;
    },
  };
}
