// Form drafts (strings) -> validated API payloads. The backend remains authoritative; these checks
// give immediate feedback and mirror its documented bounds (LIMITS).
import { LIMITS } from "../api/types";
import type { BodyCreateDto, BodyUpdateDto } from "../api/types";
import type { BodyView } from "./viewModel";

export const FIELD_KEYS = ["name", "mass", "radius", "px", "py", "pz", "vx", "vy", "vz", "color"] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
export type FormValues = Record<FieldKey, string>;
export type FieldErrors = Partial<Record<FieldKey, string>>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

function finite(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

function check(key: FieldKey, text: string, errors: FieldErrors): number | undefined {
  const n = finite(text);
  if (n === undefined) {
    errors[key] = "Enter a finite number";
    return undefined;
  }
  switch (key) {
    case "mass":
      if (!(n > 0 && n <= LIMITS.maxMassKg)) errors[key] = `Must be > 0 and ≤ ${LIMITS.maxMassKg} kg`;
      break;
    case "radius":
      if (!(n > 0 && n <= LIMITS.maxRadiusM)) errors[key] = `Must be > 0 and ≤ ${LIMITS.maxRadiusM} m`;
      break;
    case "px":
    case "py":
    case "pz":
      if (Math.abs(n) > LIMITS.maxPositionM) errors[key] = `|value| must be ≤ ${LIMITS.maxPositionM} m`;
      break;
    case "vx":
    case "vy":
    case "vz":
      if (Math.abs(n) > LIMITS.maxSpeedMPerS) errors[key] = `|value| must be below ${LIMITS.maxSpeedMPerS} m/s`;
      break;
  }
  return errors[key] ? undefined : n;
}

function checkName(text: string, errors: FieldErrors): string | undefined {
  if (text.length < 1 || text.length > LIMITS.maxNameLength) {
    errors.name = `Name must be 1–${LIMITS.maxNameLength} characters`;
    return undefined;
  }
  return text;
}

function checkColor(text: string, errors: FieldErrors): string | undefined {
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) {
    errors.color = "Use #RRGGBB";
    return undefined;
  }
  return text;
}

function checkSpeed(v: { x: number; y: number; z: number }, keys: FieldKey, errors: FieldErrors): void {
  if (Math.hypot(v.x, v.y, v.z) >= LIMITS.maxSpeedMPerS) errors[keys] = "Speed must be below the speed of light";
}

export function parseBodyForm(values: FormValues): ParseResult<BodyCreateDto> {
  const errors: FieldErrors = {};
  const name = checkName(values.name, errors);
  const massKg = check("mass", values.mass, errors);
  const radiusM = check("radius", values.radius, errors);
  const px = check("px", values.px, errors);
  const py = check("py", values.py, errors);
  const pz = check("pz", values.pz, errors);
  const vx = check("vx", values.vx, errors);
  const vy = check("vy", values.vy, errors);
  const vz = check("vz", values.vz, errors);
  const colorHex = checkColor(values.color, errors);
  if (vx !== undefined && vy !== undefined && vz !== undefined) checkSpeed({ x: vx, y: vy, z: vz }, "vx", errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: name!,
      massKg: massKg!,
      radiusM: radiusM!,
      positionM: { x: px!, y: py!, z: pz! },
      velocityMPerS: { x: vx!, y: vy!, z: vz! },
      colorHex: colorHex!,
    },
  };
}

/**
 * Builds a PATCH payload from the fields the user edited. Vectors are replaced whole by the API,
 * so untouched components are filled from the confirmed body.
 */
