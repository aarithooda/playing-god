import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Group, Mesh, PerspectiveCamera } from 'three';
import type { DisplayPositions } from '../../sim/motion/displayPositions';

/** On-screen half-size (CSS px) of a spacecraft marker; it never depends on the craft's few metres of real size. */
export const SPACECRAFT_MARKER_PX = 5;
const SELECTED_MARKER_PX = 6.5;
/** The invisible pick target is this many times the marker, so a 10 px glyph is not a pixel hunt. */
const PICK_SCALE = 2.4;

interface SpacecraftMarkerProps {
  bodyId: string;
  name: string;
  color: string;
  position: [number, number, number];
  displayPositions?: DisplayPositions;
  isSelected?: boolean;
  /** The engine is burning right now (backend state). */
  thrusting?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

/**
 * A spacecraft in the scene. It is deliberately NOT a sphere: a faceted diamond inside a thin ring, drawn unlit at a constant
 * size on screen, with its name beside it, so it reads as an artificial object at any zoom and can never be mistaken for a small
 * moon. Display only: the position is the simulated one (the same per-frame displayed positions as every body).
 */
export const SpacecraftMarker: React.FC<SpacecraftMarkerProps> = ({ bodyId, name, color, position, displayPositions, isSelected = false, thrusting = false, onClick, onDoubleClick }) => {
  const root = useRef<Group>(null);
  const glyph = useRef<Group>(null);
  const ring = useRef<Mesh>(null);
  const plume = useRef<Mesh>(null);

  useFrame(({ camera, size, clock }) => {
    const node = root.current;
    if (!node) return;
    const live = displayPositions?.get(bodyId) ?? position;
    node.position.set(live[0], live[1], live[2]);
    if (!glyph.current || !(camera as PerspectiveCamera).isPerspectiveCamera) return;
    const distance = Math.hypot(camera.position.x - live[0], camera.position.y - live[1], camera.position.z - live[2]);
    const halfFov = ((camera as PerspectiveCamera).fov * Math.PI) / 360;
    // scene units per CSS pixel at this distance
    const unitsPerPx = (2 * distance * Math.tan(halfFov)) / Math.max(1, size.height);
    glyph.current.scale.setScalar((isSelected ? SELECTED_MARKER_PX : SPACECRAFT_MARKER_PX) * unitsPerPx);
    glyph.current.rotation.y = clock.elapsedTime * 0.6; // a slow turn makes the facets catch the eye; purely decorative
    ring.current?.quaternion.copy(camera.quaternion); // the ring always faces the viewer
    if (plume.current) plume.current.scale.setScalar(1.6 + 0.35 * Math.sin(clock.elapsedTime * 14));
  }, -40); // after the motion driver (-100) and before the camera follows (-10)

  return (
    <group
      ref={root}
      position={position}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
    >
      <group ref={glyph}>
        <mesh>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={isSelected ? '#f2f7ff' : color} />
        </mesh>
        <mesh scale={1.06}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color="#05070c" wireframe transparent opacity={0.55} />
        </mesh>
        <mesh ref={ring} raycast={() => undefined}>
          <ringGeometry args={[1.75, 1.95, 40]} />
          <meshBasicMaterial color={isSelected ? '#f0bd70' : color} transparent opacity={isSelected ? 0.95 : 0.6} depthWrite={false} />
        </mesh>
        {thrusting && (
          <mesh ref={plume} raycast={() => undefined}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshBasicMaterial color="#ffb347" transparent opacity={0.35} depthWrite={false} />
          </mesh>
        )}
        {/* Invisible, larger pick target (ray-cast like any mesh, never drawn). */}
        <mesh scale={PICK_SCALE}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <Html position={[0, 0, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div
          data-testid={`spacecraft-label-${bodyId}`}
          style={{
            transform: 'translate(11px, -7px)', color: isSelected ? '#f6dcae' : '#cfe8ff', fontSize: 11, letterSpacing: 0.2, whiteSpace: 'nowrap',
            textShadow: '0 0 3px #000, 0 0 3px #000, 0 0 6px #000', fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          }}
        >
          {name}{thrusting ? ' · burning' : ''}
        </div>
      </Html>
    </group>
  );
};
