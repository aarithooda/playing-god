import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { Color, type Group } from 'three';
import type { TrajectoryInput } from '../../render/contract';
import { toScenePosition, type RenderTransform } from '../../sim/renderTransform';
import type { MotionBuffer } from '../../sim/motion/MotionBuffer';
import { buildShownAt, trailHead } from '../../sim/motion/trailHead';
import { buildTimedPolylines, liveTrailSamples, smoothTimedPolyline, spatialTrailOpacity, trimToLatestOrbit } from '../../sim/trajectory';

interface TrajectoryLayerProps {
  trajectories: readonly TrajectoryInput[];
  transform: RenderTransform;
  selectedBodyId?: string;
  /**
   * Live playback only. The active trails are then a recorded line (history, then the buffer's dense trail points, up to the displayed
   * segment's start as of the last React render) plus a head rebuilt every frame (`trailHead`) at the planet's frame time: it starts at the
   * recorded line's last drawn point and ends at the body's drawn position, so the trail ends exactly at the planet whatever the React lag.
   * Absent in the history view.
   */
  motion?: MotionBuffer;
}

type Prepared = { t: TrajectoryInput; selected: boolean; lines: { points: [number, number, number][] }[]; colors: [number, number, number, number][][] }[];

/** A committed build of the recorded lines, with the cut it was built with and when it was committed (Infinity until then). */
type Version = { id: number; prepared: Prepared; cutS: number | null; atMs: number };
/** Builds of the recorded lines kept mounted (the newest, and the ones a paused frame may still be showing). */
const MOUNTED_VERSIONS = 3;
/** Frames whose shown build is remembered (as many as the motion buffer remembers for a Pause, with room to spare). */
const FRAMES_REMEMBERED = 16;

/** Points the per-frame trail head is drawn with (the displayed segment is cut into this many pieces). */
export const TRAIL_HEAD_PIECES = 16;

const ACTIVE_WIDTH = 1.5;
const REFERENCE_WIDTH = 1.2;

/** The per-frame head of one body's trail: a line whose points are replaced every frame (never re-created, no React state). */
const TrailHead: React.FC<{
  bodyId: string;
  heads: React.MutableRefObject<Map<string, { setPoints: (flat: number[]) => void }>>;
  color: string;
  width: number;
}> = ({ bodyId, heads, color, width }) => {
  const line = useRef<{ geometry: { setPositions: (flat: number[]) => void } } | null>(null);
  const [initial] = useState(() => Array.from({ length: TRAIL_HEAD_PIECES + 1 }, (): [number, number, number] => [0, 0, 0]));
  React.useEffect(() => {
    heads.current.set(bodyId, { setPoints: (flat) => line.current?.geometry.setPositions(flat) });
    const map = heads.current;
    return () => { map.delete(bodyId); };
  }, [bodyId, heads]);
  return (
    <Line
      ref={line as never}
      points={initial}
      color={color}
      depthWrite={false}
      lineWidth={width}
      frustumCulled={false}
    />
  );
};

/**
 * Draws recorded paths (UI-0). The active run is solid; the reference run (the other Orbit Lab run) is dashed and
 * muted. A path is split wherever its `segment` changes, so nothing is drawn across an edit, add, delete or merger.
 * Display only: it reads positions it is given and never affects the camera, the display scale or the bodies.
 */
