import { ApiError, describeDetail } from "./errors";
import {
  parseActivation,
  parseBodyDto,
  parseCatalogue,
  parseEventList,
  parseHistoryPage,
  parsePresetList,
  parseSnapshotList,
  parseSnapshotSummary,
  parseStateDto,
  parseStepResponse,
  parseUniverseList,
  parseUniverseSummary,
} from "./parse";
import type {
  ActivationDto,
  BodyCreateDto,
  BodyDto,
  BodyUpdateDto,
  CatalogueDto,
  CreateUniverseDto,
  HistoryPageDto,
  PresetSummaryDto,
  SimulationEventDto,
  SimulationStateDto,
  SnapshotSummaryDto,
  StepResponseDto,
  UniverseListDto,
  UniverseScope,
  UniverseSummaryDto,
} from "./types";

const V1 = "/api/v1";

/** What the simulation hook needs from the backend: the legacy single-simulation surface, or one universe's. */
export interface SimulationClient {
  health(): Promise<boolean>;
  getState(): Promise<SimulationStateDto>;
  createBody(body: BodyCreateDto): Promise<BodyDto>;
  updateBody(id: string, patch: BodyUpdateDto): Promise<BodyDto>;
  deleteBody(id: string): Promise<void>;
  step(dtS: number): Promise<StepResponseDto>;
  reset(): Promise<SimulationStateDto>;
  getEvents(): Promise<SimulationEventDto[]>;
}

export interface HistoryQuery {
  generation?: number;
  fromIndex?: number;
  bodyIds?: string[];
  limit?: number;
}

/** A client bound to one universe and one activation epoch: every mutation carries the epoch. */
export interface ScopedClient extends SimulationClient {
  readonly scope: UniverseScope;
  listSnapshots(): Promise<SnapshotSummaryDto[]>;
  createSnapshot(name?: string): Promise<SnapshotSummaryDto>;
  restoreSnapshot(snapshotId: string): Promise<SimulationStateDto>;
  deleteSnapshot(snapshotId: string): Promise<void>;
  getHistory(query?: HistoryQuery): Promise<HistoryPageDto>;
}

export interface ApiClient extends SimulationClient {
  listUniverses(): Promise<UniverseListDto>;
  createUniverse(request: CreateUniverseDto): Promise<UniverseSummaryDto>;
  activateUniverse(universeId: string): Promise<ActivationDto>;
  deleteUniverse(universeId: string): Promise<void>;
  listPresets(): Promise<PresetSummaryDto[]>;
  /** The sourced body catalogue (read-only, independent of any universe). */
  getCatalogue(): Promise<CatalogueDto>;
  /** A client for one universe; mutations echo `scope.activationEpoch`. */
  scoped(scope: UniverseScope): ScopedClient;
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
        const code = typeof (parsed as { code?: unknown } | undefined)?.code === "string" ? (parsed as { code: string }).code : undefined;
        throw new ApiError("http", describeDetail(parsed, `HTTP ${res.status}`), res.status, code);
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

  const health = async () => {
    const data = (await call("GET", "/healthz", readTimeoutMs)) as { status?: unknown } | null;
    return data?.status === "ok";
  };

  function scoped(scope: UniverseScope): ScopedClient {
    const root = `${V1}/universes/${encodeURIComponent(scope.universeId)}`;
    const epoch = `activationEpoch=${scope.activationEpoch}`;
    return {
      scope,
      health,
      async getState() {
        return parseStateDto(await call("GET", `${root}/state`, readTimeoutMs));
      },
      async createBody(body) {
        return parseBodyDto(await call("POST", `${root}/bodies?${epoch}`, writeTimeoutMs, body));
      },
      async updateBody(id, patch) {
        return parseBodyDto(await call("PATCH", `${root}/bodies/${encodeURIComponent(id)}?${epoch}`, writeTimeoutMs, patch));
      },
      async deleteBody(id) {
        await call("DELETE", `${root}/bodies/${encodeURIComponent(id)}?${epoch}`, writeTimeoutMs, undefined, false);
      },
      async step(dtS) {
        return parseStepResponse(await call("POST", `${root}/step?${epoch}`, writeTimeoutMs, { dtS }));
      },
      async reset() {
        return parseStateDto(await call("POST", `${root}/reset?${epoch}`, writeTimeoutMs));
      },
      async getEvents() {
        return parseEventList(await call("GET", `${root}/events`, readTimeoutMs)).events;
      },
      async listSnapshots() {
        return parseSnapshotList(await call("GET", `${root}/snapshots`, readTimeoutMs));
      },
      async createSnapshot(name) {
        return parseSnapshotSummary(await call("POST", `${root}/snapshots?${epoch}`, writeTimeoutMs, name ? { name } : {}));
      },
      async restoreSnapshot(snapshotId) {
        return parseStateDto(
          await call("POST", `${root}/snapshots/${encodeURIComponent(snapshotId)}/restore?${epoch}`, writeTimeoutMs),
        );
      },
      async deleteSnapshot(snapshotId) {
        await call("DELETE", `${root}/snapshots/${encodeURIComponent(snapshotId)}?${epoch}`, writeTimeoutMs, undefined, false);
      },
      async getHistory(query = {}) {
        const p = new URLSearchParams();
        if (query.generation !== undefined) p.set("generation", String(query.generation));
        if (query.fromIndex !== undefined) p.set("fromIndex", String(query.fromIndex));
        if (query.bodyIds?.length) p.set("bodyIds", query.bodyIds.join(","));
        if (query.limit !== undefined) p.set("limit", String(query.limit));
        const qs = p.toString();
        return parseHistoryPage(await call("GET", `${root}/history${qs ? `?${qs}` : ""}`, readTimeoutMs));
      },
    };
  }

  return {
    health,
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
    async listUniverses() {
      return parseUniverseList(await call("GET", `${V1}/universes`, readTimeoutMs));
    },
    async createUniverse(request) {
      return parseUniverseSummary(await call("POST", `${V1}/universes`, writeTimeoutMs, request));
    },
    async activateUniverse(universeId) {
      return parseActivation(await call("POST", `${V1}/universes/${encodeURIComponent(universeId)}/activate`, writeTimeoutMs));
    },
    async deleteUniverse(universeId) {
      await call("DELETE", `${V1}/universes/${encodeURIComponent(universeId)}`, writeTimeoutMs, undefined, false);
    },
    async listPresets() {
      return parsePresetList(await call("GET", `${V1}/presets`, readTimeoutMs));
    },
    async getCatalogue() {
      return parseCatalogue(await call("GET", `${V1}/catalogue`, readTimeoutMs));
    },
    scoped,
  };
}
