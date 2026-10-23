import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { CelestialBody } from './CelestialBody';

interface UniverseCanvasProps {
  bodies: Array<{
    id: string;
    position: [number, number, number];
    radius: number;
    color: string;
    name: string;
  }>;
  selectedBodyId?: string;
  onSelectBody: (id: string) => void;
}

export const UniverseCanvas: React.FC<UniverseCanvasProps> = ({
  bodies,
  selectedBodyId,
  onSelectBody,
}) => {
  return (
    <Canvas
      camera={{ position: [0, 50, 100], fov: 50 }}
      style={{ width: '100vw', height: '100vh', background: 'black' }}
    >
      <color attach="background" args={['#050505']} />
      <Stars radius={300} depth={60} count={20000} factor={7} saturation={0} fade speed={1} />

      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <pointLight position={[-10, -10, -10]} intensity={0.5} />

      {bodies.map((body) => (
        <CelestialBody
          key={body.id}
          position={body.position}
          radius={body.radius}
          color={body.color}
          name={body.name}
          isSelected={selectedBodyId === body.id}
          onClick={() => onSelectBody(body.id)}
        />
      ))}

      <OrbitControls makeDefault />
    </Canvas>
  );
};
