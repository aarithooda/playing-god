import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
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
  /** Moves the orbit target to a body and uses a consistent body-relative view distance. */
  focus?: FocusRequest;
  placementMode: boolean;
  placementRadius: number;
  onPlacementConfirm: (position: ScenePosition) => void;
  onPlacementCancel: () => void;
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
    // Every focus request returns to this body-relative viewing distance, even after the user
    // has manually zoomed. Repeated focus taps therefore cannot keep zooming inward.
    const focusedDistance = Math.max(focus.radius * 4.5, 8);
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

const PlacementCursor: React.FC<{
  active: boolean;
  radius: number;
  onConfirm: (position: ScenePosition) => void;
  onCancel: () => void;
}> = ({ active, radius, onConfirm, onCancel }) => {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as OrbitTarget | null;
  const raycaster = useMemo(() => new Raycaster(), []);
  const pointer = useMemo(() => new Vector2(), []);
  const plane = useMemo(() => new Plane(), []);
  const normal = useMemo(() => new Vector3(), []);
  const target = useMemo(() => new Vector3(), []);
  const intersection = useMemo(() => new Vector3(), []);
  const depth = useRef(0);
  const [preview, setPreview] = useState<ScenePosition | null>(null);

  useEffect(() => {
    if (!active) {
      depth.current = 0;
      setPreview(null);
      return;
    }

    const canvas = gl.domElement;
    canvas.style.cursor = 'crosshair';
    const pointAt = (clientX: number, clientY: number): ScenePosition | null => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      camera.getWorldDirection(normal);
      if (controls) target.set(controls.target.x, controls.target.y, controls.target.z);
      else target.set(0, 0, 0);
      plane.setFromNormalAndCoplanarPoint(normal, target.clone().addScaledVector(normal, depth.current));
      const hit = raycaster.ray.intersectPlane(plane, intersection);
      return hit ? [hit.x, hit.y, hit.z] : null;
    };
    const onMove = (event: PointerEvent) => {
      const point = pointAt(event.clientX, event.clientY);
      setPreview((previous) => {
        if (!point) return previous === null ? previous : null;
        if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]) < 0.01) return previous;
        return point;
      });
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const point = pointAt(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      onConfirm(point);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const targetPoint = controls ? new Vector3(controls.target.x, controls.target.y, controls.target.z) : new Vector3();
      const targetDistance = camera.position.distanceTo(targetPoint);
      depth.current = Math.max(-targetDistance * 0.8, Math.min(targetDistance * 10, depth.current + event.deltaY * 0.01));
      const point = pointAt(event.clientX, event.clientY);
      if (point) setPreview(point);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      canvas.style.cursor = '';
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [active, camera, controls, gl, intersection, normal, onCancel, onConfirm, plane, pointer, raycaster, target]);

  if (!active || !preview) return null;
  return (
    <group position={preview} renderOrder={10}>
      <mesh>
        <sphereGeometry args={[radius, 32, 24]} />
        <meshStandardMaterial color="#cbd5e1" transparent opacity={0.38} depthWrite={false} roughness={0.5} />
      </mesh>
      <mesh scale={1.015}>
        <sphereGeometry args={[radius, 24, 16]} />
        <meshBasicMaterial color="#e2e8f0" wireframe transparent opacity={0.7} depthWrite={false} />
      </mesh>
    </group>
  );
};

export const UniverseCanvas: React.FC<UniverseCanvasProps> = ({
  bodies,
  selectedBodyId,
  onSelectBody,
  onFocusBody,
  frameEpoch,
  focus,
  placementMode,
  placementRadius,
  onPlacementConfirm,
  onPlacementCancel,
}) => {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas
        camera={{ position: DEFAULT_CAMERA_POSITION, fov: 50, far: 2000 }}
        style={{ width: '100vw', height: '100vh', background: 'black', cursor: placementMode ? 'crosshair' : 'auto' }}
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
            onClick={placementMode ? undefined : () => onSelectBody(body.id)}
            onDoubleClick={placementMode ? undefined : () => onFocusBody(body.id)}
          />
        ))}

        <PlacementCursor active={placementMode} radius={placementRadius} onConfirm={onPlacementConfirm} onCancel={onPlacementCancel} />
        <OrbitControls makeDefault enabled={!placementMode} />
        <CameraRig frameEpoch={frameEpoch} focus={focus} />
      </Canvas>
      {placementMode && (
        <div role="status" style={{
          position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          padding: '10px 16px', borderRadius: 8, color: '#eef2f7', background: 'rgba(35, 40, 48, 0.9)',
          border: '1px solid rgba(220, 230, 240, 0.35)', font: '13px sans-serif', pointerEvents: 'none',
          textAlign: 'center', whiteSpace: 'nowrap',
        }}>
          Move to preview · Scroll to adjust depth · Click to place · Esc to cancel
        </div>
      )}
    </div>
  );
};
