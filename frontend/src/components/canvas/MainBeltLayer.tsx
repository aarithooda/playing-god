import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial } from 'three';
import { AU_M, simulationTimeToJd } from '../../sim/keplerOrbit';
import { loadMainBelt, type MainBeltAttributes } from '../../sim/mainBelt';
import type { RenderTransform, ScenePosition } from '../../sim/renderTransform';

// D-064: the main asteroid belt as one GPU point cloud. DISPLAY ONLY: the asteroids are not simulated. Each vertex
// carries its JPL SBDB osculating elements; the vertex shader solves Kepler's equation for the displayed simulation
// time, so the belt turns at the right rate for every asteroid without any per-frame CPU work (one uniform update).
// Points have no pointer handler: react-three-fiber never ray-casts them, so they cannot block selecting a body.

const BELT_COLOR = '#cdbfa8';

const vertexShader = /* glsl */ `
  uniform float uDays;
  uniform float uAuToUnits;
  uniform vec3 uSun;
  uniform float uPixelRatio;
  uniform float uRefDepth;
  attribute vec2 orbitAE;
  attribute vec2 orbitMN;
  attribute vec3 orbitP;
  attribute vec3 orbitQ;
  varying float vAlpha;
  varying float vTone;

  void main() {
    float a = orbitAE.x;
    float e = orbitAE.y;
    float M = mod(orbitMN.x + orbitMN.y * uDays, 6.28318530718);
    float E = M + e * sin(M);
    for (int k = 0; k < 6; k++) {
      E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    }
    vec3 r = a * (cos(E) - e) * orbitP + a * sqrt(1.0 - e * e) * sin(E) * orbitQ;  // heliocentric, au, physics frame
    vec3 scene = uSun + vec3(r.x, r.z, -r.y) * uAuToUnits;                     // the bodies' toScenePosition
    vec4 mv = modelViewMatrix * vec4(scene, 1.0);
    gl_Position = projectionMatrix * mv;
    // Grains shrink gently with distance and never below one device pixel; when they would, they fade instead,
    // so the zoomed-out belt reads as a band of dust rather than a solid ring.
    float raw = 2.1 * sqrt(uRefDepth / max(-mv.z, 1e-4));
    gl_PointSize = clamp(raw, 1.0, 2.8) * uPixelRatio;
    vAlpha = 0.72 * clamp(raw, 0.22, 1.0);
    vTone = fract(sin(float(gl_VertexID) * 12.9898) * 43758.5453);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vTone;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.15, d);
    gl_FragColor = vec4(uColor * (0.7 + 0.45 * vTone), vAlpha * soft);
  }
`;

export const MainBeltLayer: React.FC<{ sunPosition: ScenePosition; transform: RenderTransform; displayTimeS: number }> = ({
  sunPosition,
  transform,
  displayTimeS,
}) => {
  const gl = useThree((s) => s.gl);
  const [belt, setBelt] = useState<MainBeltAttributes | null>(null);
  useEffect(() => {
    let live = true;
    loadMainBelt().then((b) => { if (live) setBelt(b); }, (error) => console.warn('Main belt sample could not be loaded:', error));
    return () => { live = false; };
  }, []);

  const geometry = useMemo(() => {
    if (!belt) return null;
    const g = new BufferGeometry();
    // `position` only sizes the draw call; every real coordinate is computed in the shader.
    g.setAttribute('position', new BufferAttribute(new Float32Array(3 * belt.count), 3));
    g.setAttribute('orbitAE', new BufferAttribute(belt.ae, 2));
    g.setAttribute('orbitMN', new BufferAttribute(belt.mn, 2));
    g.setAttribute('orbitP', new BufferAttribute(belt.p, 3));
    g.setAttribute('orbitQ', new BufferAttribute(belt.q, 3));
    return g;
  }, [belt]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  const material = useMemo(() => new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uDays: { value: 0 },
      uAuToUnits: { value: 1 },
      uSun: { value: [0, 0, 0] },
      uPixelRatio: { value: 1 },
      uRefDepth: { value: 1 },
      uColor: { value: new Color(BELT_COLOR) },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  }), []);
  useEffect(() => () => material.dispose(), [material]);

  const live = useRef({ sunPosition, transform, displayTimeS });
  live.current = { sunPosition, transform, displayTimeS };

  useFrame(() => {
    if (!belt) return;
    const u = material.uniforms;
    const auToUnits = AU_M / live.current.transform.metersPerUnit;
    u.uDays!.value = simulationTimeToJd(live.current.displayTimeS) - belt.epochJd;
    u.uAuToUnits!.value = auToUnits;
    u.uSun!.value = live.current.sunPosition;
    u.uPixelRatio!.value = gl.getPixelRatio();
    // Full-size grains while the camera is within a few belt radii; smaller and fainter beyond.
    u.uRefDepth!.value = 4 * auToUnits;
  });

  if (!geometry) return null;
  return <points name="main-belt" geometry={geometry} material={material} frustumCulled={false} renderOrder={-1} />;
};
