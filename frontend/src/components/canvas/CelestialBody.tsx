import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Outlines, Sphere } from '@react-three/drei';
import { Group, PerspectiveCamera, DoubleSide, BackSide } from 'three';
import { bodyDisplayScale } from '../../sim/bodyVisibility';
import { useCelestialMaterial } from './CelestialMaterial';
import type { BodyKind, BodyType } from '../../api/types';

/** Selected-body silhouette: constant on-screen width (CSS px), whatever the body's size or the zoom. */
export const SELECTION_OUTLINE_PX = 1.5;
export const SELECTION_OUTLINE_COLOR = '#f2f7ff';

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
}) => {
  const body = useRef<Group>(null);
  const { assets, textures, material } = useCelestialMaterial(bodyType, assetKey, color);
  // drei's Outlines measures thickness in drawing-buffer pixels, so convert from CSS pixels.
  const dpr = useThree((s) => s.viewport.dpr);

  // Display-only: lift the body to a minimum on-screen size when zoomed far out (sim/bodyVisibility.ts).
  // The scaled mesh is also what pointer picking ray-casts, so clicks match what is drawn.
  useFrame(({ camera, size }) => {
    if (!body.current || !(camera as PerspectiveCamera).isPerspectiveCamera) return;
    const [x, y, z] = position;
    const distance = Math.hypot(camera.position.x - x, camera.position.y - y, camera.position.z - z);
    body.current.scale.setScalar(
      bodyDisplayScale(radius, distance, (camera as PerspectiveCamera).fov, size.height, { minPx: visiblePx, maxGrowth, clearance, systemPx }),
    );
  });

  return (
    <group
      position={position}
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
        <Sphere args={[radius, 32, 32]}>
          <primitive object={material} attach="material" />
          {/* Mounted only while selected, so deselecting (or selecting another body) leaves nothing behind.
              The outline is a back-face shell inside the body's scaled group: it follows the enlarged
              minimum on-screen size, is occluded by nearer bodies, and never changes the body itself. */}
          {isSelected && <Outlines thickness={SELECTION_OUTLINE_PX * dpr} color={SELECTION_OUTLINE_COLOR} />}
        </Sphere>
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
            <ringGeometry args={[radius * 1.35, radius * 2.15, 96]} />
            <meshBasicMaterial
              map={textures.rings}
              color="#ffffff"
              transparent
              opacity={0.9}
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
