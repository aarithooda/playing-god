import React, { useEffect, useMemo } from 'react';
import { AdditiveBlending, BackSide } from 'three';
import { STARFIELD_OUTER_RADIUS } from '../../sim/starfieldScale';
import { createGalaxyTexture } from './galaxyTexture';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Match the half-translation sky shell used by drei's Stars so the band stays inside the
    // camera-centred star shell as users zoom far beyond the system.
    vec4 mvPosition = modelViewMatrix * vec4(position, 0.5);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D galaxyMap;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(galaxyMap, vUv) * vec4(0.90, 0.94, 1.0, 0.78);
  }
`;

/** Original, low-contrast procedural scenery; it does not represent simulated bodies or matter. */
export const GalaxyBand: React.FC = () => {
  const texture = useMemo(() => createGalaxyTexture(), []);
  const uniforms = useMemo(() => ({ galaxyMap: { value: texture } }), [texture]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh renderOrder={-2} frustumCulled={false}>
      <sphereGeometry args={[STARFIELD_OUTER_RADIUS * 0.985, 64, 48]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={BackSide}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
};
