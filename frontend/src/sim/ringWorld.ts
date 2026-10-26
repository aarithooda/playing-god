// Ring World preset: the display-only maths (pure, deterministic, unit-tested).
//
// WHAT IS PHYSICAL AND WHAT IS NOT. The backend preset `saturn-particle-rings` simulates Saturn and five moons as point
// masses. The ring grains generated here are a VISUAL layer: massless, never sent to or read from the backend, never
// picked, never part of a collision. They move only in the shader (a slow cosmetic drift) and are not integrated.
// All lengths below are in units of the displayed Saturn radius (the body's `radius`), so the layer scales with the planet.
import type { SceneBody } from "./viewModel";

export const RING_WORLD_PRESET_ID = "saturn-particle-rings";
export const RING_WORLD_ASSET_KEY = "saturn";
/** The preset's own bodies. Anything else in a Ring World universe is an intruder that disturbs the ring grains. */
export const RING_WORLD_PRESET_BODY_IDS: readonly string[] = ["body-saturn", "body-titan", "body-rhea", "body-iapetus", "body-dione", "body-tethys"];

/** A body that is not part of the preset, as seen by the ring layer (scene units). */
export interface RingIntruder { id: string; position: readonly [number, number, number]; radius: number }

/** Grains closer than this (planet radii) to an intruder are swallowed. Never smaller than a visible speck. */
export function intruderCaptureRadius(intruderRadius: number, unit: number): number {
  return Math.max(0.15, 2.5 * intruderRadius / Math.max(unit, 1e-12));
}
/** Grains inside this distance are flung outward; the push falls off as the inverse square of distance. */
export const INTRUDER_INFLUENCE_FACTOR = 6;
export const INTRUDER_KICK_RADII_PER_S = 6;
/** A grain thrown beyond these limits (planet radii) is gone for good. */
export const GRAIN_EJECT_RADIUS = 6;
export const GRAIN_EJECT_HEIGHT = 2;

/**
 * Disturbs ring grains in place. `ringPos` are the intruders in the un-tilted ring frame (planet radii), `capture` their
 * capture radii. Returns whether any grain changed. Pure and deterministic, so it is unit-tested.
 */
export function disturbGrains(orbit: Float32Array, alive: Float32Array, time: number, intruders: readonly (readonly [number, number, number])[], capture: readonly number[], dt: number): boolean {
  let changed = false;
  const n = alive.length;
  for (let i = 0; i < n; i += 1) {
    if (alive[i] === 0) continue;
    const o = i * 4;
    const r = orbit[o]!;
    const a = orbit[o + 1]! + orbit[o + 2]! * time;
    const cx = Math.cos(a);
    const sz = Math.sin(a);
    const x = cx * r;
    const z = sz * r;
    const y = orbit[o + 3]!;
    for (let k = 0; k < intruders.length; k += 1) {
      const P = intruders[k]!;
      const dx = x - P[0];
      const dy = y - P[1];
      const dz = z - P[2];
      const d = Math.hypot(dx, dy, dz);
      const cap = capture[k]!;
      if (d < cap) { alive[i] = 0; changed = true; break; }
      if (d < cap * INTRUDER_INFLUENCE_FACTOR && dt > 0) {
        const push = INTRUDER_KICK_RADII_PER_S * (cap / d) ** 2 * dt;
        const inPlane = Math.hypot(dx, dz) || 1;
        // radial component of "away from the intruder", and a deterministic up/down sign per grain
        orbit[o] = r + push * ((dx * cx + dz * sz) / inPlane);
        orbit[o + 3] = y + push * 0.5 * (i % 2 === 0 ? 1 : -1) * (dy >= 0 ? 1 : -1);
        changed = true;
        if (orbit[o]! > GRAIN_EJECT_RADIUS || orbit[o]! < 0.9 || Math.abs(orbit[o + 3]!) > GRAIN_EJECT_HEIGHT) { alive[i] = 0; break; }
      }
    }
  }
  return changed;
}

