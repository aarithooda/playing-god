import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { PLANET_TEXTURE_HEIGHT, PLANET_TEXTURE_WIDTH, planetBandPixels } from '../../sim/ringWorld';

/**
 * Pale cream gas giant: faint latitude bands from a generated map (no texture file), a darkened limb and a restrained warm
 * haze at the edge. Standard lighting does the rest (terminator and shading from the scene's key light).
 */
export function makeRingWorldPlanetMaterial(): { material: THREE.MeshStandardMaterial; texture: THREE.DataTexture } {
  const texture = new THREE.DataTexture(planetBandPixels(), PLANET_TEXTURE_WIDTH, PLANET_TEXTURE_HEIGHT, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({ map: texture, color: '#ffffff', roughness: 0.92, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      /* glsl */ `
      float limbCos = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
      outgoingLight *= mix(0.22, 1.0, pow(limbCos, 0.55));
      outgoingLight += vec3(0.95, 0.82, 0.58) * pow(1.0 - limbCos, 5.0) * 0.035 * clamp(length(outgoingLight) * 2.0, 0.0, 1.0);
      #include <opaque_fragment>`,
    );
  };
  return { material, texture };
}

/** One material per mounted ring-world planet; disposed with it. `enabled` false creates nothing. */
export function useRingWorldPlanetMaterial(enabled: boolean): THREE.MeshStandardMaterial | undefined {
  const made = useMemo(() => (enabled ? makeRingWorldPlanetMaterial() : undefined), [enabled]);
  useEffect(() => {
    if (!made) return undefined;
    return () => {
      made.material.dispose();
      made.texture.dispose();
    };
  }, [made]);
  return made?.material;
}
