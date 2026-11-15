// Display formatting for the mission-design panels. Values come from the backend in SI; these only choose a readable unit.

const DAY = 86400;

/** A length with a unit chosen for reading: m, km or thousand km. Three to four significant figures. */
export function formatLength(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "—";
  const a = Math.abs(m);
  if (a < 1000) return `${Number(m.toPrecision(3))} m`;
  if (a < 1e7) return `${(m / 1000).toLocaleString("en-US", { maximumFractionDigits: a < 1e5 ? 2 : 1 })} km`;
  return `${(m / 1000).toLocaleString("en-US", { maximumFractionDigits: 0 })} km`;
}

export function formatSpeed(mPerS: number | null | undefined): string {
  if (mPerS === null || mPerS === undefined || !Number.isFinite(mPerS)) return "—";
  const a = Math.abs(mPerS);
  if (a >= 1000) return `${(mPerS / 1000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} km/s`;
  return `${Number(mPerS.toPrecision(4))} m/s`;
}

export function formatMass(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return "—";
  if (Math.abs(kg) >= 1e6) return `${Number((kg / 1000).toPrecision(4)).toLocaleString("en-US")} t`;
  return `${kg.toLocaleString("en-US", { maximumFractionDigits: Math.abs(kg) < 100 ? 2 : 0 })} kg`;
}

/** A span of simulated time: seconds, minutes, hours or days, two parts at most ("3 d 23 h", "1 h 32 min"). */
export function formatSpan(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.abs(seconds);
  const sign = seconds < 0 ? "−" : "";
  if (s < 60) return `${sign}${Number(s.toPrecision(3))} s`;
  if (s < 3600) return `${sign}${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  if (s < DAY) return `${sign}${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return `${sign}${Math.floor(s / DAY)} d ${Math.round((s % DAY) / 3600)} h`;
}

/** "T − 1 h 32 min" before an epoch, "T + 4 min 10 s" after it. */
export function formatCountdown(epochS: number, nowS: number): string {
  const d = epochS - nowS;
  return d >= 0 ? `T − ${formatSpan(d)}` : `T + ${formatSpan(-d)}`;
}

export function formatAngle(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return "—";
  return `${Number(deg.toFixed(3))}°`;
}

/** Parses a user-typed number; empty or non-numeric text is null. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
