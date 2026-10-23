import React from 'react';
import { Sphere } from '@react-three/drei';

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
  return (
    <group position={position} onClick={(e) => {
      e.stopPropagation();
      onClick?.();
    }} onDoubleClick={(e) => {
      e.stopPropagation();
      onDoubleClick?.();
    }}>
      <Sphere args={[radius, 32, 32]}>
        <meshStandardMaterial
          color={color}
          emissive={isSelected ? color : 'black'}
          emissiveIntensity={isSelected ? 0.5 : 0}
        />
      </Sphere>
    </group>
  );
};
