import React, { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { useCelestialMaterial } from "./CelestialMaterial";

const MaterialProbe: React.FC<{ onMaterial?: (material: THREE.MeshStandardMaterial) => void }> = ({ onMaterial }) => {
  const { material, textures } = useCelestialMaterial("rocky-planet", "earth", "#3b82f6");
  useEffect(() => onMaterial?.(material), [material, onMaterial]);
  return <output>{textures.diffuse ? "mapped" : `fallback:${material.color.getHexString()}`}</output>;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("celestial map loading", () => {
  it("keeps a color material when every optional map is missing", async () => {
    const loadSpy = vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation((_url, _onLoad, _progress, onError) => {
      queueMicrotask(() => onError?.(new Error("not found")));
      return new THREE.Texture();
    });

    render(<MaterialProbe />);

    expect(await screen.findByText("fallback:3b82f6")).toBeTruthy();
    expect(loadSpy).toHaveBeenCalled();
  });

  it("loads an available map once and disposes it when its body unmounts", async () => {
    const loadedTexture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
    const textureDispose = vi.spyOn(loadedTexture, "dispose");
    const loadSpy = vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation((url, onLoad, _progress, onError) => {
      queueMicrotask(() => {
        if (url.endsWith("/textures/earth_diffuse.jpg")) onLoad?.(loadedTexture);
        else onError?.(new Error("optional map not found"));
      });
      return new THREE.Texture();
    });

    const { unmount } = render(<React.StrictMode><MaterialProbe /><MaterialProbe /></React.StrictMode>);
    expect((await screen.findAllByText("mapped"))).toHaveLength(2);
    expect(loadSpy.mock.calls.filter(([url]) => url.endsWith("/textures/earth_diffuse.jpg"))).toHaveLength(1);

    unmount();
    expect(textureDispose).toHaveBeenCalledOnce();
  });

  it("disposes textures that finish loading after unmount without committing stale state", async () => {
    const pendingLoads: Array<(texture: THREE.Texture) => void> = [];
    const loadedTextures: THREE.Texture[] = [];
    vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation((_url, onLoad) => {
      if (onLoad) pendingLoads.push(onLoad as (texture: THREE.Texture) => void);
      return new THREE.Texture();
    });

    const materials: THREE.MeshStandardMaterial[] = [];
    const { unmount } = render(<MaterialProbe onMaterial={(material) => { materials.push(material); }} />);
    expect(pendingLoads.length).toBeGreaterThan(0);
    expect(materials).toHaveLength(1);
    const materialDispose = vi.spyOn(materials[0], "dispose");
    unmount();

    for (let i = 0; i < pendingLoads.length; i += 1) loadedTextures.push(new THREE.Texture());
    const disposers = loadedTextures.map((texture) => vi.spyOn(texture, "dispose"));
    await act(async () => {
      pendingLoads.forEach((onLoad, index) => onLoad(loadedTextures[index]));
    });

    expect(disposers.length).toBeGreaterThan(0);
    expect(disposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(materials).toHaveLength(1);
  });
});
