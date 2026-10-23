// Display formatting. Values are always shown in SI units with an explicit unit label.

/** Compact scientific/decimal text that Number() parses back (used to seed inspector inputs). */
export function formatNumber(x: number): string {
  if (x === 0) return "0";
  const abs = Math.abs(x);
  if (abs >= 1e-3 && abs < 1e6) return String(Number(x.toPrecision(7)));
  return x.toExponential(6).replace(/\.?0+e/, "e").replace("e+", "e");
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const YEAR = 365.25 * DAY;

/** Human readable duration for simulated seconds, e.g. 3.2 d, 1.5 yr. */
export function formatDuration(seconds: number): string {
  const a = Math.abs(seconds);
  if (a >= YEAR) return `${trim(seconds / YEAR)} yr`;
  if (a >= DAY) return `${trim(seconds / DAY)} d`;
  if (a >= HOUR) return `${trim(seconds / HOUR)} h`;
  if (a >= MINUTE) return `${trim(seconds / MINUTE)} min`;
  return `${trim(seconds)} s`;
}

function trim(x: number): string {
  return String(Number(x.toPrecision(3)));
}