export function parseBodyEdits(edits: Partial<FormValues>, current: BodyView): ParseResult<BodyUpdateDto> {
  const errors: FieldErrors = {};
  const patch: BodyUpdateDto = {};
  const has = (k: FieldKey) => edits[k] !== undefined;

  if (has("name")) {
    const v = checkName(edits.name!, errors);
    if (v !== undefined) patch.name = v;
  }
  if (has("color")) {
    const v = checkColor(edits.color!, errors);
    if (v !== undefined) patch.colorHex = v;
  }
  if (has("mass")) {
    const v = check("mass", edits.mass!, errors);
    if (v !== undefined) patch.massKg = v;
  }
  if (has("radius")) {
    const v = check("radius", edits.radius!, errors);
    if (v !== undefined) patch.radiusM = v;
  }

  const vec = (keys: [FieldKey, FieldKey, FieldKey], cur: { x: number; y: number; z: number }) => {
    if (!keys.some(has)) return undefined;
    const out = [cur.x, cur.y, cur.z];
    keys.forEach((k, i) => {
      if (has(k)) {
        const n = check(k, edits[k]!, errors);
        if (n !== undefined) out[i] = n;
      }
    });
    return { x: out[0], y: out[1], z: out[2] };
  };
  const pos = vec(["px", "py", "pz"], current.positionM);
  const vel = vec(["vx", "vy", "vz"], current.velocityMPerS);
  if (pos) patch.positionM = pos;
  if (vel) {
    patch.velocityMPerS = vel;
    checkSpeed(vel, (["vx", "vy", "vz"] as const).find(has)!, errors);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (Object.keys(patch).length === 0) return { ok: false, errors: {} };
  return { ok: true, value: patch };
}

export function valuesFromBody(b: BodyView, fmt: (n: number) => string): FormValues {
  return {
    name: b.name,
    mass: fmt(b.massKg),
    radius: fmt(b.radiusM),
    px: fmt(b.positionM.x),
    py: fmt(b.positionM.y),
    pz: fmt(b.positionM.z),
    vx: fmt(b.velocityMPerS.x),
    vy: fmt(b.velocityMPerS.y),
    vz: fmt(b.velocityMPerS.z),
    color: b.colorHex,
  };
}

/** Earth-like defaults for the "create body" form (SI units). */
export const NEW_BODY_DEFAULTS: FormValues = {
  name: "New body",
  mass: "5.972e24",
  radius: "6.371e6",
  px: "1.496e11",
  py: "0",
  pz: "0",
  vx: "0",
  vy: "29780",
  vz: "0",
  color: "#3b82f6",
};

/**
 * Gives the create form an automatically chosen position outside every current body's sphere.
 * Try the closest free point on each coordinate axis first; the normal case is a small offset
 * from the familiar Earth-orbit default. The backend still validates every submitted position.
 */
export function defaultsForNewBody(bodies: readonly BodyView[], radiusText = NEW_BODY_DEFAULTS.radius): FormValues {
  const parsedRadius = Number(radiusText);
  const radius = Number.isFinite(parsedRadius) && parsedRadius > 0 ? parsedRadius : Number(NEW_BODY_DEFAULTS.radius);
  const origin = { x: Number(NEW_BODY_DEFAULTS.px), y: 0, z: 0 };
  if (bodies.length === 0) return { ...NEW_BODY_DEFAULTS };

  const gapFor = (body: BodyView) => Math.max(1, (radius + body.radiusM) * 0.1);
  const isFree = (position: { x: number; y: number; z: number }) =>
    bodies.every((body) => {
      const dx = position.x - body.positionM.x;
      const dy = position.y - body.positionM.y;
      const dz = position.z - body.positionM.z;
      return Math.hypot(dx, dy, dz) >= radius + body.radiusM + gapFor(body);
    });

  const choices: Array<{ position: typeof origin; distanceSquared: number }> = [];
  const axes = ["x", "y", "z"] as const;
  for (const axis of axes) {
    const base = origin[axis];
    const positive = Math.max(base, ...bodies.map((body) => body.positionM[axis] + radius + body.radiusM + gapFor(body)));
    const negative = Math.min(base, ...bodies.map((body) => body.positionM[axis] - radius - body.radiusM - gapFor(body)));
    for (const coordinate of [positive, negative]) {
      if (!Number.isFinite(coordinate) || Math.abs(coordinate) > LIMITS.maxPositionM) continue;
      const position = { ...origin, [axis]: coordinate };
      if (!isFree(position)) continue;
      const dx = position.x - origin.x;
      const dy = position.y - origin.y;
      const dz = position.z - origin.z;
      choices.push({ position, distanceSquared: dx * dx + dy * dy + dz * dz });
    }
  }

  // A crowded scene can block the axis candidates. Search a bounded set of diagonal placements
  // before falling back to the origin default; the backend remains the final overlap authority.
  if (choices.length === 0) {
    const largestRadius = Math.max(radius, ...bodies.map((body) => body.radiusM));
    const stride = 2.2 * (radius + largestRadius);
    for (let ring = 1; ring <= 256 && choices.length === 0; ring += 1) {
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) {
          for (const dz of [-1, 0, 1]) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const norm = Math.hypot(dx, dy, dz);
            const distance = stride * ring;
            const position = {
              x: origin.x + (dx / norm) * distance,
              y: origin.y + (dy / norm) * distance,
              z: origin.z + (dz / norm) * distance,
            };
            if (Object.values(position).some((coordinate) => Math.abs(coordinate) > LIMITS.maxPositionM)) continue;
            if (isFree(position)) {
              choices.push({ position, distanceSquared: distance * distance });
            }
          }
        }
      }
    }
  }

  const position = choices.sort((a, b) => a.distanceSquared - b.distanceSquared)[0]?.position ?? origin;
  return { ...NEW_BODY_DEFAULTS, px: String(position.x), py: String(position.y), pz: String(position.z) };
}