/** Default number of grains. One instanced draw call; a few hundred thousand triangles at most. */
export const RING_GRAIN_COUNT = 12000;
export const RING_GRAIN_SEED = 20240531;

/** Saturn mean radius used by the preset (km); ring edges below are public ring-system radii (km) divided by it. */
const SATURN_MEAN_RADIUS_KM = 58232;
const km = (x: number) => x / SATURN_MEAN_RADIUS_KM;

/** Radial structure, in displayed Saturn radii (approximate published ring-system boundaries; see context/PRESETS.md). */
export const RING_EDGES = {
  cInner: km(74658),
  bInner: km(92000),
  bOuter: km(117580),
  aInner: km(122170),
  enckeGap: km(133589),
  aOuter: km(136775),
  fRing: km(140180),
  /** Faint outer scatter used for the sparse arcs. */
  outerLimit: km(152000),
} as const;

/** Where the dense front lobe sits, as an azimuth in the ring plane (x = cos, z = sin): +z faces the default camera. */
export const FRONT_AZIMUTH = Math.PI / 2;
/** Visual tilt of the ring plane (radians about the scene x axis, then z), a display choice for the composition. */
export const RING_TILT = { x: 0.1, z: -0.2 } as const;
/** Direction towards the (invisible) light, in the scene frame. */
export const SUN_DIRECTION: readonly [number, number, number] = (() => {
  const v = [-0.62, 0.38, 0.69];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n] as const;
})();

export function isRingWorldBody(presetId: string | null | undefined, body: Pick<SceneBody, "assetKey">): boolean {
  return presetId === RING_WORLD_PRESET_ID && body.assetKey === RING_WORLD_ASSET_KEY;
}

// ---- deterministic randomness -----------------------------------------------------------------------------------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const band = (x: number, a: number, b: number, edge = 0.012) => smooth(a - edge, a + edge, x) * (1 - smooth(b - edge, b + edge, x));

/** Relative grain density at radius r (displayed Saturn radii): dense B ring, empty Cassini division, thinner A ring with an Encke gap. */
export function ringDensity(r: number): number {
  const e = RING_EDGES;
  const ripple = 1 + 0.22 * Math.sin(r * 61.0) * Math.sin(r * 23.0 + 1.3) + 0.12 * Math.sin(r * 137.0 + 0.4);
  const c = 0.2 * band(r, e.cInner, e.bInner);
  const b = (0.55 + 0.45 * smooth(e.bInner, e.bInner + 0.28, r)) * band(r, e.bInner, e.bOuter) * ripple;
  const a = 0.62 * band(r, e.aInner, e.aOuter) * (1 - 0.95 * band(r, e.enckeGap - 0.012, e.enckeGap + 0.012, 0.004)) * ripple;
  const f = 0.3 * band(r, e.fRing - 0.012, e.fRing + 0.012, 0.006);
  const outer = 0.04 * band(r, e.aOuter, e.outerLimit, 0.04);
  return Math.max(0, c + b + a + f + outer);
}

/** Azimuthal weight: a broad dense front lobe, two thin arcs to the sides and a sparse floor all round. */
function sampleAzimuth(rand: () => number): number {
  const u = rand();
  const vonMises = (mu: number, kappa: number) => {
    // Rejection sampling from exp(kappa * (cos(x - mu) - 1)).
    for (let i = 0; i < 64; i += 1) {
      const x = (rand() * 2 - 1) * Math.PI;
      if (rand() < Math.exp(kappa * (Math.cos(x) - 1))) return mu + x;
    }
    return mu;
  };
  if (u < 0.56) return vonMises(FRONT_AZIMUTH, 3.2);
  if (u < 0.63) return vonMises(FRONT_AZIMUTH + 1.45, 7);
  if (u < 0.7) return vonMises(FRONT_AZIMUTH - 1.45, 7);
  return rand() * Math.PI * 2;
}

