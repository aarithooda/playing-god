import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { CelestialBody } from './CelestialBody';
import { StarfieldShell } from './StarfieldShell';
import { MilkyWayBackdrop } from './MilkyWayBackdrop';
import { CollisionEffectsLayer } from './CollisionEffectsLayer';
import { TrajectoryLayer } from './TrajectoryLayer';
import { ReferenceOrbitLayer } from './ReferenceOrbitLayer';
import { MainBeltLayer } from './MainBeltLayer';
import { AxesOverlay, GridOverlay } from './ViewOverlays';
import { bodyDisplayScale } from '../../sim/bodyVisibility';
import { DEFAULT_CAMERA_POSITION, solarSystemCameraPosition, solarSystemFraming, type RenderTransform, type ScenePosition } from '../../sim/renderTransform';
import { clampPlacementDepth, rayPlaneIntersection } from '../../sim/placement';
import { sceneShiftPx } from '../ui/layout';
import { framingDistanceScale, nearPlaneForDistance } from '../../sim/framing';
import {
  FOCUS_ANIMATION_S,
  focusDistanceForScreenHeight,
  smoothstep,
  stepTracking,
  type TrackingState,
} from '../../sim/focusTracking';
import type { SceneBody } from '../../sim/viewModel';
import { isRingWorldBody, ringWorldCameraOffset, RING_WORLD_PRESET_BODY_IDS, SUN_DIRECTION } from '../../sim/ringWorld';
import type { ViewControlContract } from '../../sim/viewControlContract';
import type { CollisionEffectInput, ReferenceOrbitsInput, SurfaceMarkInput, TrajectoryInput } from '../../render/contract';

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
  /** Additional initial zoom applied after fitting the available viewport. */
  overviewZoom?: number;
  /** Moves the orbit target to a body and uses a consistent body-relative view distance. */
  focus?: FocusRequest;
  /** The camera stopped following the focused body (user panned away, refit, or the body is gone). */
  onFocusRelease?: () => void;
  placementMode: boolean;
  placementRadius: { radius: number; visiblePx: number; maxGrowth: number };
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
  /** Recorded paths to draw (UI-0). Display only; they never affect framing or focus. */
  trajectories?: readonly TrajectoryInput[];
  /** Bodies that get a name tag in the scene (the selected body's planet system). */
  labeledBodyIds?: readonly string[];
  /** Collision effects at the displayed time (UI-0, Stage 9, D-053). Display only; absent or empty = the canvas is drawn as before. */
  collisionEffects?: readonly CollisionEffectInput[];
  /** Marks at body-local directions (UI-0, Stage 9, D-053). Display only. */
  surfaceMarks?: readonly SurfaceMarkInput[];
  /** Scene position of the body a new one is placed relative to (draws the placement sight line). */
  placementAnchor?: ScenePosition | null;
  /** Display-only reference orbits and main-belt sample of a Solar System preset (D-064); also selects its tilted overview. */
  referenceOrbits?: ReferenceOrbitsInput;
  /** Preset the universe was created from; "saturn-particle-rings" switches on the Ring World scene (display only). */
  presetId?: string | null;
  /** Ring World: whether the ring grains drift (the simulation is playing). */
  ringWorldAnimate?: boolean;
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

