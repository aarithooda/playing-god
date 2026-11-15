import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import type { Group } from 'three';
import type { PlannedTrajectoryInput, RelativePoint, SpaceflightSceneInput, SpacecraftPathInput } from '../../render/contract';
import type { DisplayPositions } from '../../sim/motion/displayPositions';
import { toScenePosition, type RenderTransform, type ScenePosition } from '../../sim/renderTransform';
import type { SceneBody } from '../../sim/viewModel';

// Space Mission Design lines (D-070). Three things, never to be confused:
//   thin solid   the osculating orbit of a spacecraft about its reference body (the backend's elements of the present state)
//   solid        the recorded path actually flown (the backend's history), about the same body
//   dashed       a mission's PLANNED trajectory (the planner's prediction), in its own colour
// Every line is drawn relative to a body and carried with that body's displayed position each frame, so an orbit about a moving
// body reads as an orbit. Nothing here has a pointer handler: it can never get in the way of selecting a body.

/** Planned trajectories are always this colour and dashed, whatever the spacecraft's colour. */
export const PLANNED_COLOR = '#c4b5fd';
const ORBIT_WIDTH = 1;
const RECORDED_WIDTH = 1.7;
const PLANNED_WIDTH = 1.5;
/** A path longer than this many points is thinned for drawing (the recorded data is untouched). */
const MAX_DRAWN_POINTS = 4000;

function scenePoints(points: readonly RelativePoint[], transform: RenderTransform): ScenePosition[] {
  const stride = Math.max(1, Math.ceil(points.length / MAX_DRAWN_POINTS));
  const out: ScenePosition[] = [];
  for (let k = 0; k < points.length; k += stride) out.push(toScenePosition({ x: points[k]![0], y: points[k]![1], z: points[k]![2] }, transform));
  const last = points[points.length - 1];
  if (last && (points.length - 1) % stride !== 0) out.push(toScenePosition({ x: last[0], y: last[1], z: last[2] }, transform));
  return out;
}

function pathLength(points: readonly ScenePosition[]): number {
  let total = 0;
  for (let k = 1; k < points.length; k += 1) total += Math.hypot(points[k]![0] - points[k - 1]![0], points[k]![1] - points[k - 1]![1], points[k]![2] - points[k - 1]![2]);
  return total;
}

/** A group carried with a body's displayed position every frame. */
const Anchored: React.FC<{ bodyId: string; bodies: readonly SceneBody[]; displayPositions: DisplayPositions; children: React.ReactNode }> = ({ bodyId, bodies, displayPositions, children }) => {
  const group = useRef<Group>(null);
  const fallback = bodies.find((b) => b.id === bodyId)?.position;
  useFrame(() => {
    const p = displayPositions.get(bodyId) ?? fallback;
    if (p && group.current) group.current.position.set(p[0], p[1], p[2]);
  }, -45); // after the motion driver, with the bodies
  if (!fallback) return null; // the frame body is not in the scene (deleted, or a recorded frame without it)
  return <group ref={group} position={fallback}>{children}</group>;
};

/** The short piece from the last recorded point to the spacecraft's position THIS frame, so the flown path ends at the craft. */
const PathHead: React.FC<{ craftId: string; frameId: string; from: ScenePosition; color: string; bodies: readonly SceneBody[]; displayPositions: DisplayPositions }> = ({ craftId, frameId, from, color, bodies, displayPositions }) => {
  const line = useRef<{ geometry: { setPositions: (flat: number[]) => void }; visible: boolean } | null>(null);
  useFrame(() => {
    const craft = displayPositions.get(craftId) ?? bodies.find((b) => b.id === craftId)?.position;
    const frame = displayPositions.get(frameId) ?? bodies.find((b) => b.id === frameId)?.position;
    if (!line.current) return;
    if (!craft || !frame) {
      line.current.visible = false;
      return;
    }
    const to: ScenePosition = [craft[0] - frame[0], craft[1] - frame[1], craft[2] - frame[2]];
    // Too far round the body from the last recorded point: a straight piece would cut across the orbit, so none is drawn.
    const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
    const n = Math.hypot(...from) * Math.hypot(...to);
    line.current.visible = n > 0 && dot / n > 0.8;
    line.current.geometry.setPositions([from[0], from[1], from[2], to[0], to[1], to[2]]);
  }, -44);
  return <Line ref={line as never} points={[from, from]} color={color} lineWidth={RECORDED_WIDTH} depthWrite={false} transparent opacity={0.95} frustumCulled={false} />;
};