// ---- grains -----------------------------------------------------------------------------------------------------------
export interface RingGrains {
  count: number;
  /** (radius, phase, angular speed, height) per grain; radius and height in displayed Saturn radii. */
  orbit: Float32Array;
  /** Semi-axes per grain, displayed Saturn radii. */
  size: Float32Array;
  /** Unit quaternion (x, y, z, w) per grain. */
  rotation: Float32Array;
  /** Linear-light albedo per grain. */
  color: Float32Array;
}

/** Tan, beige, amber and muted gold (sRGB hex), weighted. */
const PALETTE: readonly (readonly [number, number, number])[] = [
  [0.84, 0.72, 0.52], // tan
  [0.9, 0.82, 0.66], // beige
  [0.78, 0.6, 0.34], // amber
  [0.72, 0.58, 0.3], // muted gold
  [0.93, 0.86, 0.72], // pale cream
  [0.62, 0.5, 0.36], // dusty brown
];
const PALETTE_WEIGHTS = [0.3, 0.22, 0.16, 0.14, 0.1, 0.08];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Angular speed (rad per second of wall clock) of the cosmetic drift: slow, and slower further out like a Kepler orbit. */
export const RING_DRIFT_RAD_PER_S = 0.045;
export function grainAngularSpeed(r: number): number {
  return RING_DRIFT_RAD_PER_S * (RING_EDGES.bInner / Math.max(r, 0.5)) ** 1.5;
}

export function generateRingGrains(count: number = RING_GRAIN_COUNT, seed: number = RING_GRAIN_SEED): RingGrains {
  const n = Math.max(0, Math.floor(count));
  const rand = mulberry32(seed);

  // Inverse-CDF table of the radial density.
  const bins = 2048;
  const r0 = RING_EDGES.cInner - 0.02;
  const r1 = RING_EDGES.outerLimit;
  const cdf = new Float64Array(bins + 1);
  for (let i = 0; i < bins; i += 1) cdf[i + 1] = cdf[i] + ringDensity(r0 + ((i + 0.5) / bins) * (r1 - r0));
  const total = cdf[bins];
  const sampleRadius = (u: number) => {
    const target = u * total;
    let lo = 0;
    let hi = bins;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] <= target) lo = mid;
      else hi = mid;
    }
    const f = (target - cdf[lo]) / Math.max(cdf[lo + 1] - cdf[lo], 1e-12);
    return r0 + ((lo + f) / bins) * (r1 - r0);
  };

  const orbit = new Float32Array(n * 4);
  const size = new Float32Array(n * 3);
  const rotation = new Float32Array(n * 4);
  const color = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const r = sampleRadius(rand());
    const phase = sampleAzimuth(rand);
    // Thin, slightly lumpy layer: most grains lie within a few thousandths of a radius of the plane.
    const height = (rand() + rand() + rand() - 1.5) * 0.012;
    orbit.set([r, phase, grainAngularSpeed(r), height], i * 4);

    // Mostly small grains with a tail of larger boulders (a power-law-like size spread).
    const s = 0.0075 + 0.016 * rand() ** 3 + (rand() < 0.012 ? 0.012 + 0.014 * rand() : 0);
    size.set([s * (0.8 + 0.5 * rand()), s * (0.65 + 0.5 * rand()), s * (0.8 + 0.5 * rand())], i * 3);

    // Uniform random rotation (Shoemake).
    const u1 = rand();
    const u2 = rand() * Math.PI * 2;
    const u3 = rand() * Math.PI * 2;
    const a = Math.sqrt(1 - u1);
    const b = Math.sqrt(u1);
    rotation.set([a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)], i * 4);

    let pick = rand();
    let k = 0;
    while (k < PALETTE.length - 1 && pick > PALETTE_WEIGHTS[k]) {
      pick -= PALETTE_WEIGHTS[k];
      k += 1;
    }
    const brightness = 0.55 + 0.6 * rand() ** 1.6;
    color.set(PALETTE[k].map((c) => toLinear(c) * brightness), i * 3);
  }
  return { count: n, orbit, size, rotation, color };
}

