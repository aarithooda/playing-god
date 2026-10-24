import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Group, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { CelestialBody } from './CelestialBody';
import { StarfieldShell } from './StarfieldShell';
import { DEFAULT_CAMERA_POSITION, type ScenePosition } from '../../sim/renderTransform';
import { clampPlacementDepth, rayPlaneIntersection } from '../../sim/placement';
import { sceneShiftPx } from '../ui/layout';
import type { SceneBody } from '../../sim/viewModel';

export interface FocusRequest {
  nonce: number;
  position: ScenePosition;
  /** Displayed (scene) radius of the focused body. */
  radius: number;
}

/** A focused body's silhouette fills this fraction of the viewport height. */
const FOCUS_SCREEN_HEIGHT_FRACTION = 0.25;
const FOCUS_ANIMATION_S = 0.65;

function focusDistanceForScreenHeight(radius: number, camera: PerspectiveCamera): number {
  // A sphere's projected silhouette is r / (sqrt(d² - r²) * tan(fov / 2)) of the viewport height.
  // Solve for d so every focused body has the same apparent height, whatever its displayed radius.
  const halfFov = (camera.fov * Math.PI) / 360;
  const scaledFraction = FOCUS_SCREEN_HEIGHT_FRACTION * Math.tan(halfFov);
  return radius * Math.sqrt(1 + 1 / (scaledFraction * scaledFraction));
}

interface UniverseCanvasProps {
  bodies: SceneBody[];
  selectedBodyId?: string;
  onSelectBody: (id: string) => void;
  onFocusBody: (id: string) => void;
  /** A plain click on empty space (not a drag, not a UI click: only the canvas reports this). */
  onClearSelection: () => void;
  /** Changing this resets the camera to the default framing (the scene was refitted). */
  frameEpoch: number;
  /** Moves the orbit target to a body and uses a consistent body-relative view distance. */
  focus?: FocusRequest;
  placementMode: boolean;
  placementRadius: number;
  onPlacementConfirm: (position: ScenePosition) => void;
  onPlacementCancel: () => void;
  /** Cursor position (scene units) while placing; null when there is none. */
  onPlacementPreview?: (position: ScenePosition | null) => void;
  /** Pixels of the full-bleed canvas covered by the sidebars; the scene is centred in what remains. */
  leftInset?: number;
  rightInset?: number;
}

interface OrbitTarget {
  target: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
  update: () => void;
}

/**
 * Keeps the scene centred in the free area between the sidebars without resizing the canvas: the
 * projection centre is shifted with Three's view offset (eased). Ray casting uses the same projection,
 * so picking and placement stay exact. With no shift the view offset is cleared.
 */
const ViewportInset: React.FC<{ leftInset: number; rightInset: number }> = ({ leftInset, rightInset }) => {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const shift = useRef(sceneShiftPx(leftInset, rightInset));
  const applied = useRef('');

  useFrame((_, delta) => {
    const target = sceneShiftPx(leftInset, rightInset);
    const eased = shift.current + (target - shift.current) * (1 - Math.exp(-Math.min(delta, 0.1) * 14));
    shift.current = Math.abs(target - eased) < 0.05 ? target : eased;
    const key = `${size.width}x${size.height}@${shift.current}`;
    if (key === applied.current) return;
    applied.current = key;
    if (shift.current === 0) camera.clearViewOffset();
    else camera.setViewOffset(size.width, size.height, -shift.current, 0, size.width, size.height);
  });

  return null;
};

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
    // Every focus request frames the body to the same fraction of the viewport height, even after
    // the user has zoomed manually, so repeated focus requests cannot accumulate zoom.
    const zoom = focusDistanceForScreenHeight(focus.radius, camera as PerspectiveCamera) / distance;
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
    motion.elapsed = Math.min(motion.elapsed + delta, FOCUS_ANIMATION_S);
    const t = motion.elapsed / FOCUS_ANIMATION_S;
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

/**
 * Click-to-create placement. A translucent size-matched sphere follows the cursor on a camera-facing
 * plane (scroll changes its depth); one left click reports the exact point. Listeners are on the
 * canvas element only, so presses on panels or buttons can never place a body.
 */
