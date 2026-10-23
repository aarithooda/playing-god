import React, { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import type { Group, Points, ShaderMaterial } from 'three';
import { STARFIELD_OUTER_RADIUS, syncStarfieldToCamera } from '../../sim/starfieldScale';
import { applyStarSizeScale } from './starfieldShader';

const STAR_RADIUS = 300;
const STAR_DEPTH = STARFIELD_OUTER_RADIUS - STAR_RADIUS;

/**
 * The existing drei starfield, wrapped so that it keeps a stable apparent size when the camera is
 * zoomed far out (see sim/starfieldScale.ts). The wrapper group is scaled uniformly, so the shell
 * stays a sphere. drei's point size attenuates with distance, so the shader is told the same scale
 * to keep star size and density as on screen as they are at the reference distance.
 */
export const StarfieldShell: React.FC = () => {
  const group = useRef<Group>(null);
  const points = useRef<Points>(null);
  const sizeScale = useRef({ value: 1 });

  useLayoutEffect(() => {
    const material = points.current?.material as ShaderMaterial | undefined;
    if (!material) return;
    material.uniforms.sizeScale = sizeScale.current;
    material.onBeforeCompile = (shader) => {
      const patched = applyStarSizeScale(shader.vertexShader);
      if (!patched) {
        console.warn("StarfieldShell: drei's <Stars> shader changed; star size is not compensated for zoom.");
        return;
      }
      shader.uniforms.sizeScale = sizeScale.current;
      shader.vertexShader = patched;
    };
    material.needsUpdate = true;
  }, []);

  useFrame(({ camera }) => {
    if (!group.current) return;
    syncStarfieldToCamera({ group: group.current, camera, sizeScale: sizeScale.current });
  });

  return (
    <group ref={group}>
      <Stars ref={points} radius={STAR_RADIUS} depth={STAR_DEPTH} count={20000} factor={7} saturation={0} fade speed={1} />
    </group>
  );
};