export const TrajectoryLayer: React.FC<TrajectoryLayerProps> = ({ trajectories, transform, selectedBodyId, motion }) => {
  const [cutS, setCutS] = useState<number | null>(null);
  const cutRef = useRef<number | null>(null);
  const heads = useRef(new Map<string, { setPoints: (flat: number[]) => void }>());
  // The recorded lines are kept as VERSIONS (one per rebuild), the last few mounted, and the frame callback picks which one is visible.
  // While playing it is the newest committed. While paused it is the one the frozen frame drew: React rebuilds the line a few times per
  // second (a new cut, new history, older points dropped), and a rebuild computed just before the press reached the screen only after it,
  // so the trail changed after Pause although the planet stood still. The choice is made per frame, not by a React render: these lines
  // live in the canvas's own React root, whose commits are not flushed with the Pause event, so a render-time choice arrived a frame late.
  const nextVersion = useRef(0);
  /** Committed versions, oldest first, with when they were committed (performance.now()). */
  const versions = useRef<Version[]>([]);
  /** The version shown while paused: never unmounted until Resume. */
  const pinned = useRef<Version | null>(null);
  /** The `heldFrameWallMs` the pinned version was chosen for. */
  const pinnedFor = useRef<number | null>(null);
  /** Which version each recent frame showed (by the frame's draw time, `drawWallMs`): a pause shows exactly what the frozen frame showed. */
  const shownByFrame = useRef<{ wallMs: number | null; version: Version }[]>([]);
  const groups = useRef(new Map<number, Group>());
  // Before every other consumer of the frame: pick the recorded line, publish the displayed segment's start (a React state, a few changes
  // per second) and move the heads.
  useFrame(() => {
    const held = motion?.heldFrameWallMs ?? null;
    const committed = versions.current;
    // Chosen once per pause and kept until Resume (the frozen frame's entry leaves `shownByFrame` after FRAMES_REMEMBERED paused frames).
    const show = held !== null && pinnedFor.current === held && pinned.current ? pinned.current : buildShownAt(committed, shownByFrame.current, held) ?? null;
    pinned.current = held === null ? null : show;
    pinnedFor.current = held;
    if (show) {
      const frames = shownByFrame.current;
      const wallMs = motion?.drawWallMs ?? null;
      if (frames[frames.length - 1]?.wallMs !== wallMs) frames.push({ wallMs, version: show });
      if (frames.length > FRAMES_REMEMBERED) frames.shift();
    }
    for (const [id, group] of groups.current) group.visible = show ? id === show.id : true;
    if (!motion) return;
    // One instant for the whole frame: the planet was drawn (priority -100) from the buffer sampled at `drawWallMs`; the head is built at that same wall time.
    const wall = motion.drawWallMs ?? performance.now();
    const ids = new Set(heads.current.keys());
    const start = motion.segmentStartS;
    if (start !== cutRef.current) {
      cutRef.current = start;
      setCutS(start);
    }
    // The head starts where the recorded line ON SCREEN ends (the cut it was built with).
    const drawnCut = show ? show.cutS : null;
    for (const [id, head] of heads.current) {
      const built = trailHead(motion, id, drawnCut, wall, TRAIL_HEAD_PIECES, ids);
      const pts = built?.points;
      if (!pts || pts.length < 2) continue;
      const flat: number[] = [];
      for (const p of pts) {
        const s = toScenePosition({ x: p[0], y: p[1], z: p[2] }, transform);
        flat.push(s[0], s[1], s[2]);
      }
      head.setPoints(flat);
    }
  }, -90);
  // Record dense trails only for the bodies whose trail is on screen (a trail costs time per piece per body at high speed).
  const wantedKey = trajectories.filter((t) => t.role === 'active').map((t) => t.bodyId).join('|');
  React.useEffect(() => {
    if (!motion) return undefined;
    motion.trail.setWanted(new Set(wantedKey ? wantedKey.split('|') : []));
    return () => motion.trail.setWanted(null);
  }, [motion, wantedKey]);
  const prepared: Prepared = useMemo(
    () => trajectories.map((t) => {
      const clipped = motion && t.role === 'active' && cutS !== null
        ? { ...t, samples: liveTrailSamples(t.samples, motion.trail.pointsFor(t.bodyId), cutS) }
        : t;
      const recordedLines = buildTimedPolylines(clipped.samples, transform);
      const lines = (t.role === 'active' ? recordedLines.map(trimToLatestOrbit) : recordedLines)
        .map(smoothTimedPolyline)
        .filter((line) => line.points.length >= 2);
      const selected = t.bodyId === selectedBodyId;
      const base = new Color(selected ? '#f0bd70' : t.colorHex);
      return {
        t,
        selected,
        lines,
        colors: lines.map((line) => spatialTrailOpacity(line.points).map((opacity) => (
          [base.r, base.g, base.b, opacity] as [number, number, number, number]
        ))),
      };
    }),
    [trajectories, transform, selectedBodyId, motion, cutS],
  );
  const current = useMemo<Version>(() => ({ id: nextVersion.current++, prepared, cutS: motion ? cutS : null, atMs: Infinity }), [prepared, cutS, motion]);
  useLayoutEffect(() => {
    const list = versions.current;
    current.atMs = performance.now();
    list.push(current);
    // Drop the oldest builds, but never the one shown while paused or one a remembered frame showed (a Pause may freeze that frame).
    const keep = new Set([pinned.current, ...shownByFrame.current.map((f) => f.version)]);
    while (list.length > MOUNTED_VERSIONS) {
      const drop = list.findIndex((v) => v !== current && !keep.has(v));
      if (drop < 0) break;
      list.splice(drop, 1);
    }
  }, [current]);
  const mounted = [...versions.current.filter((v) => v !== current), current];
  return (
    <group name="trajectories">
      {mounted.map((v) => (
        <group key={v.id} ref={(g) => { if (g) groups.current.set(v.id, g); else groups.current.delete(v.id); }} visible={v === current && !motion}>
          {v.prepared.flatMap(({ t, selected, lines, colors }) =>
            lines.map(({ points }, i) => (
              <Line
                key={`${t.key}:${i}`}
                points={points}
                color={t.role === 'active' ? '#ffffff' : (selected ? '#f0bd70' : t.colorHex)}
                vertexColors={t.role === 'active' ? colors[i] : undefined}
                // Drei spreads this prop after its RGBA-based default, so active trails must opt in explicitly.
                transparent={t.role === 'active' || t.role === 'reference'}
                depthWrite={false}
                lineWidth={t.role === 'active' ? (selected ? 1.9 : ACTIVE_WIDTH) : REFERENCE_WIDTH}
                dashed={t.role === 'reference'}
                dashSize={t.role === 'reference' ? 0.6 : undefined}
                gapSize={t.role === 'reference' ? 0.4 : undefined}
                opacity={t.role === 'reference' ? 0.48 : 1}
              />
            )),
          )}
        </group>
      ))}
      {motion && prepared.filter(({ t }) => t.role === 'active').map(({ t, selected }) => {
        return <TrailHead key={`head:${t.key}`} bodyId={t.bodyId} heads={heads} color={selected ? '#f0bd70' : t.colorHex} width={selected ? 1.9 : ACTIVE_WIDTH} />;
      })}
    </group>
  );
};
