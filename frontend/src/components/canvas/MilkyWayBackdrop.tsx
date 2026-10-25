import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** Sky-sphere radius; it is re-centred on the camera every frame, so it is always at infinity as far as parallax goes. */
export const MILKY_WAY_RADIUS = 900;

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Procedural, deterministic sky: a tilted galactic band with fbm structure, dark dust lanes and hashed point stars at two scales.
const fragmentShader = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uBandNormal;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0)), n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
    float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1)), n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }
  // Point stars on a 3D cell grid: one candidate per cell, soft disc whose size follows the pixel footprint.
  float stars(vec3 d, float scale, float density, float sizeBase) {
    vec3 p = d * scale;
    vec3 cell = floor(p);
    vec3 f = fract(p) - 0.5;
    float h = hash13(cell);
    if (h > density) return 0.0;
    vec3 off = vec3(hash13(cell + 17.0), hash13(cell + 31.0), hash13(cell + 47.0)) - 0.5;
    float dist = length(f - off * 0.7);
    float px = length(fwidth(p)) + 1e-4;
    float r = max(sizeBase * (0.5 + hash13(cell + 5.0)), px * 0.7);
    float mag = pow(hash13(cell + 91.0), 3.0);
    return smoothstep(r, 0.0, dist) * (0.25 + 0.75 * mag) * min(1.0, sizeBase / r * 1.4 + 0.25);
  }

  void main() {
    vec3 d = normalize(vDir);
    float lat = dot(d, uBandNormal);
    float core = exp(-pow(lat / 0.20, 2.0));
    float halo = exp(-pow(lat / 0.55, 2.0));
    float clouds = fbm(d * 3.2);
    float detail = fbm(d * 9.0 + 4.0);
    float dust = smoothstep(0.42, 0.72, fbm(d * 6.0 + 20.0 + lat * 3.0));
    float bandI = core * (0.55 + 0.9 * clouds) * (1.0 - 0.62 * dust * exp(-pow(lat / 0.10, 2.0)));
    vec3 warm = vec3(0.95, 0.80, 0.62);
    vec3 cool = vec3(0.50, 0.60, 0.85);
    vec3 glow = mix(cool, warm, smoothstep(0.1, 0.75, clouds)) * (bandI * 0.13 + halo * 0.02) * (0.7 + 0.6 * detail);

    float starDensity = 0.07 + 0.55 * core + 0.12 * halo;
    float fine = stars(d, 240.0, starDensity * 0.42, 0.10) + stars(d, 95.0, starDensity * 0.2, 0.14) * 1.4;
    float bright = stars(d, 34.0, 0.12, 0.10) * 2.4;
    vec3 starTint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.88, 0.7), hash13(floor(d * 95.0)));
    vec3 col = glow + starTint * (fine * 0.8 + bright);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

// Galactic plane normal in the scene frame (an artistic tilt that crosses behind the planet's upper right).
const BAND_NORMAL = new THREE.Vector3(0.34, 0.74, -0.58).normalize();

/** Detailed Milky Way backdrop with no texture file: one draw call, no per-frame allocation. */
export const MilkyWayBackdrop: React.FC = () => {
  const mesh = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(MILKY_WAY_RADIUS, 48, 32), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { uBandNormal: { value: BAND_NORMAL } },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ camera }) => {
    mesh.current?.position.copy(camera.position);
  });
  return <mesh ref={mesh} geometry={geometry} material={material} renderOrder={-1000} frustumCulled={false} raycast={() => undefined} />;
};
