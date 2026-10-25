import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { Group, Mesh, PerspectiveCamera, Vector3 } from 'three';
import type { ReferenceOrbitGuide, ReferenceOrbitsInput } from '../../render/contract';
import { orbitPolyline, positionAtJd, simulationTimeToJd } from '../../sim/keplerOrbit';
import { toScenePosition, type RenderTransform, type ScenePosition } from '../../sim/renderTransform';
import type { SceneBody } from '../../sim/viewModel';
import type { Vec3 } from '../../api/types';

// D-064: display-only reference orbits of a Solar System preset. Every guide is drawn around the Sun's DISPLAYED
// position through the same toScenePosition() as the bodies, so frame, orientation and scale match the simulation by
// construction. Nothing here has a pointer handler, so react-three-fiber never ray-casts it and it cannot get in the
// way of selecting a body; labels are pointer-events: none.

const PLANET_LINE_PX = 1.1;
const OUTER_LINE_PX = 1;
const PLUTO_LINE_PX = 1.5;
/** Ellipses are sampled uniformly in eccentric anomaly; eccentric outer orbits get more points. */
const PLANET_SEGMENTS = 256;
const OUTER_SEGMENTS = 512;
/** On-screen radius (CSS px) of an outer-body marker. */
const MARKER_PX = 2.2;
/** Label boxes closer than this (CSS px) to an already shown, higher-priority label are hidden for that frame. */
const LABEL_GAP_PX = 3;
const MAX_LABELS = 32;
const SIDES = ['right', 'left'] as const;

interface LabelSlot {
  priority: number;
  anchor: React.RefObject<Group>;
  element: React.RefObject<HTMLDivElement>;
  shown: boolean;
  /** The label sits right of its anchor unless that side is taken; then it tries the left. */
  side: 'right' | 'left';
  width: number;
}

const LABEL_OFFSET: Record<LabelSlot['side'], string> = {
  right: 'translate(7px, -16px)',
  left: 'translate(calc(-100% - 7px), -16px)',
};

const labelStyle = (color: string, outer: boolean): React.CSSProperties => ({
  transform: LABEL_OFFSET.right,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  // Planet names carry a tint of their orbit colour, so a label and its path read together.
  color: outer ? (color === '#8b929c' ? '#a9b0ba' : color) : `color-mix(in srgb, ${color} 40%, #eef2f7)`,
  fontSize: outer ? 10 : 11,
  letterSpacing: outer ? 0.2 : 0.1,
  whiteSpace: 'nowrap',
  textShadow: '0 0 3px #000, 0 0 3px #000, 0 0 6px #000',
  transition: 'opacity 160ms ease-out',
  opacity: 0,
});

