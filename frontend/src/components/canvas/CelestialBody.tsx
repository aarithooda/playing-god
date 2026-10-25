import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Outlines, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { Group, PerspectiveCamera, DoubleSide, BackSide } from 'three';
import { bodyDisplayScale, fixedDisplayScaleAtDistance, OVERVIEW_DISTANCE } from '../../sim/bodyVisibility';
import { isUnitQuaternion, sceneQuaternion } from '../../sim/collision/orientation';
import type { SurfaceMarkInput } from '../../render/contract';
import { SurfaceMarks } from './SurfaceMarks';
import { useCelestialMaterial } from './CelestialMaterial';
import type { BodyKind, BodyType } from '../../api/types';

/** Selected-body silhouette: constant on-screen width (CSS px), whatever the body's size or the zoom. */
export const SELECTION_OUTLINE_PX = 1.5;
export const SELECTION_OUTLINE_COLOR = '#f2f7ff';
const MAX_MOTION_BLEND_S = 0.18;

function bodySeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  }
  return (hash >>> 0) / 0xffffffff * Math.PI * 2;
}

interface ShapeProfile {
  /** Relative principal-axis lengths; normalized to preserve the volume-equivalent radius. */
  axes: [number, number, number];
  relief: number;
}

// Known irregular moon axes use NASA-published dimensions. Other major moons stay spherical.
const IRREGULAR_MOON_SHAPES: Record<string, ShapeProfile> = {
  phobos: { axes: [27, 22, 18], relief: 0.04 },
  deimos: { axes: [15, 12, 10.4], relief: 0.035 },
  hyperion: { axes: [410, 260, 220], relief: 0.06 },
  epimetheus: { axes: [135, 108, 105], relief: 0.045 },
  pandora: { axes: [104, 82, 63], relief: 0.04 },
  // Prometheus is documented as potato-shaped; the shorter axes below are a visual approximation.
  prometheus: { axes: [148, 100, 86], relief: 0.055 },
};

// Asteroid axes are visual approximations of documented silhouettes. Names are suffix-matched so
// labels such as "Asteroid Bennu" work; unknown asteroids stay spherical until classified.
const IRREGULAR_ASTEROID_SHAPES: Record<string, ShapeProfile> = {
  bennu: { axes: [1, 0.9, 0.84], relief: 0.08 },
  ida: { axes: [1, 0.76, 0.66], relief: 0.1 },
  gaspra: { axes: [1, 0.78, 0.62], relief: 0.1 },
  itokawa: { axes: [1, 0.72, 0.62], relief: 0.12 },
  ryugu: { axes: [1, 0.9, 0.82], relief: 0.08 },
};

function shapeProfile(bodyType: BodyType, name: string): ShapeProfile | undefined {
  const normalizedName = name.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (bodyType === 'moon') {
    return Object.entries(IRREGULAR_MOON_SHAPES)
      .find(([moonName]) => normalizedName.endsWith(moonName))?.[1];
  }
  if (bodyType !== 'asteroid') return undefined;
  return Object.entries(IRREGULAR_ASTEROID_SHAPES)
    .find(([asteroidName]) => normalizedName.endsWith(asteroidName))?.[1];
}

