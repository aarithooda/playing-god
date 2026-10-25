import React, { useEffect } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { makeGrainGeometry, makeGrainMaterial, GRAIN_MIN_PX } from "./RingGrains";
import { makeRingWorldPlanetMaterial, useRingWorldPlanetMaterial } from "./RingWorldPlanet";
import { generateRingGrains } from "../../sim/ringWorld";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const Probe: React.FC<{ enabled: boolean; onMaterial: (m: THREE.Material | undefined) => void }> = ({ enabled, onMaterial }) => {
  const material = useRingWorldPlanetMaterial(enabled);
  useEffect(() => { onMaterial(material); }, [material, onMaterial]);
  return null;
};

describe("ring grain geometry and material", () => {
  it("is one instanced draw: a tiny rock mesh with one set of per-grain attributes per grain", () => {
    const data = generateRingGrains(1500);
    const geometry = makeGrainGeometry(data);
    expect(geometry.instanceCount).toBe(1500);
    expect(geometry.getAttribute("aOrbit").count).toBe(1500);
    expect(geometry.getAttribute("aSize").count).toBe(1500);
    expect(geometry.getAttribute("aRot").count).toBe(1500);
    expect(geometry.getAttribute("aColor").count).toBe(1500);
    const rockTriangles = (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
    expect(rockTriangles).toBeLessThanOrEqual(80);
    expect(rockTriangles * 1500).toBeLessThan(200_000);
  });

  it("renders opaque with depth testing, so grains and planet occlude each other correctly", () => {
    const material = makeGrainMaterial();
    expect(material.transparent).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.uniforms.uMinPx.value).toBe(GRAIN_MIN_PX);
    expect(material.vertexShader).toContain("aOrbit");
  });

  it("releases GPU resources when disposed", () => {
    const geometry = makeGrainGeometry(generateRingGrains(10));
    const material = makeGrainMaterial();
    const g = vi.fn();
    const m = vi.fn();
    geometry.addEventListener("dispose", g);
    material.addEventListener("dispose", m);
    geometry.dispose();
    material.dispose();
    expect(g).toHaveBeenCalledOnce();
    expect(m).toHaveBeenCalledOnce();
  });
});

describe("ring world planet material", () => {
  it("builds a cream, textured, opaque planet", () => {
    const { material, texture } = makeRingWorldPlanetMaterial();
    expect(material.map).toBe(texture);
    expect(material.transparent).toBe(false);
    expect(texture.image.width).toBeGreaterThan(0);
    texture.dispose();
    material.dispose();
  });

  it("creates nothing while disabled", () => {
    const seen: Array<THREE.Material | undefined> = [];
    render(<Probe enabled={false} onMaterial={(m) => seen.push(m)} />);
    expect(seen.every((m) => m === undefined)).toBe(true);
  });

  it("disposes its material and texture on unmount, and when switched off (preset switching leaks nothing)", () => {
    const made: THREE.Material[] = [];
    const disposeSpy = vi.spyOn(THREE.Material.prototype, "dispose");
    const texSpy = vi.spyOn(THREE.Texture.prototype, "dispose");
    const { rerender, unmount } = render(<Probe enabled onMaterial={(m) => m && made.push(m)} />);
    expect(made.length).toBeGreaterThan(0);
    rerender(<Probe enabled={false} onMaterial={(m) => m && made.push(m)} />);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(texSpy).toHaveBeenCalledTimes(1);
    rerender(<Probe enabled onMaterial={(m) => m && made.push(m)} />);
    unmount();
    expect(disposeSpy).toHaveBeenCalledTimes(2);
    expect(texSpy).toHaveBeenCalledTimes(2);
  });
});
