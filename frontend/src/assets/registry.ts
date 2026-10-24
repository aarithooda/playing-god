import type { BodyAssetKey, BodyType } from "../api/types";

export interface CelestialAssetSet {
  diffuse?: string;
  normal?: string;
  roughness?: string;
  emissive?: string;
  rings?: string;
  /** Supplied as asset metadata; the renderer does not infer atmospheric colors from names. */
  atmosphereColor?: string;
  atmosphereOpacity?: number;
}

const texture = (prefix: string, map: string) => `/assets/textures/${prefix}_${map}.jpg`;

/** Exact filename mapping from the agreed 36-file asset manifest. */
export const CELESTIAL_ASSETS: Record<BodyAssetKey, CelestialAssetSet> = {
  sun: { diffuse: texture("sun", "diffuse"), emissive: texture("sun", "emissive") },
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
  },
  neptune: {
    diffuse: texture("neptune", "diffuse"),
    normal: texture("neptune", "normal"),
    roughness: texture("neptune", "roughness"),
  },
  // Earth's Moon uses the Moon map the generic fallback is derived from (see ATTRIBUTION.md).
  moon: {
    diffuse: texture("generic_asteroid", "diffuse"),
    normal: texture("generic_asteroid", "normal"),
    roughness: texture("generic_asteroid", "roughness"),
  },
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
  // Other moons have no map of their own: the grey Moon map, tinted by the body's display colour (CelestialMaterial).
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