/** Stable silhouette for bodies with a known irregular shape; all other bodies use a perfect sphere. */
function makeBodyGeometry(radius: number, profile: ShapeProfile | undefined, seedText: string): THREE.BufferGeometry {
  if (!profile) return new THREE.SphereGeometry(radius, 32, 32);

  const geometry = new THREE.IcosahedronGeometry(radius, 4);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const seed = bodySeed(seedText);
  const axisMean = Math.cbrt(profile.axes[0] * profile.axes[1] * profile.axes[2]);
  const axes = profile.axes.map((axis) => axis / axisMean) as [number, number, number];
  const direction = new THREE.Vector3();
  for (let i = 0; i < positions.count; i += 1) {
    direction.fromBufferAttribute(positions, i).normalize();
    const broadLobes = Math.sin(direction.x * 3.8 + seed)
      * Math.cos(direction.y * 4.7 - seed * 1.3)
      * Math.sin(direction.z * 4.1 + seed * 0.7);
    const smallerRidges = Math.cos(direction.x * 8.2 - direction.z * 5.4 + seed * 1.8)
      * Math.sin(direction.y * 7.1 + direction.z * 4.8 - seed);
    const radialScale = 1 + profile.relief * (broadLobes * 0.72 + smallerRidges * 0.28);
    direction.multiplyScalar(radius * radialScale);
    positions.setXYZ(i, direction.x * axes[0], direction.y * axes[1], direction.z * axes[2]);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

interface CelestialBodyProps {
  position: [number, number, number];
  radius: number;
  color: string;
  /** Stars glow; planets are lit by the scene. */
  kind?: BodyKind;
  name: string;
  bodyType?: BodyType;
  assetKey?: string;
  /** Minimum on-screen radius (CSS px) at the overview, zoom-in growth and moon-system limit: see SceneBody. */
  visiblePx?: number;
  maxGrowth?: number;
  clearance?: number;
  systemPx?: number;
  isSelected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  /** Orientation (w, x, y, z) in the simulation frame. Applied ONLY when present and a unit quaternion; otherwise the body is drawn as before. */
  orientation?: readonly [number, number, number, number];
  /** Marks at body-local directions; they turn with the body. */
  marks?: readonly SurfaceMarkInput[];
}

export const CelestialBody: React.FC<CelestialBodyProps> = ({
  position,
  radius,
  color,
  kind,
  name,
  bodyType = 'default',
  assetKey,
  visiblePx,
  maxGrowth,
  clearance,
  systemPx,
  isSelected = false,
  onClick,
  onDoubleClick,
  orientation,
  marks,
}) => {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const motion = useRef<{
    target: THREE.Vector3;
    start: THREE.Vector3;
    elapsed: number;
    duration: number;
  } | null>(null);
  const lastTargetAt = useRef(0);
  const quaternion = orientation !== undefined && isUnitQuaternion(orientation) ? sceneQuaternion(orientation) : undefined;
  const { assets, textures, material } = useCelestialMaterial(bodyType, assetKey, color);
  const profile = shapeProfile(bodyType, name);
  const geometry = useMemo(() => makeBodyGeometry(radius, profile, name), [radius, profile, name]);
  // drei's Outlines measures thickness in drawing-buffer pixels, so convert from CSS pixels.
  const dpr = useThree((s) => s.viewport.dpr);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // API snapshots arrive in discrete steps. Blend each new authoritative position over roughly
  // one update interval so orbital motion reads continuously instead of jumping every response.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const next = new THREE.Vector3(...position);
    const now = performance.now();
    if (!motion.current) {
      node.position.copy(next);
      motion.current = { target: next, start: next.clone(), elapsed: 0, duration: 0 };
    } else {
      const elapsed = lastTargetAt.current ? (now - lastTargetAt.current) / 1000 : 0.001;
      // Never animate longer than the interval between snapshots: otherwise fast updates keep
      // restarting the transition and the displayed body falls farther behind every step.
      const duration = Math.min(MAX_MOTION_BLEND_S, Math.max(0.001, elapsed));
      motion.current = {
        target: next,
        start: node.position.clone(),
        elapsed: 0,
        duration,
      };
    }
    lastTargetAt.current = now;
  }, [position[0], position[1], position[2]]);

  useFrame((_, delta) => {
    const node = root.current;
    const transition = motion.current;
    if (!node || !transition || transition.duration === 0) return;
    transition.elapsed = Math.min(transition.duration, transition.elapsed + delta);
    const progress = transition.elapsed / transition.duration;
    node.position.lerpVectors(transition.start, transition.target, progress);
    if (progress >= 1) transition.duration = 0;
  });

  // Display-only: lift the body to a minimum on-screen size when zoomed far out (sim/bodyVisibility.ts).
  // The scaled mesh is also what pointer picking ray-casts, so clicks match what is drawn.
  useFrame(({ camera, size }) => {
    if (!body.current || !(camera as PerspectiveCamera).isPerspectiveCamera) return;
    const x = root.current?.position.x ?? position[0];
    const y = root.current?.position.y ?? position[1];
    const z = root.current?.position.z ?? position[2];
    const distance = Math.hypot(camera.position.x - x, camera.position.y - y, camera.position.z - z);
    const fov = (camera as PerspectiveCamera).fov;
    let displayScale: number;
    if (kind === 'star') {
      const overviewScale = fixedDisplayScaleAtDistance(radius, OVERVIEW_DISTANCE, fov, size.height, visiblePx ?? 3);
      // Keep the visibility boost in world space only. The camera then changes the Sun's
      // projected radius just like every other body when the user zooms in or out.
      displayScale = overviewScale;
    } else {
      displayScale = bodyDisplayScale(radius, distance, fov, size.height, {
        minPx: visiblePx,
        maxGrowth,
        clearance,
        systemPx,
      });
    }
    body.current.scale.setScalar(displayScale);
  });

  return (
    <group
      ref={root}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.();
      }}
    >
      <group ref={body}>
        {/* The orientation group turns the sphere (and its marks) only; atmosphere and rings stay as they were. */}
        <group quaternion={quaternion}>
        <mesh geometry={geometry}>
          <primitive object={material} attach="material" />
          {/* Mounted only while selected, so deselecting (or selecting another body) leaves nothing behind.
              The outline is a back-face shell inside the body's scaled group: it follows the enlarged
              minimum on-screen size, is occluded by nearer bodies, and never changes the body itself. */}
          {isSelected && <Outlines thickness={SELECTION_OUTLINE_PX * dpr} color={SELECTION_OUTLINE_COLOR} />}
        </mesh>
        {marks && marks.length > 0 && <SurfaceMarks marks={marks} radius={radius} />}
        </group>
        {assets?.atmosphereColor && (
          <Sphere args={[radius * 1.045, 32, 32]} raycast={() => undefined}>
            <meshPhysicalMaterial
              color={assets.atmosphereColor}
              transparent
              opacity={assets.atmosphereOpacity ?? 0.12}
              side={BackSide}
              depthWrite={false}
              roughness={0.2}
              metalness={0}
            />
          </Sphere>
        )}
        {textures.rings && (
          <mesh rotation={[Math.PI / 2, 0, 0]} raycast={() => undefined}>
            <ringGeometry args={[
              radius * (assets?.ringInnerScale ?? 1.25),
              radius * (assets?.ringOuterScale ?? 2.35),
              128,
            ]} />
            <meshBasicMaterial
              map={textures.rings}
              color="#ffffff"
              transparent
              opacity={assets?.ringOpacity ?? 0.9}
              side={DoubleSide}
              depthWrite={false}
              alphaTest={0.04}
            />
          </mesh>
        )}
      </group>
    </group>
  );
};