// ---- camera -----------------------------------------------------------------------------------------------------------
/** Camera elevation above the ring plane for the opening shot. */
export const RING_WORLD_ELEVATION_RAD = (13 * Math.PI) / 180;
/** The A ring must fit within this share of the free half-width at the opening distance. */
export const RING_WORLD_FIT_FRACTION = 0.9;
/** The free width used for framing is never less than this fraction of the canvas width. */
export const RING_WORLD_MIN_FREE_WIDTH_FRACTION = 0.5;
/** Never closer than this many planet radii. */
export const RING_WORLD_MIN_DISTANCE_RADII = 3.4;

export interface RingWorldFramingInput {
  /** Displayed (scene) radius of Saturn. */
  radius: number;
  fovDeg: number;
  width: number;
  height: number;
  leftInset: number;
  rightInset: number;
}

/** Offset of the opening camera from Saturn (scene units). The planet and the rings crossing in front of it fill the free area. */
export function ringWorldCameraOffset(input: RingWorldFramingInput): [number, number, number] {
  const { radius, fovDeg, width, height, leftInset, rightInset } = input;
  const valid = radius > 0 && width > 0 && height > 0 && fovDeg > 0 && fovDeg < 180;
  // On a phone the sidebars can cover the whole canvas; never frame for less than this share of the width.
  const freeWidth = valid ? Math.max(width - Math.max(0, leftInset) - Math.max(0, rightInset), RING_WORLD_MIN_FREE_WIDTH_FRACTION * width) : 0;
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
  const aspectFree = freeWidth > 0 ? freeWidth / height : 1;
  const fit = valid ? (RING_EDGES.aOuter * radius) / (RING_WORLD_FIT_FRACTION * tanHalf * aspectFree) : RING_WORLD_MIN_DISTANCE_RADII * Math.max(radius, 1e-6);
  const d = Math.max(fit, RING_WORLD_MIN_DISTANCE_RADII * radius);
  return [0, Math.sin(RING_WORLD_ELEVATION_RAD) * d, Math.cos(RING_WORLD_ELEVATION_RAD) * d];
}

// ---- planet bands -----------------------------------------------------------------------------------------------------
export const PLANET_TEXTURE_WIDTH = 512;
export const PLANET_TEXTURE_HEIGHT = 256;

/** Pale cream gas giant with faint latitude bands (sRGB RGBA bytes, equirectangular). Deterministic. */
export function planetBandPixels(width = PLANET_TEXTURE_WIDTH, height = PLANET_TEXTURE_HEIGHT, seed = 7): Uint8Array {
  const rand = mulberry32(seed);
  const waves = Array.from({ length: 9 }, () => ({ f: 3 + rand() * 17, p: rand() * 6.283, a: 0.2 + rand() * 0.8 }));
  const turb = Array.from({ length: 5 }, () => ({ fx: 2 + Math.floor(rand() * 6), fy: 6 + rand() * 20, p: rand() * 6.283 }));
  const out = new Uint8Array(width * height * 4);
  const cream: [number, number, number] = [236, 222, 186];
  const warm: [number, number, number] = [214, 190, 142];
  const pale: [number, number, number] = [245, 236, 208];
  for (let y = 0; y < height; y += 1) {
    const lat = (y / (height - 1)) * Math.PI - Math.PI / 2;
    for (let x = 0; x < width; x += 1) {
      const lon = (x / width) * Math.PI * 2;
      let v = 0;
      for (const w of waves) v += w.a * Math.sin(w.f * lat + w.p + 0.35 * Math.sin(3 * lon + w.p));
      for (const t of turb) v += 0.12 * Math.sin(t.fy * lat + t.fx * lon + t.p);
      v = v / 5.2;
      const t = Math.min(1, Math.max(0, 0.5 + 0.75 * v));
      const polar = Math.abs(lat) / (Math.PI / 2);
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const base = t < 0.5 ? warm[c] + (cream[c] - warm[c]) * (t * 2) : cream[c] + (pale[c] - cream[c]) * ((t - 0.5) * 2);
        out[o + c] = Math.round(base * (1 - 0.1 * polar * polar) - 6 * (0.5 - t));
      }
      out[o + 3] = 255;
    }
  }
  return out;
}
