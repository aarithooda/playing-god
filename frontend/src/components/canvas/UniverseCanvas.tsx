import React, { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { CelestialBody } from './CelestialBody';
import { StarfieldShell } from './StarfieldShell';
import { DEFAULT_CAMERA_POSITION, type ScenePosition } from '../../sim/renderTransform';
import type { SceneBody } from '../../sim/viewModel';

export interface FocusRequest {
  nonce: number;
  position: ScenePosition;
}

interface UniverseCanvasProps {
  bodies: SceneBody[];
  selectedBodyId?: string;
  onSelectBody: (id: string) => void;
  /** Changing this resets the camera to the default framing (the scene was refitted). */
  frameEpoch: number;
  /** Moves the orbit target to a body, keeping the camera's offset from the target. */
  focus?: FocusRequest;
}

interface OrbitTarget {
  target: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
  update: () => void;
}

/** Camera framing/focus lives inside the Canvas so it can reach the camera and OrbitControls. */
const CameraRig: React.FC<{ frameEpoch: number; focus?: FocusRequest }> = ({ frameEpoch, focus }) => {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitTarget | null;

  useEffect(() => {
    camera.position.set(...DEFAULT_CAMERA_POSITION);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [frameEpoch, camera, controls]);

  useEffect(() => {
    if (!focus || !controls) return;
    const [x, y, z] = focus.position;
    camera.position.set(
      camera.position.x + x - controls.target.x,
      camera.position.y + y - controls.target.y,
      camera.position.z + z - controls.target.z,
    );
    controls.target.set(x, y, z);
    controls.update();
    // Only a new focus request should move the camera, not every body movement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  return null;
};

export const UniverseCanvas: React.FC<UniverseCanvasProps> = ({
  bodies,
  selectedBodyId,
  onSelectBody,
  frameEpoch,
  focus,
}) => {
  return (
    <Canvas
      camera={{ position: DEFAULT_CAMERA_POSITION, fov: 50, far: 2000 }}
      style={{ width: '100vw', height: '100vh', background: 'black' }}
    >
      <color attach="background" args={['#050505']} />
      <StarfieldShell />

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
      <CameraRig frameEpoch={frameEpoch} focus={focus} />
    </Canvas>
  );
};
