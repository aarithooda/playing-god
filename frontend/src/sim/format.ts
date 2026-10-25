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

const SUPERSCRIPT: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

/** Three significant figures for reading at a glance: 9.82, 5,513, 5.97 × 10²⁴ (display only, never parsed back). */
export function formatReadout(x: number): string {
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const abs = Math.abs(x);
  if (abs >= 0.01 && abs < 1e5) return Number(x.toPrecision(3)).toLocaleString("en-US", { maximumSignificantDigits: 3 });
  const [mantissa, exponent] = x.toExponential(2).split("e");
  const exp = String(Number(exponent)).split("").map((c) => SUPERSCRIPT[c] ?? c).join("");
  return `${mantissa} × 10${exp}`;
}
