/** "timeout": the backend accepted the request but did not answer in time (outcome of a write is unknown). */
export type ApiErrorKind = "network" | "http" | "invalid-response" | "timeout";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  /** The backend's machine-readable error code (e.g. "stale_activation"), when it sent one. */
  readonly code?: string;

  constructor(kind: ApiErrorKind, message: string, status?: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** Turns FastAPI error bodies ({"detail": "..."} or {"detail": [{loc,msg}]}) into one readable line. */
export function describeDetail(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((d) => {
      if (typeof d !== "object" || d === null) return String(d);
      const { loc, msg } = d as { loc?: unknown; msg?: unknown };
      const where = Array.isArray(loc) ? loc.filter((p) => p !== "body").join(".") : "";
      return where ? `${where}: ${String(msg)}` : String(msg);
    });
    return parts.join("; ") || fallback;
  }
  return fallback;
}
