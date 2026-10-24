import React, { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { CatmullRomCurve3, Vector3 } from 'three';
import type { TrajectoryInput } from '../../render/contract';
import type { RenderTransform } from '../../sim/renderTransform';
import { buildPolylines } from '../../sim/trajectory';

interface TrajectoryLayerProps {
  trajectories: readonly TrajectoryInput[];
  transform: RenderTransform;
}

const ACTIVE_WIDTH = 1.5;
const REFERENCE_WIDTH = 1.2;
const CURVE_SUBDIVISIONS = 4;

/** Add render-only points between samples so orbital arcs do not look like joined straight chords. */
function smoothPolyline(points: [number, number, number][]): Vector3[] {
  if (points.length < 3) return points.map((point) => new Vector3(...point));
  const curve = new CatmullRomCurve3(
    points.map((point) => new Vector3(...point)),
    false,
    'centripetal',
  );
  return curve.getPoints((points.length - 1) * CURVE_SUBDIVISIONS);
}

/**
 * Draws recorded paths (UI-0). The active run is solid; the reference run (the other Orbit Lab run) is dashed and
 * muted. A path is split wherever its `segment` changes, so nothing is drawn across an edit, add, delete or merger.
 * Display only: it reads positions it is given and never affects the camera, the display scale or the bodies.
 */
export const TrajectoryLayer: React.FC<TrajectoryLayerProps> = ({ trajectories, transform }) => {
  const prepared = useMemo(
    () => trajectories.map((t) => ({
      t,
      lines: buildPolylines(t.samples, transform)
        .filter((line) => line.length >= 2)
        .map(smoothPolyline),
    })),
    [trajectories, transform],
  );
  return (
    <group name="trajectories">
      {prepared.flatMap(({ t, lines }) =>
        lines.map((points, i) => (
          <Line
            key={`${t.key}:${i}`}
            points={points}
            color={t.colorHex}
            lineWidth={t.role === 'active' ? ACTIVE_WIDTH : REFERENCE_WIDTH}
            dashed={t.role === 'reference'}
            dashSize={t.role === 'reference' ? 0.6 : undefined}
            gapSize={t.role === 'reference' ? 0.4 : undefined}
            transparent={t.role === 'reference'}
            opacity={t.role === 'reference' ? 0.55 : 1}
          />
        )),
      )}
    </group>
  );
};
