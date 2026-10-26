import React, { useEffect, useLayoutEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RING_TILT, SUN_DIRECTION, disturbGrains, generateRingGrains, intruderCaptureRadius, type RingGrains as RingGrainData, type RingIntruder } from '../../sim/ringWorld';

/** Smallest on-screen size (CSS px, full width of a grain) a grain is lifted to, so a far view shows grains, not flicker. */
export const GRAIN_MIN_PX = 1.6;

const vertexShader = /* glsl */ `
  attribute vec4 aOrbit;   // radius, phase, angular speed, height (planet radii)
  attribute vec3 aSize;    // semi-axes (planet radii)
  attribute vec4 aRot;     // unit quaternion
  attribute vec3 aColor;   // linear albedo
  attribute float aAlive;  // 0 = swallowed or ejected by an intruder
  uniform float uUnit;     // displayed planet radius (scene units)
  uniform float uTime;
  uniform float uFocalPx;  // viewport height / (2 tan(fov/2))
  uniform float uMinPx;
  uniform mat3 uTilt;      // ring plane orientation
  varying vec3 vWorld;
  varying vec3 vLocal;     // planet-radii, planet at the origin, un-tilted ring frame
  varying vec3 vColor;

  vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }

  void main() {
    float a = aOrbit.y + aOrbit.z * uTime;
    vec3 centre = vec3(cos(a) * aOrbit.x, aOrbit.w, sin(a) * aOrbit.x);
    vec3 centreScene = uTilt * centre * uUnit;
    vec4 mvCentre = modelViewMatrix * vec4(centreScene, 1.0);
    float depth = max(-mvCentre.z, 1e-6);
    float modelScale = length(modelMatrix[0].xyz);
    float pxFull = 2.0 * max(aSize.x, max(aSize.y, aSize.z)) * uUnit * modelScale * uFocalPx / depth;
    float boost = max(1.0, uMinPx / max(pxFull, 1e-6));
    vec3 offset = uTilt * qrot(aRot, position * aSize * boost) * uUnit;
    vec3 posScene = centreScene + offset;
    vLocal = centre + qrot(aRot, position * aSize * boost);
    vWorld = (modelMatrix * vec4(posScene, 1.0)).xyz;
    vColor = aColor;
    gl_Position = aAlive < 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * modelViewMatrix * vec4(posScene, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSun;        // world-space direction towards the light
  uniform vec3 uSunLocal;   // the same direction in the un-tilted ring frame
  varying vec3 vWorld;
  varying vec3 vLocal;
  varying vec3 vColor;

  void main() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 view = normalize(cameraPosition - vWorld);
    if (dot(n, view) < 0.0) n = -n;

    // Planet shadow: does the ray from this grain towards the light pass through the unit sphere?
    float b = dot(vLocal, uSunLocal);
    float disc = b * b - (dot(vLocal, vLocal) - 1.0);
    float shadow = b < 0.0 ? smoothstep(-0.05, 0.05, disc) : 0.0;
    float lit = 1.0 - shadow;

    float diff = max(dot(n, uSun), 0.0);
    vec3 h = normalize(uSun + view);
    float spec = pow(max(dot(n, h), 0.0), 46.0);
    vec3 sunColor = vec3(1.0, 0.94, 0.82);
    vec3 col = vColor * (0.045 + 1.55 * diff * lit) * sunColor;
    col += lit * spec * 0.55 * mix(vec3(1.0), vColor * 2.4, 0.5) * sunColor;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const _tilt = new THREE.Euler(RING_TILT.x, 0, RING_TILT.z);
const _tiltMatrix4 = new THREE.Matrix4().makeRotationFromEuler(_tilt);
const _tiltMatrix3 = new THREE.Matrix3().setFromMatrix4(_tiltMatrix4);
const _tiltInverse = _tiltMatrix3.clone().transpose();
const _scale = new THREE.Vector3();
const _sunLocal = new THREE.Vector3(...SUN_DIRECTION).applyMatrix3(_tiltInverse);

/** The icosahedron is a rough, faceted rock; flat normals come from screen-space derivatives in the shader. */
export function makeGrainGeometry(data: RingGrainData): THREE.InstancedBufferGeometry {
  const base = new THREE.IcosahedronGeometry(1, 0);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute('position', base.getAttribute('position'));
  geometry.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(data.orbit, 4));
  geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(data.size, 3));
  geometry.setAttribute('aRot', new THREE.InstancedBufferAttribute(data.rotation, 4));
  geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(data.color, 3));
  geometry.setAttribute('aAlive', new THREE.InstancedBufferAttribute(new Float32Array(data.count).fill(1), 1));
  geometry.instanceCount = data.count;
  // Do not dispose `base` yet: its buffers are shared and are released with the instanced geometry.
  return geometry;
}

export function makeGrainMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uUnit: { value: 1 },
      uTime: { value: 0 },
      uFocalPx: { value: 1 },
      uMinPx: { value: GRAIN_MIN_PX },
      uTilt: { value: _tiltMatrix3 },
      uSun: { value: new THREE.Vector3(...SUN_DIRECTION) },
      uSunLocal: { value: _sunLocal },
    },
  });
}

interface RingGrainsProps {
  /** Displayed (scene) radius of the planet the grains orbit. */
  radius: number;
  /** The cosmetic drift runs only while this is true (the simulation is playing). */
  animate: boolean;
  count?: number;
  /** Bodies that are not part of the preset (scene units). Grains they touch vanish; nearby grains are flung outward. */
  intruders?: readonly RingIntruder[];
}

/**
 * VISUAL ONLY. Thousands of individually shaded grains in one instanced draw call. Not simulated bodies: no mass, no
 * physics, never picked, never reported to the backend. Rendered opaque with depth testing so grains are correctly hidden
 * by, and hide, the planet.
 */
export const RingGrains: React.FC<RingGrainsProps> = ({ radius, animate, count, intruders = [] }) => {
  const data = useMemo(() => generateRingGrains(count), [count]);
  const geometry = useMemo(() => makeGrainGeometry(data), [data]);
  const material = useMemo(() => makeGrainMaterial(), []);
  const timeRef = React.useRef(0);
  const meshRef = React.useRef<THREE.Mesh>(null);
  const intrudersRef = React.useRef(intruders);
  intrudersRef.current = intruders;
  const damaged = React.useRef(false);
  const pristine = useMemo(() => data.orbit.slice(), [data]);

  useEffect(() => () => {
    geometry.dispose();
  }, [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useLayoutEffect(() => {
    material.uniforms.uUnit.value = radius;
  }, [material, radius]);

  useFrame(({ camera, size }, delta) => {
    const dt = Math.min(delta, 0.1);
    if (animate) timeRef.current += dt;
    const mesh = meshRef.current;
    const alive = geometry.getAttribute('aAlive') as THREE.InstancedBufferAttribute;
    const orbit = geometry.getAttribute('aOrbit') as THREE.InstancedBufferAttribute;
    const list = intrudersRef.current;
    if (mesh && list.length > 0) {
      mesh.updateWorldMatrix(true, false);
      const worldScale = mesh.getWorldScale(_scale).x || 1;
      const ringPos = list.map((b) => {
        const local = mesh.worldToLocal(new THREE.Vector3(...b.position)).divideScalar(radius || 1).applyMatrix3(_tiltInverse);
        return [local.x, local.y, local.z] as const;
      });
      const capture = list.map((b) => intruderCaptureRadius(b.radius / worldScale, radius));
      if (disturbGrains(orbit.array as Float32Array, alive.array as Float32Array, timeRef.current, ringPos, capture, animate ? dt : 0)) {
        alive.needsUpdate = true;
        orbit.needsUpdate = true;
        damaged.current = true;
      }
    } else if (damaged.current) {
      // The intruder is gone (deleted or universe reset): the ring is whole again.
      (alive.array as Float32Array).fill(1);
      (orbit.array as Float32Array).set(pristine);
      alive.needsUpdate = true;
      orbit.needsUpdate = true;
      damaged.current = false;
    }
    material.uniforms.uTime.value = timeRef.current;
    const fov = (camera as THREE.PerspectiveCamera).fov;
    material.uniforms.uFocalPx.value = size.height / (2 * Math.tan((fov * Math.PI) / 360));
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} raycast={() => undefined} renderOrder={0} />;
};
