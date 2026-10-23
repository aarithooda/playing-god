import React, { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Vector3 } from 'three';
import { CelestialBody } from './CelestialBody';
import { DEFAULT_CAMERA_POSITION, type ScenePosition } from '../../sim/renderTransform';
import type { SceneBody } from '../../sim/viewModel';

export interface FocusRequest {
  nonce: number;
  position: ScenePosition;
  radius: number;
}

interface UniverseCanvasProps {
  bodies: SceneBody[];
  selectedBodyId?: string;
  onSelectBody: (id: string) => void;
  onFocusBody: (id: string) => void;
  /** Changing this resets the camera to the default framing (the scene was refitted). */
  frameEpoch: number;
  /** Moves the orbit target to a body and gently zooms in while preserving the camera direction. */
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
  const animation = useRef<{
    elapsed: number;
    startPosition: Vector3;
    endPosition: Vector3;
    startTarget: Vector3;
    endTarget: Vector3;
  } | null>(null);

  useEffect(() => {
    camera.position.set(...DEFAULT_CAMERA_POSITION);
    animation.current = null;
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [frameEpoch, camera, controls]);

  useEffect(() => {
    if (!focus || !controls) return;
    const [x, y, z] = focus.position;
    let offsetX = camera.position.x - controls.target.x;
    let offsetY = camera.position.y - controls.target.y;
    let offsetZ = camera.position.z - controls.target.z;
    let distance = Math.hypot(offsetX, offsetY, offsetZ);
    if (distance < 1e-9) {
      [offsetX, offsetY, offsetZ] = DEFAULT_CAMERA_POSITION;
      distance = Math.hypot(offsetX, offsetY, offsetZ);
    }
    const minimumDistance = Math.max(focus.radius * 2.5, 1.5);
    const focusedDistance = distance > minimumDistance ? Math.max(distance * 0.9, minimumDistance) : distance;
    const zoom = focusedDistance / distance;
    animation.current = {
      elapsed: 0,
      startPosition: camera.position.clone(),
      endPosition: new Vector3(x + offsetX * zoom, y + offsetY * zoom, z + offsetZ * zoom),
      startTarget: new Vector3(controls.target.x, controls.target.y, controls.target.z),
      endTarget: new Vector3(x, y, z),
    };
    // Only a new focus request should move the camera, not every body movement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce, controls]);

  useFrame((_, delta) => {
    const motion = animation.current;
    if (!motion || !controls) return;
    motion.elapsed = Math.min(motion.elapsed + delta, 0.65);
    const t = motion.elapsed / 0.65;
    const eased = t * t * (3 - 2 * t);
    camera.position.lerpVectors(motion.startPosition, motion.endPosition, eased);
    controls.target.set(
      motion.startTarget.x + (motion.endTarget.x - motion.startTarget.x) * eased,
      motion.startTarget.y + (motion.endTarget.y - motion.startTarget.y) * eased,
      motion.startTarget.z + (motion.endTarget.z - motion.startTarget.z) * eased,
    );
    controls.update();
    if (t >= 1) animation.current = null;
  });

  return null;
};

export const UniverseCanvas: React.FC<UniverseCanvasProps> = ({
  bodies,
  selectedBodyId,
  onSelectBody,
  onFocusBody,
  frameEpoch,
  focus,
}) => {
  return (
    <Canvas
      camera={{ position: DEFAULT_CAMERA_POSITION, fov: 50, far: 2000 }}
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
          onDoubleClick={() => onFocusBody(body.id)}
        />
      ))}

      <OrbitControls makeDefault />
      <CameraRig frameEpoch={frameEpoch} focus={focus} />
    </Canvas>
  );
};