/** Name tags for the bodies the user is looking at (a selected moon system), drawn as DOM next to each body. */
const BodyLabels: React.FC<{ bodies: SceneBody[]; labeledIds: readonly string[] }> = ({ bodies, labeledIds }) => {
  if (labeledIds.length === 0) return null;
  const wanted = new Set(labeledIds);
  return (
    <>
      {bodies.filter((b) => wanted.has(b.id)).map((b) => (
        <Html key={b.id} position={b.position} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div
            data-testid={`body-label-${b.id}`}
            style={{ transform: 'translate(8px, -18px)', color: '#e6edf7', fontSize: 11, whiteSpace: 'nowrap', textShadow: '0 0 3px #000, 0 0 3px #000' }}
          >
            {b.name}
          </div>
        </Html>
      ))}
    </>
  );
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
  overviewZoom: number;
  /** Default camera offset from the origin before the sidebar framing and overview zoom are applied. */
  overviewPosition: ScenePosition;
  /** Overview framing: half-extent kept in the free area and the largest pull-back (absent: the fitted-scene defaults). */
  overviewFraming?: { extentUnits: number; maxScale: number };
  focus?: FocusRequest;
  bodies: SceneBody[];
  onFocusRelease?: () => void;
  leftInset: number;
  rightInset: number;
  /** Ring World: the opening camera frames this body (Saturn) and its rings instead of the default overview. */
  ringWorldBodyId?: string;
}> = ({ frameEpoch, overviewZoom, overviewPosition, overviewFraming, focus, bodies, onFocusRelease, leftInset, rightInset, ringWorldBodyId }) => {
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
    const ringBody = ringWorldBodyId === undefined ? undefined : bodiesRef.current.find((b) => b.id === ringWorldBodyId);
    release();
    if (ringBody) {
      const [ox, oy, oz] = ringWorldCameraOffset({ radius: ringBody.radius, fovDeg: (camera as PerspectiveCamera).fov, ...layoutRef.current });
      camera.position.set(ringBody.position[0] + ox, ringBody.position[1] + oy, ringBody.position[2] + oz);
      if (controls) {
        controls.target.set(...ringBody.position);
        controls.update();
      }
      return;
    }
    const framing = overviewFraming ? { distance: Math.hypot(...overviewPosition), ...overviewFraming } : {};
    const s = framingDistanceScale({ fovDeg: (camera as PerspectiveCamera).fov, ...layoutRef.current, ...framing }) / Math.max(1, overviewZoom);
    camera.position.set(overviewPosition[0] * s, overviewPosition[1] * s, overviewPosition[2] * s);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameEpoch, camera, controls, overviewZoom, overviewPosition, overviewFraming]);

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

  // Keep the near plane in front of the nearest body (so focusing a tiny body does not clip it away) but as far out as
  // that allows: a needlessly small near plane ruins depth precision, and a moon would flicker against its planet.
  useFrame(() => {
    let nearest = Infinity;
    for (const b of bodiesRef.current) {
      nearest = Math.min(nearest, Math.hypot(camera.position.x - b.position[0], camera.position.y - b.position[1], camera.position.z - b.position[2]));
    }
    const near = nearPlaneForDistance(nearest);
    if (camera.near !== near) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  });

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
  visiblePx: number;
  maxGrowth: number;
  onConfirm: (position: ScenePosition) => void;
  onCancel: () => void;
  onPreview?: (position: ScenePosition | null) => void;
  anchor?: ScenePosition | null;
}> = ({ active, radius, visiblePx, maxGrowth, onConfirm, onCancel, onPreview, anchor }) => {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as OrbitTarget | null;
  const raycaster = useMemo(() => new Raycaster(), []);
  const pointer = useMemo(() => new Vector2(), []);
  const direction = useMemo(() => new Vector3(), []);
  const depth = useRef(0);
  const placed = useRef(false);
  const meshGroup = useRef<Group>(null);
  const previewRef = useRef<ScenePosition | null>(null);

  // Sight line A -> preview, updated in place each frame from refs (no React renders, no allocations).
  const anchorRef = useRef<ScenePosition | null>(null);
  anchorRef.current = anchor ?? null;
  const lineObject = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    const material = new LineBasicMaterial({ color: '#e2e8f0', transparent: true, opacity: 0.55, depthWrite: false });
    const line = new Line(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 9;
    line.visible = false;
    return line;
  }, []);
  useEffect(() => () => { lineObject.geometry.dispose(); (lineObject.material as LineBasicMaterial).dispose(); }, [lineObject]);
  useFrame(() => {
    const a = anchorRef.current;
    const b = previewRef.current;
    if (!active || !a || !b) {
      lineObject.visible = false;
      return;
    }
    const attr = lineObject.geometry.getAttribute('position') as BufferAttribute;
    attr.setXYZ(0, a[0], a[1], a[2]);
    attr.setXYZ(1, b[0], b[1], b[2]);
    attr.needsUpdate = true;
    lineObject.visible = true;
  });

  // Match the body's own view-dependent display sizing so the placement ghost is the size that will be rendered after creation.
  useFrame(() => {
    const group = meshGroup.current;
    if (!active || !group || !(camera as PerspectiveCamera).isPerspectiveCamera) return;
    const distance = Math.hypot(
      camera.position.x - group.position.x,
      camera.position.y - group.position.y,
      camera.position.z - group.position.z,
    );
    group.scale.setScalar(bodyDisplayScale(radius, distance, (camera as PerspectiveCamera).fov, size.height, { minPx: visiblePx, maxGrowth }));
  });

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
    <>
    <primitive object={lineObject} />
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
    </>
  );
};

