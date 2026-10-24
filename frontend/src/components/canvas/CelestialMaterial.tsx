import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { BodyType } from "../../api/types";
import { resolveCelestialAssets, resolveTypeFallbackAssets } from "../../assets/registry";

type TextureName = "diffuse" | "normal" | "roughness" | "emissive" | "rings";
export type CelestialTextures = Partial<Record<TextureName, THREE.Texture>>;
const EMPTY_TEXTURES: CelestialTextures = Object.freeze({});
const FALLBACK_EMISSIVE_INTENSITY = 0.16;

interface LoadedTextures {
  signature: string;
  textures: CelestialTextures;
}

interface SharedTextureEntry {
  promise: Promise<THREE.Texture | undefined>;
  texture?: THREE.Texture;
  references: number;
  settled: boolean;
}

const sharedTextures = new Map<string, SharedTextureEntry>();

function acquireSharedTexture(url: string, name: TextureName) {
  const cacheKey = `${name}:${url}`;
  let entry = sharedTextures.get(cacheKey);
  if (!entry) {
    const created: SharedTextureEntry = {
      references: 0,
      settled: false,
      promise: new Promise((resolve) => {
        new THREE.TextureLoader().load(
          url,
          (texture) => {
            if (name === "diffuse" || name === "emissive" || name === "rings") texture.colorSpace = THREE.SRGBColorSpace;
            if (name === "rings") {
              texture.wrapS = THREE.ClampToEdgeWrapping;
              texture.wrapT = THREE.ClampToEdgeWrapping;
            }
            resolve(texture);
          },
          undefined,
          () => resolve(undefined),
        );
      }),
    };
    entry = created;
    sharedTextures.set(cacheKey, entry);
    const ownedEntry = entry;
    ownedEntry.promise.then((texture) => {
      ownedEntry.settled = true;
      ownedEntry.texture = texture;
      if (ownedEntry.references === 0) {
        texture?.dispose();
        if (sharedTextures.get(cacheKey) === ownedEntry) sharedTextures.delete(cacheKey);
      }
    });
  }

  entry.references += 1;
  let released = false;
  const ownedEntry = entry;
  return {
    promise: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      ownedEntry.references -= 1;
      if (ownedEntry.references === 0 && ownedEntry.settled) {
        ownedEntry.texture?.dispose();
        if (sharedTextures.get(cacheKey) === ownedEntry) sharedTextures.delete(cacheKey);
      }
    },
  };
}

async function loadTexture(
  urls: string[],
  name: TextureName,
  track: (release: () => void) => () => void,
  isCancelled: () => boolean,
): Promise<THREE.Texture | undefined> {
  for (const url of urls) {
    const shared = acquireSharedTexture(url, name);
    const release = track(shared.release);
    const texture = await shared.promise;
    if (isCancelled()) {
      release();
      return undefined;
    }
    if (texture) return texture;
    release();
  }
  return undefined;
}

/** Loads optional maps without suspense: missing/unavailable files keep the body visible via its color. */
export function useCelestialMaterial(bodyType: BodyType, assetKey: string | undefined, color: string) {
  const assets = useMemo(() => resolveCelestialAssets(assetKey, bodyType), [assetKey, bodyType]);
  const fallbackAssets = useMemo(() => resolveTypeFallbackAssets(bodyType), [bodyType]);
  const signature = useMemo(() => JSON.stringify(assets ?? {}), [assets]);
  const [loaded, setLoaded] = useState<LoadedTextures>();

  useEffect(() => {
    let cancelled = false;
    const releases = new Set<() => void>();
    const track = (releaseShared: () => void) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        releases.delete(release);
        releaseShared();
      };
      releases.add(release);
      return release;
    };
    const entries = Object.entries(assets ?? {})
      .filter(([name, value]) => ["diffuse", "normal", "roughness", "emissive", "rings"].includes(name) && typeof value === "string") as [TextureName, string][];

    Promise.all(entries.map(async ([name, url]) => {
      const fallback = fallbackAssets?.[name];
      return [name, await loadTexture(fallback && fallback !== url ? [url, fallback] : [url], name, track, () => cancelled)] as const;
    })).then((results) => {
      const textures: CelestialTextures = {};
      for (const [name, texture] of results) {
        if (texture) textures[name] = texture;
      }
      if (!cancelled) setLoaded({ signature, textures });
    });

    return () => {
      cancelled = true;
      [...releases].forEach((release) => release());
    };
  }, [assets, fallbackAssets, signature]);

  const textures = loaded?.signature === signature ? loaded.textures : EMPTY_TEXTURES;
  const material = useMemo(() => {
    const isStar = bodyType === "star";
    const isGasGiant = bodyType === "gas-giant";
    const isIceGiant = bodyType === "ice-giant";
    const hasColorMap = Boolean(textures.diffuse);

    const parameters: THREE.MeshStandardMaterialParameters = {
      color: hasColorMap ? "#ffffff" : color,
      roughness: isGasGiant || isIceGiant ? 0.72 : 0.9,
      metalness: bodyType === "asteroid" ? 0.12 : 0,
      // Keep textured bodies emissive-free so white fill cannot desaturate their map colors.
      emissive: new THREE.Color(color),
      emissiveIntensity: isStar ? 1.1 : hasColorMap ? 0 : FALLBACK_EMISSIVE_INTENSITY * 2,
    };
    if (textures.diffuse) parameters.map = textures.diffuse;
    if (textures.normal) parameters.normalMap = textures.normal;
    if (textures.roughness) parameters.roughnessMap = textures.roughness;
    if (textures.emissive) parameters.emissiveMap = textures.emissive;
    return new THREE.MeshStandardMaterial(parameters);
  }, [bodyType, color, textures]);

  useEffect(() => () => material.dispose(), [material]);

  return { assets, textures, material };
}
