export type ApiErrorKind = "network" | "http" | "invalid-response";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;

  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
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