export const UniverseCanvas: React.FC<UniverseCanvasProps> = ({
  bodies,
  selectedBodyId,
  onSelectBody,
  onFocusBody,
  onClearSelection,
  frameEpoch,
  overviewZoom = 1,
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
  trajectories = [],
  labeledBodyIds = [],
  collisionEffects = [],
  surfaceMarks = [],
  placementAnchor = null,
  referenceOrbits,
  presetId = null,
  ringWorldAnimate = false,
}) => {
  const axesVisible = viewControls?.state.axesVisible ?? showAxes;
  const gridEnabled = viewControls?.state.gridEnabled ?? showGrid;
  const hasStar = bodies.some((b) => b.kind === 'star');
  const referenceSun = referenceOrbits ? bodies.find((b) => b.id === referenceOrbits.sunBodyId) : undefined;
  const solarOverview = !!referenceOrbits;
  const overviewPosition = useMemo(
    () => (solarOverview ? solarSystemCameraPosition(transform) : DEFAULT_CAMERA_POSITION),
    [solarOverview, transform],
  );
  const overviewFraming = useMemo(
    () => (solarOverview ? solarSystemFraming(transform) : undefined),
    [solarOverview, transform],
  );
  const ringWorldBody = bodies.find((b) => isRingWorldBody(presetId, b));
  const ringIntruders = React.useMemo(
    () => (ringWorldBody ? bodies.filter((b) => !RING_WORLD_PRESET_BODY_IDS.includes(b.id)).map((b) => ({ id: b.id, position: b.position, radius: b.radius })) : []),
    [bodies, ringWorldBody],
  );
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
      {ringWorldBody ? <MilkyWayBackdrop /> : <StarfieldShell />}
      {(gridEnabled || placementMode) && <GridOverlay transform={transform} />}
      {axesVisible && <AxesOverlay transform={transform} />}
      {trajectories.length > 0 && <TrajectoryLayer trajectories={trajectories} transform={transform} selectedBodyId={selectedBodyId} />}
      {collisionEffects.length > 0 && <CollisionEffectsLayer effects={collisionEffects} transform={transform} />}
      {referenceOrbits && (
        <ReferenceOrbitLayer
          input={referenceOrbits}
          bodies={bodies}
          transform={transform}
          selectedBodyId={selectedBodyId}
          labeledBodyIds={labeledBodyIds}
          leftInset={leftInset}
          rightInset={rightInset}
        />
      )}
      {referenceOrbits?.showMainBelt && referenceSun && (
        <MainBeltLayer sunPosition={referenceSun.position} transform={transform} displayTimeS={referenceOrbits.displayTimeS} />
      )}

      {ringWorldBody ? (
        // Ring World: one warm key light from a fixed direction and a very dim fill, so the limb and the terminator read.
        <>
          <ambientLight intensity={0.05} />
          <directionalLight position={[SUN_DIRECTION[0] * 100, SUN_DIRECTION[1] * 100, SUN_DIRECTION[2] * 100]} intensity={3.4} color="#fff2dc" />
        </>
      ) : (
        <ambientLight intensity={hasStar ? 0.3 : 0.6} />
      )}
      {ringWorldBody ? null : hasStar ? (
        // Planets are lit by the stars that are in the scene (no distance falloff: scene units are arbitrary).
        bodies.filter((b) => b.kind === 'star').map((b) => (
          <pointLight key={b.id} position={b.position} intensity={2.2} decay={0} />
        ))
      ) : (
        <>
          <pointLight position={[10, 10, 10]} intensity={1.2} />
          <pointLight position={[-10, -10, -10]} intensity={0.6} />
        </>
      )}

      {bodies.map((body) => (
        <CelestialBody
          key={body.id}
          position={body.position}
          radius={body.radius}
          color={body.color}
          kind={body.kind}
          name={body.name}
          bodyType={body.bodyType}
          assetKey={body.assetKey}
          visiblePx={body.visiblePx}
          maxGrowth={body.maxGrowth}
          clearance={body.clearance}
          systemPx={body.systemPx}
          orientation={body.orientation}
          snap={body.snap}
          marks={surfaceMarks.filter((m) => m.bodyId === body.id)}
          ringWorld={ringWorldBody?.id === body.id ? { animate: ringWorldAnimate, intruders: ringIntruders } : undefined}
          isSelected={selectedBodyId === body.id}
          onClick={placementMode ? undefined : () => onSelectBody(body.id)}
          onDoubleClick={placementMode ? undefined : () => onFocusBody(body.id)}
        />
      ))}

      <BodyLabels bodies={bodies} labeledIds={labeledBodyIds} />

      <PlacementCursor
        active={placementMode}
        radius={placementRadius.radius}
        visiblePx={placementRadius.visiblePx}
        maxGrowth={placementRadius.maxGrowth}
        onConfirm={onPlacementConfirm}
        onCancel={onPlacementCancel}
        onPreview={onPlacementPreview}
        anchor={placementAnchor}
      />
      <OrbitControls makeDefault enabled={!placementMode} />
      <CameraRig
        frameEpoch={frameEpoch}
        overviewZoom={overviewZoom}
        overviewPosition={overviewPosition}
        overviewFraming={overviewFraming}
        focus={focus}
        bodies={bodies}
        onFocusRelease={onFocusRelease}
        leftInset={leftInset}
        rightInset={rightInset}
        ringWorldBodyId={ringWorldBody?.id}
      />
      <ViewportInset leftInset={leftInset} rightInset={rightInset} />
    </Canvas>
  );
};