const OrbitLabel: React.FC<{ slot: LabelSlot; text: string; color: string; outer: boolean; testId: string }> = ({ slot, text, color, outer, testId }) => (
  <Html position={[0, 0, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
    <div ref={slot.element} data-testid={testId} data-orbit-label={outer ? 'outer' : 'planet'} style={labelStyle(color, outer)}>
      {text}
    </div>
  </Html>
);

function sceneLine(orbit: ReferenceOrbitGuide, transform: RenderTransform): ScenePosition[] {
  return orbitPolyline(orbit.elements, orbit.group === 'outer' ? OUTER_SEGMENTS : PLANET_SEGMENTS).map((p) => toScenePosition(p, transform));
}

export const ReferenceOrbitLayer: React.FC<{
  input: ReferenceOrbitsInput;
  bodies: readonly SceneBody[];
  transform: RenderTransform;
  selectedBodyId?: string;
  /** Bodies that already carry a name tag (BodyLabels); their reference label is not repeated. */
  labeledBodyIds: readonly string[];
  /** Canvas pixels covered by the sidebars: labels are not drawn under them. */
  leftInset: number;
  rightInset: number;
}> = ({ input, bodies, transform, selectedBodyId, labeledBodyIds, leftInset, rightInset }) => {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const sun = bodies.find((b) => b.id === input.sunBodyId);
  const planetOrbits = input.orbits.filter((o) => o.group === 'planet' && bodies.some((b) => b.id === o.bodyId));
  const outerOrbits = input.orbits.filter((o) => o.group === 'outer');

  const lines = useMemo(() => input.orbits.map((o) => ({ orbit: o, points: sceneLine(o, transform) })), [input.orbits, transform]);

  // Live inputs for the frame loop (no React state is written per frame).
  const timeRef = useRef(input.displayTimeS);
  timeRef.current = input.displayTimeS;
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;

  const markerGroups = useRef(new Map<string, Group>());
  const markerMeshes = useRef(new Map<string, Mesh>());
  const scratch = useMemo(() => ({ helio: { x: 0, y: 0, z: 0 } as Vec3, world: new Vector3(), ndc: new Vector3(), boxes: new Float64Array(4 * MAX_LABELS) }), []);

  // One label slot per labelled thing, ordered by priority (the Sun first).
  const slots = useMemo(() => {
    const make = (priority: number): LabelSlot => ({ priority, anchor: React.createRef<Group>(), element: React.createRef<HTMLDivElement>(), shown: false, side: 'right', width: 0 });
    const map = new Map<string, LabelSlot>();
    map.set('sun', make(-1));
    for (const o of input.orbits) map.set(o.id, make(o.priority));
    return map;
  }, [input.orbits]);
  const ordered = useMemo(() => [...slots.values()].sort((a, b) => a.priority - b.priority), [slots]);

  useLayoutEffect(() => {
    // Labels start hidden and appear once placed; a reduced-motion preference drops the fade.
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) for (const s of slots.values()) if (s.element.current) s.element.current.style.transition = 'none';
  }, [slots]);

  useFrame(() => {
    const jd = simulationTimeToJd(timeRef.current);
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    // Outer markers move along their ellipse (two-body propagation of the J2000 elements; display only).
    for (const o of outerOrbits) {
      const group = markerGroups.current.get(o.id);
      if (!group) continue;
      const p = positionAtJd(o.elements, jd, scratch.helio);
      const s = 1 / transform.metersPerUnit;
      group.position.set(p.x * s, p.z * s, -p.y * s); // toScenePosition, without allocating
      group.visible = true;
      const mesh = markerMeshes.current.get(o.id);
      if (mesh) {
        group.getWorldPosition(scratch.world);
        const distance = scratch.world.distanceTo(camera.position);
        mesh.scale.setScalar((2 * tanHalf * distance * MARKER_PX) / Math.max(1, size.height));
      }
    }
    // Planet and Sun labels sit on the simulated bodies' displayed positions.
    for (const [id, slot] of slots) {
      const bodyId = id === 'sun' ? input.sunBodyId : input.orbits.find((o) => o.id === id)?.bodyId;
      if (!bodyId || !slot.anchor.current) continue;
      const body = bodiesRef.current.find((b) => b.id === bodyId);
      if (body) slot.anchor.current.position.set(body.position[0], body.position[1], body.position[2]);
    }
    // Greedy de-cluttering: in priority order, a label is shown unless its box overlaps one already shown.
    const boxes = scratch.boxes;
    let placed = 0;
    for (const slot of ordered) {
      const el = slot.element.current;
      const anchor = slot.anchor.current;
      if (!el || !anchor) continue;
      anchor.getWorldPosition(scratch.world);
      scratch.ndc.copy(scratch.world).project(camera);
      const ax = ((scratch.ndc.x + 1) / 2) * size.width;
      const ay = ((1 - scratch.ndc.y) / 2) * size.height;
      let show = scratch.ndc.z < 1 && ax > leftInset && ax < size.width - rightInset && ay > 0 && ay < size.height;
      let side: LabelSlot['side'] = 'right';
      if (show) {
        if (slot.width === 0) slot.width = el.offsetWidth || 60;
        const y0 = ay - 16 - LABEL_GAP_PX;
        const y1 = y0 + 14 + 2 * LABEL_GAP_PX;
        show = false;
        for (const candidate of SIDES) {
          const x0 = candidate === 'right' ? ax + 7 - LABEL_GAP_PX : ax - 7 - slot.width - LABEL_GAP_PX;
          const x1 = x0 + slot.width + 2 * LABEL_GAP_PX;
          if (x0 < leftInset || x1 > size.width - rightInset) continue;
          let free = true;
          for (let k = 0; k < placed && free; k += 1) {
            free = !(x0 < boxes[4 * k + 2]! && x1 > boxes[4 * k]! && y0 < boxes[4 * k + 3]! && y1 > boxes[4 * k + 1]!);
          }
          if (!free) continue;
          show = true;
          side = candidate;
          if (placed < MAX_LABELS) {
            boxes[4 * placed] = x0;
            boxes[4 * placed + 1] = y0;
            boxes[4 * placed + 2] = x1;
            boxes[4 * placed + 3] = y1;
            placed += 1;
          }
          break;
        }
      }
      if (show && side !== slot.side) {
        slot.side = side;
        el.style.transform = LABEL_OFFSET[side];
      }
      if (show !== slot.shown) {
        slot.shown = show;
        el.style.opacity = show ? '1' : '0';
      }
    }
  });

  if (!sun) return null;
  const hidden = new Set(labeledBodyIds);
  const slot = (id: string) => slots.get(id)!;
  return (
    <group name="reference-orbits">
      <group position={sun.position}>
        {input.showGuides && lines.map(({ orbit, points }) => {
          if (orbit.group === 'planet' && !planetOrbits.includes(orbit)) return null;
          const selected = orbit.bodyId !== undefined && orbit.bodyId === selectedBodyId;
          return (
            <Line
              key={orbit.id}
              name={`reference-orbit-${orbit.id}`}
              points={points}
              color={orbit.color}
              lineWidth={orbit.id === 'pluto' ? PLUTO_LINE_PX : orbit.group === 'outer' ? OUTER_LINE_PX : selected ? 1.6 : PLANET_LINE_PX}
              transparent
              opacity={selected ? Math.min(1, orbit.opacity + 0.3) : orbit.opacity}
              depthWrite={false}
              renderOrder={-1}
            />
          );
        })}
        {input.showGuides && outerOrbits.map((o) => (
          <group key={o.id} visible={false} ref={(g) => { if (g) markerGroups.current.set(o.id, g); else markerGroups.current.delete(o.id); }}>
            <mesh ref={(m) => { if (m) markerMeshes.current.set(o.id, m); else markerMeshes.current.delete(o.id); }}>
              <sphereGeometry args={[1, 10, 8]} />
              <meshBasicMaterial color={o.color} transparent opacity={0.95} depthWrite={false} />
            </mesh>
            <group ref={slot(o.id).anchor}>
              <OrbitLabel slot={slot(o.id)} text={o.name} color={o.color} outer testId={`orbit-label-${o.id}`} />
            </group>
          </group>
        ))}
      </group>
      {input.showGuides && !hidden.has(input.sunBodyId) && (
        <group ref={slot('sun').anchor}>
          <OrbitLabel slot={slot('sun')} text="Sun" color="#ffcc33" outer={false} testId="orbit-label-sun" />
        </group>
      )}
      {input.showGuides && planetOrbits.filter((o) => !hidden.has(o.bodyId!)).map((o) => (
        <group key={o.id} ref={slot(o.id).anchor}>
          <OrbitLabel slot={slot(o.id)} text={o.name} color={o.color} outer={false} testId={`orbit-label-${o.id}`} />
        </group>
      ))}
    </group>
  );
};
