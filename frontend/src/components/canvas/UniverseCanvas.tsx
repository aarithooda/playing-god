import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Group, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { CelestialBody } from './CelestialBody';
import { StarfieldShell } from './StarfieldShell';
import { AxesOverlay, GridOverlay } from './ViewOverlays';
import { DEFAULT_CAMERA_POSITION, type RenderTransform, type ScenePosition } from '../../sim/renderTransform';
import { clampPlacementDepth, rayPlaneIntersection } from '../../sim/placement';
import { sceneShiftPx } from '../ui/layout';
import { framingDistanceScale } from '../../sim/framing';
import {
  FOCUS_ANIMATION_S,
  focusDistanceForScreenHeight,
  smoothstep,
  stepTracking,
  type TrackingState,
} from '../../sim/focusTracking';
import type { SceneBody } from '../../sim/viewModel';
import type { ViewControlContract } from '../../sim/viewControlContract';

export interface FocusRequest {
  nonce: number;
  /** The body to focus and then follow. */
  bodyId: string;
  position: ScenePosition;
  /** Displayed (scene) radius of the focused body. */
  radius: number;
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
  /** The camera stopped following the focused body (user panned away, refit, or the body is gone). */
  onFocusRelease?: () => void;
  placementMode: boolean;
  placementRadius: number;
  onPlacementConfirm: (position: ScenePosition) => void;
  onPlacementCancel: () => void;
  /** Cursor position (scene units) while placing; null when there is none. */
  onPlacementPreview?: (position: ScenePosition | null) => void;
  /** Pixels of the full-bleed canvas covered by the sidebars; the scene is centred in what remains. */
  leftInset?: number;
  rightInset?: number;
  /** Display scale, needed by the optional axes/grid overlays. */
  transform: RenderTransform;
  viewControls?: Pick<ViewControlContract, "state">;
  /** Compatibility inputs retained for existing canvas callers. */
  showAxes?: boolean;
  showGrid?: boolean;
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

/**
 * Camera framing and focus live inside the Canvas so they can reach the camera and OrbitControls.
 *
 * A focus request eases the orbit target onto the body and frames it at a fixed screen size (the same
 * view direction is kept, so there is no jump in orientation). Afterwards the body is tracked: the
 * camera and target are carried along with its displayed position, so orbit and zoom stay centred on
 * it while the simulation runs. Tracking ends if the user pans the target away, the scene is refitted
 * (frameEpoch) or the body disappears. Everything here is display-only.
 */
interface FocusSession {
  bodyId: string;
  /** Final camera offset from the body (view direction at request time, framed distance). */
  offset: Vector3;
  animation?: { elapsed: number; startPosition: Vector3; startTarget: Vector3 };
  tracking?: TrackingState;
}

const CameraRig: React.FC<{
  frameEpoch: number;
  focus?: FocusRequest;
  bodies: SceneBody[];
  onFocusRelease?: () => void;
  leftInset: number;
  rightInset: number;
}> = ({ frameEpoch, focus, bodies, onFocusRelease, leftInset, rightInset }) => {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  // Latest layout for the reset effect below, which must only run when the scene is refitted.
  const layoutRef = useRef({ width: size.width, height: size.height, leftInset, rightInset });
  layoutRef.current = { width: size.width, height: size.height, leftInset, rightInset };
  const controls = useThree((s) => s.controls) as unknown as OrbitTarget | null;
  const session = useRef<FocusSession | null>(null);
  // Latest props for the frame loop without re-running the effects below.
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;
  const releaseRef = useRef(onFocusRelease);
  releaseRef.current = onFocusRelease;

  const release = () => {
    if (!session.current) return;
    session.current = null;
    releaseRef.current?.();
  };

  useEffect(() => {
    // Pull back just enough that the fitted scene is not hidden under a sidebar (1 on normal windows).
    const s = framingDistanceScale({ fovDeg: (camera as PerspectiveCamera).fov, ...layoutRef.current });
    camera.position.set(DEFAULT_CAMERA_POSITION[0] * s, DEFAULT_CAMERA_POSITION[1] * s, DEFAULT_CAMERA_POSITION[2] * s);
    release();
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameEpoch, camera, controls]);

  useEffect(() => {
    if (!focus || !controls) return;
    let offsetX = camera.position.x - controls.target.x;
    let offsetY = camera.position.y - controls.target.y;
    let offsetZ = camera.position.z - controls.target.z;
    let distance = Math.hypot(offsetX, offsetY, offsetZ);
    if (distance < 1e-9) {
      [offsetX, offsetY, offsetZ] = DEFAULT_CAMERA_POSITION;
      distance = Math.hypot(offsetX, offsetY, offsetZ);
    }
    // Every focus request frames the body to the same fraction of the viewport height, even after the
    // user has zoomed manually, so repeated focus requests cannot accumulate zoom.
    const zoom = focusDistanceForScreenHeight(focus.radius, (camera as PerspectiveCamera).fov) / distance;
    session.current = {
      bodyId: focus.bodyId,
      offset: new Vector3(offsetX * zoom, offsetY * zoom, offsetZ * zoom),
      animation: {
        elapsed: 0,
        startPosition: camera.position.clone(),
        startTarget: new Vector3(controls.target.x, controls.target.y, controls.target.z),
      },
    };
    // Only a new focus request should (re)start a focus, not every body movement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce, controls]);

  useFrame((_, delta) => {
    const s = session.current;
    if (!s || !controls) return;
    const body = bodiesRef.current.find((b) => b.id === s.bodyId);
    if (!body) {
      release();
      return;
    }
    const [bx, by, bz] = body.position;

    if (s.animation) {
      const a = s.animation;
      a.elapsed = Math.min(a.elapsed + delta, FOCUS_ANIMATION_S);
      const t = smoothstep(a.elapsed / FOCUS_ANIMATION_S);
      // Aim at the body's live position, so a moving body is not missed.
      camera.position.set(
        a.startPosition.x + (bx + s.offset.x - a.startPosition.x) * t,
        a.startPosition.y + (by + s.offset.y - a.startPosition.y) * t,
        a.startPosition.z + (bz + s.offset.z - a.startPosition.z) * t,
      );
      controls.target.set(
        a.startTarget.x + (bx - a.startTarget.x) * t,
        a.startTarget.y + (by - a.startTarget.y) * t,
        a.startTarget.z + (bz - a.startTarget.z) * t,
      );
      controls.update();
      if (a.elapsed >= FOCUS_ANIMATION_S) {
        s.animation = undefined;
        s.tracking = { lastBodyPosition: [bx, by, bz], expectedTarget: [controls.target.x, controls.target.y, controls.target.z] };
      }
      return;
    }

    if (!s.tracking) return;
    const step = stepTracking(s.tracking, [bx, by, bz], [controls.target.x, controls.target.y, controls.target.z]);
    if (step.released) {
      release();
      return;
    }
    const [dx, dy, dz] = step.delta;
    if (dx !== 0 || dy !== 0 || dz !== 0) {
      camera.position.set(camera.position.x + dx, camera.position.y + dy, camera.position.z + dz);
      controls.target.set(controls.target.x + dx, controls.target.y + dy, controls.target.z + dz);
      controls.update();
    }
    s.tracking = { lastBodyPosition: [bx, by, bz], expectedTarget: [controls.target.x, controls.target.y, controls.target.z] };
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
  onFocusRelease,
  placementMode,
  placementRadius,
  onPlacementConfirm,
  onPlacementCancel,
  onPlacementPreview,
  leftInset = 0,
  rightInset = 0,
  transform,
  viewControls,
  showAxes = false,
  showGrid = false,
}) => {
  const axesVisible = viewControls?.state.axesVisible ?? showAxes;
  const gridEnabled = viewControls?.state.gridEnabled ?? showGrid;
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
      {(gridEnabled || placementMode) && <GridOverlay transform={transform} />}
      {axesVisible && <AxesOverlay transform={transform} />}

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
      <CameraRig
        frameEpoch={frameEpoch}
        focus={focus}
        bodies={bodies}
        onFocusRelease={onFocusRelease}
        leftInset={leftInset}
        rightInset={rightInset}
      />
      <ViewportInset leftInset={leftInset} rightInset={rightInset} />
    </Canvas>
  );
};
