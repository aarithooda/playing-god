import type { BodyAssetKey, BodyType } from "../api/types";

export interface CelestialAssetSet {
  diffuse?: string;
  normal?: string;
  roughness?: string;
  emissive?: string;
  rings?: string;
  ringInnerScale?: number;
  ringOuterScale?: number;
  ringOpacity?: number;
  /** Supplied as asset metadata; the renderer does not infer atmospheric colors from names. */
  atmosphereColor?: string;
  atmosphereOpacity?: number;
}

const texture = (prefix: string, map: string) => `/assets/textures/${prefix}_${map}.jpg`;

/** Exact filename mapping for body-specific maps and the shared asset manifest. */
export const CELESTIAL_ASSETS: Record<BodyAssetKey, CelestialAssetSet> = {
  sun: { diffuse: texture("sun", "diffuse"), emissive: texture("sun", "emissive") },
  mercury: {
    diffuse: texture("mercury", "diffuse"),
    normal: texture("mercury", "normal"),
    roughness: texture("mercury", "roughness"),
  },
  venus: {
    diffuse: texture("venus", "diffuse"),
    normal: texture("venus", "normal"),
    roughness: texture("venus", "roughness"),
  },
  earth: {
    diffuse: texture("earth", "diffuse"),
    normal: texture("earth", "normal"),
    roughness: texture("earth", "roughness"),
  },
  mars: {
    diffuse: texture("mars", "diffuse"),
    normal: texture("mars", "normal"),
    roughness: texture("mars", "roughness"),
  },
  jupiter: {
    diffuse: texture("jupiter", "diffuse"),
    normal: texture("jupiter", "normal"),
    roughness: texture("jupiter", "roughness"),
    rings: "/assets/textures/jupiter_rings.svg",
    ringInnerScale: 1.3,
    ringOuterScale: 3.2,
    ringOpacity: 0.62,
  },
  saturn: {
    diffuse: texture("saturn", "diffuse"),
    rings: "/assets/textures/saturn_rings.svg",
    ringInnerScale: 1.25,
    ringOuterScale: 2.35,
    ringOpacity: 0.9,
  },
  uranus: {
    diffuse: texture("uranus", "diffuse"),
    rings: "/assets/textures/uranus_rings.svg",
    ringInnerScale: 1.5,
    ringOuterScale: 2.05,
    ringOpacity: 0.78,
  },
  neptune: {
    diffuse: texture("neptune", "diffuse"),
    normal: texture("neptune", "normal"),
    roughness: texture("neptune", "roughness"),
    rings: "/assets/textures/neptune_rings.svg",
    ringInnerScale: 1.4,
    ringOuterScale: 2.45,
    ringOpacity: 0.58,
  },
  moon: { diffuse: texture("moon", "diffuse") },
  io: { diffuse: texture("io", "diffuse") },
  europa: { diffuse: texture("europa", "diffuse") },
  ganymede: { diffuse: texture("ganymede", "diffuse") },
  callisto: { diffuse: texture("callisto", "diffuse") },
  titan: { diffuse: texture("titan", "diffuse") },
  rhea: { diffuse: texture("rhea", "diffuse") },
  iapetus: { diffuse: texture("iapetus", "diffuse") },
  dione: { diffuse: texture("dione", "diffuse") },
  tethys: { diffuse: texture("tethys", "diffuse") },
  "proxima-centauri": { diffuse: texture("proxima", "diffuse"), emissive: texture("proxima", "emissive") },
  "trappist-1": { diffuse: texture("trappist1", "diffuse"), emissive: texture("trappist1", "emissive") },
  "sirius-a": { diffuse: texture("sirius", "diffuse"), emissive: texture("sirius", "emissive") },
  betelgeuse: { diffuse: texture("betelgeuse", "diffuse"), emissive: texture("betelgeuse", "emissive") },
};

/** Generic maps are used for custom bodies and when a specific body's maps are missing. */
export const TYPE_FALLBACK_ASSETS: Partial<Record<BodyType, CelestialAssetSet>> = {
  star: { diffuse: texture("generic_star", "diffuse"), emissive: texture("generic_star", "emissive") },
  "rocky-planet": {
    diffuse: texture("generic_rocky", "diffuse"),
    normal: texture("generic_rocky", "normal"),
    roughness: texture("generic_rocky", "roughness"),
  },
  "gas-giant": {
    diffuse: texture("generic_gas", "diffuse"),
    normal: texture("generic_gas", "normal"),
    roughness: texture("generic_gas", "roughness"),
  },
  "ice-giant": {
    diffuse: texture("generic_ice", "diffuse"),
    normal: texture("generic_ice", "normal"),
    roughness: texture("generic_ice", "roughness"),
  },
  // Custom moons without a known asset key use the generic rocky map.
  moon: {
    diffuse: texture("generic_asteroid", "diffuse"),
    normal: texture("generic_asteroid", "normal"),
    roughness: texture("generic_asteroid", "roughness"),
  },
  asteroid: {
    diffuse: texture("generic_asteroid", "diffuse"),
    normal: texture("generic_asteroid", "normal"),
    roughness: texture("generic_asteroid", "roughness"),
  },
};

export function resolveCelestialAssets(assetKey: string | undefined, bodyType: BodyType): CelestialAssetSet | undefined {
  const specific = assetKey && Object.prototype.hasOwnProperty.call(CELESTIAL_ASSETS, assetKey)
    ? CELESTIAL_ASSETS[assetKey as BodyAssetKey]
    : undefined;
  const fallback = TYPE_FALLBACK_ASSETS[bodyType];
  if (!specific && !fallback) return undefined;
  return { ...fallback, ...specific };
}

export function resolveTypeFallbackAssets(bodyType: BodyType): CelestialAssetSet | undefined {
  return TYPE_FALLBACK_ASSETS[bodyType];
}
