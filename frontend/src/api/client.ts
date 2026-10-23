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
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const base = options.baseUrl ?? "";
  const doFetch = options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(base + path, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
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
    return res;
  }

  async function json(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new ApiError("invalid-response", "Response was not valid JSON");
    }
  }

  return {
    async health() {
      const data = (await json(await request("GET", "/healthz"))) as { status?: unknown } | null;
      return data?.status === "ok";
    },
    async getState() {
      return parseStateDto(await json(await request("GET", `${V1}/simulation/state`)));
    },
    async createBody(body) {
      return parseBodyDto(await json(await request("POST", `${V1}/bodies`, body)));
    },
    async updateBody(id, patch) {
      return parseBodyDto(await json(await request("PATCH", `${V1}/bodies/${encodeURIComponent(id)}`, patch)));
    },
    async deleteBody(id) {
      await request("DELETE", `${V1}/bodies/${encodeURIComponent(id)}`);
    },
    async step(dtS) {
      return parseStepResponse(await json(await request("POST", `${V1}/simulation/step`, { dtS })));
    },
    async reset() {
      return parseStateDto(await json(await request("POST", `${V1}/simulation/reset`)));
    },
    async getEvents() {
      return parseEventList(await json(await request("GET", `${V1}/events`))).events;
    },
  };
}