const PlacementCursor: React.FC<{
  active: boolean;
  radius: number;
  onConfirm: (position: ScenePosition) => void;
  onCancel: () => void;
  onPreview?: (position: ScenePosition | null) => void;
}> = ({ active, radius, onConfirm, onCancel, onPreview }) => {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as OrbitTarget | null;
  const raycaster = useMemo(() => new Raycaster(), []);
  const pointer = useMemo(() => new Vector2(), []);
  const direction = useMemo(() => new Vector3(), []);
  const depth = useRef(0);
  const placed = useRef(false);
  const meshGroup = useRef<Group>(null);
  const previewRef = useRef<ScenePosition | null>(null);

  // Callbacks change identity on every parent render; keep the listeners stable.
  const handlers = useRef({ onConfirm, onCancel, onPreview });
  handlers.current = { onConfirm, onCancel, onPreview };

  useEffect(() => {
    const setPreview = (point: ScenePosition | null) => {
      previewRef.current = point;
      if (meshGroup.current) {
        meshGroup.current.visible = point !== null;
        if (point) meshGroup.current.position.set(...point);
      }
      handlers.current.onPreview?.(point);
    };

    if (!active) {
      depth.current = 0;
      placed.current = false;
      setPreview(null);
      return;
    }

    const canvas = gl.domElement;
    canvas.style.cursor = 'crosshair';
    const targetPoint = (): [number, number, number] =>
      controls ? [controls.target.x, controls.target.y, controls.target.z] : [0, 0, 0];
    const pointAt = (clientX: number, clientY: number): ScenePosition | null => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      camera.getWorldDirection(direction);
      const normal: [number, number, number] = [direction.x, direction.y, direction.z];
      const target = targetPoint();
      const planePoint: [number, number, number] = [
        target[0] + normal[0] * depth.current,
        target[1] + normal[1] * depth.current,
        target[2] + normal[2] * depth.current,
      ];
      const { origin, direction: rayDir } = raycaster.ray;
      return rayPlaneIntersection([origin.x, origin.y, origin.z], [rayDir.x, rayDir.y, rayDir.z], normal, planePoint);
    };
    const onMove = (event: PointerEvent) => {
      const point = pointAt(event.clientX, event.clientY);
      const previous = previewRef.current;
      if (point && previous && Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]) < 0.01) return;
      setPreview(point);
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || placed.current) return;
      const point = pointAt(event.clientX, event.clientY);
      if (!point) return;
      placed.current = true; // one click, one body: later presses are ignored until placement restarts
      event.preventDefault();
      event.stopPropagation();
      handlers.current.onConfirm(point);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const t = targetPoint();
      const targetDistance = Math.hypot(camera.position.x - t[0], camera.position.y - t[1], camera.position.z - t[2]);
      depth.current = clampPlacementDepth(depth.current, event.deltaY, targetDistance);
      const point = pointAt(event.clientX, event.clientY);
      if (point) setPreview(point);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handlers.current.onCancel();
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
  }, [active, camera, controls, direction, gl, pointer, raycaster]);

  if (!active) return null;
  return (
    <group ref={meshGroup} visible={false} renderOrder={10}>
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
  onClearSelection,
  frameEpoch,
  focus,
  placementMode,
  placementRadius,
  onPlacementConfirm,
  onPlacementCancel,
  onPlacementPreview,
  leftInset = 0,
  rightInset = 0,
}) => {
  return (
    <Canvas
      camera={{ position: DEFAULT_CAMERA_POSITION, fov: 50, far: 2000 }}
      style={{ width: '100vw', height: '100vh', background: 'black', cursor: placementMode ? 'crosshair' : 'auto' }}
      // Fires only for a click on the canvas that hit no body: R3F ignores drags (OrbitControls) and
      // events that start on panels, and it ray-casts the rendered meshes, so it agrees with the
      // enlarged minimum on-screen body size by construction.
      onPointerMissed={(event) => {
        if (event.type === 'click' && !placementMode) onClearSelection();
      }}
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
          onClick={placementMode ? undefined : () => onSelectBody(body.id)}
          onDoubleClick={placementMode ? undefined : () => onFocusBody(body.id)}
        />
      ))}

      <PlacementCursor
        active={placementMode}
        radius={placementRadius}
        onConfirm={onPlacementConfirm}
        onCancel={onPlacementCancel}
        onPreview={onPlacementPreview}
      />
      <OrbitControls makeDefault enabled={!placementMode} />
      <CameraRig frameEpoch={frameEpoch} focus={focus} />
      <ViewportInset leftInset={leftInset} rightInset={rightInset} />
    </Canvas>
  );
};