const CraftPaths: React.FC<{ craft: SpacecraftPathInput; selected: boolean; bodies: readonly SceneBody[]; transform: RenderTransform; displayPositions: DisplayPositions; live: boolean }> = ({ craft, selected, bodies, transform, displayPositions, live }) => {
  const orbit = useMemo(() => scenePoints(craft.orbit, transform), [craft.orbit, transform]);
  const recorded = useMemo(() => craft.recorded.map((piece) => scenePoints(piece, transform)).filter((piece) => piece.length >= 2), [craft.recorded, transform]);
  const lastPiece = recorded[recorded.length - 1];
  const color = selected ? '#f0bd70' : craft.colorHex;
  return (
    <Anchored bodyId={craft.frameBodyId} bodies={bodies} displayPositions={displayPositions}>
      {orbit.length >= 2 && (
        <Line points={orbit} color={color} lineWidth={selected ? 1.4 : ORBIT_WIDTH} transparent opacity={selected ? 0.75 : 0.42} depthWrite={false} />
      )}
      {recorded.map((piece, i) => (
        <Line key={i} points={piece} color={color} lineWidth={selected ? 2.1 : RECORDED_WIDTH} transparent opacity={0.95} depthWrite={false} />
      ))}
      {live && lastPiece && (
        <PathHead craftId={craft.bodyId} frameId={craft.frameBodyId} from={lastPiece[lastPiece.length - 1]!} color={color} bodies={bodies} displayPositions={displayPositions} />
      )}
    </Anchored>
  );
};

const tagStyle: React.CSSProperties = {
  transform: 'translate(9px, -8px)', color: PLANNED_COLOR, fontSize: 10.5, letterSpacing: 0.2, whiteSpace: 'nowrap',
  textShadow: '0 0 3px #000, 0 0 3px #000, 0 0 6px #000', fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

const Dashed: React.FC<{ points: ScenePosition[]; faint: boolean }> = ({ points, faint }) => {
  if (points.length < 2) return null;
  // dashes sized to the path, so a small orbit about the destination and the long transfer both read as dashed
  const dash = Math.max(pathLength(points) / 110, 1e-9);
  return (
    <Line points={points} color={PLANNED_COLOR} lineWidth={PLANNED_WIDTH} dashed dashSize={dash} gapSize={dash * 0.75}
      transparent opacity={faint ? 0.55 : 0.9} depthWrite={false} />
  );
};

const PlannedPath: React.FC<{ plan: PlannedTrajectoryInput; bodies: readonly SceneBody[]; transform: RenderTransform; displayPositions: DisplayPositions }> = ({ plan, bodies, transform, displayPositions }) => {
  const aboutOrigin = useMemo(() => scenePoints(plan.aboutOrigin, transform), [plan.aboutOrigin, transform]);
  const aboutDestination = useMemo(() => scenePoints(plan.aboutDestination, transform), [plan.aboutDestination, transform]);
  const ghost = plan.destinationAtArrival ? toScenePosition({ x: plan.destinationAtArrival[0], y: plan.destinationAtArrival[1], z: plan.destinationAtArrival[2] }, transform) : null;
  const nodes = (frameId: string) => plan.nodes.filter((n) => n.frameBodyId === frameId).map((n) => (
    <Html key={n.label} position={toScenePosition({ x: n.position[0], y: n.position[1], z: n.position[2] }, transform)} zIndexRange={[18, 0]} style={{ pointerEvents: 'none' }}>
      <div data-testid="planned-node-label" style={tagStyle}>◆ {n.label}</div>
    </Html>
  ));
  return (
    <>
      <Anchored bodyId={plan.originBodyId} bodies={bodies} displayPositions={displayPositions}>
        <Dashed points={aboutOrigin} faint={!plan.committed} />
        {ghost && (
          <Html position={ghost} zIndexRange={[18, 0]} style={{ pointerEvents: 'none' }}>
            <div data-testid="planned-arrival-label" style={{ ...tagStyle, transform: 'translate(-50%, 12px)' }}>
              <span style={{ display: 'inline-block', width: 9, height: 9, border: `1px dashed ${PLANNED_COLOR}`, borderRadius: '50%', marginRight: 5, verticalAlign: -1 }} />
              {plan.destinationName} at arrival
            </div>
          </Html>
        )}
        {nodes(plan.originBodyId)}
      </Anchored>
      <Anchored bodyId={plan.destinationBodyId} bodies={bodies} displayPositions={displayPositions}>
        <Dashed points={aboutDestination} faint={!plan.committed} />
        {nodes(plan.destinationBodyId)}
      </Anchored>
    </>
  );
};

interface SpaceflightLayerProps {
  input: SpaceflightSceneInput;
  bodies: readonly SceneBody[];
  transform: RenderTransform;
  displayPositions: DisplayPositions;
  selectedBodyId?: string;
  /** Live playback (the path head follows the craft); false while a recorded state is shown. */
  live: boolean;
}

export const SpaceflightLayer: React.FC<SpaceflightLayerProps> = ({ input, bodies, transform, displayPositions, selectedBodyId, live }) => (
  <group name="spaceflight">
    {input.plans.map((plan) => (
      <PlannedPath key={plan.key} plan={plan} bodies={bodies} transform={transform} displayPositions={displayPositions} />
    ))}
    {input.craft.map((craft) => (
      <CraftPaths key={craft.bodyId} craft={craft} selected={craft.bodyId === selectedBodyId} bodies={bodies} transform={transform}
        displayPositions={displayPositions} live={live} />
    ))}
  </group>
);
