import React from 'react';
import { CelestialBody } from './CelestialBody';
import type { BodyAssetKey, BodyType } from '../../api/types';

interface VisualTestBody {
  name: string;
  bodyType: BodyType;
  color: string;
  position: [number, number, number];
  radius: number;
  assetKey?: BodyAssetKey;
}

/** Render as a child of <Canvas> to inspect every material category, asset fallback, lighting and selection. */
export const CELESTIAL_VISUAL_TEST_BODIES: VisualTestBody[] = [
  { name: 'Star', bodyType: 'star', color: '#ffbd63', position: [-8, 0, 0], radius: 1.7, assetKey: 'sun' },
  { name: 'Rocky planet', bodyType: 'rocky-planet', color: '#5d9eea', position: [-4, 0, 0], radius: 1.1, assetKey: 'earth' },
  { name: 'Gas giant', bodyType: 'gas-giant', color: '#d9a16e', position: [0, 0, 0], radius: 1.5, assetKey: 'jupiter' },
  { name: 'Ice giant', bodyType: 'ice-giant', color: '#64b9d6', position: [4, 0, 0], radius: 1.25, assetKey: 'neptune' },
  { name: 'Asteroid', bodyType: 'asteroid', color: '#96918a', position: [7.5, 0, 0], radius: 0.72 },
  { name: 'Unknown fallback', bodyType: 'default', color: '#c084fc', position: [0, -4, 0], radius: 0.9 },
];

interface CelestialVisualTestSceneProps {
  selectedBodyName?: string;
  onSelectBody?: (name: string) => void;
}

export const CelestialVisualTestScene: React.FC<CelestialVisualTestSceneProps> = ({ selectedBodyName, onSelectBody }) => (
  <>
    <ambientLight intensity={0.48} />
    <directionalLight position={[-5, 8, 7]} intensity={2.2} />
    {CELESTIAL_VISUAL_TEST_BODIES.map((body, index) => (
      <CelestialBody
        key={body.name}
        {...body}
        isSelected={selectedBodyName ? selectedBodyName === body.name : index === 1}
        onClick={() => onSelectBody?.(body.name)}
      />
    ))}
  </>
);
