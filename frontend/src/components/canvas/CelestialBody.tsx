import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere } from '@react-three/drei';
import { Group, PerspectiveCamera } from 'three';
import { bodyDisplayScale } from '../../sim/bodyVisibility';

interface CelestialBodyProps {
  position: [number, number, number];
  radius: number;
  color: string;
  name: string;
  isSelected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

export const CelestialBody: React.FC<CelestialBodyProps> = ({
  position,
  radius,
  color,
  name,
  isSelected = false,
  onClick,
  onDoubleClick,
}) => {
  const body = useRef<Group>(null);

  // Display-only: lift the body to a minimum on-screen size when zoomed far out (sim/bodyVisibility.ts).
  // The scaled mesh is also what pointer picking ray-casts, so clicks match what is drawn.
  useFrame(({ camera, size }) => {
    if (!body.current || !(camera as PerspectiveCamera).isPerspectiveCamera) return;
    const [x, y, z] = position;
    const distance = Math.hypot(camera.position.x - x, camera.position.y - y, camera.position.z - z);
    body.current.scale.setScalar(bodyDisplayScale(radius, distance, (camera as PerspectiveCamera).fov, size.height));
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
          <meshStandardMaterial
            color={color}
            emissive={isSelected ? color : 'black'}
            emissiveIntensity={isSelected ? 0.5 : 0}
          />
        </Sphere>
      </group>
    </group>
  );
};
