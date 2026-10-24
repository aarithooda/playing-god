import React, { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { Color } from 'three';
import type { TrajectoryInput } from '../../render/contract';
import type { RenderTransform } from '../../sim/renderTransform';
import { buildTimedPolylines, smoothTimedPolyline, spatialTrailProgress } from '../../sim/trajectory';

interface TrajectoryLayerProps {
  trajectories: readonly TrajectoryInput[];
  transform: RenderTransform;
  selectedBodyId?: string;
}

const ACTIVE_WIDTH = 1.5;
const REFERENCE_WIDTH = 1.2;

/**
 * Draws recorded paths (UI-0). The active run is solid; the reference run (the other Orbit Lab run) is dashed and
 * muted. A path is split wherever its `segment` changes, so nothing is drawn across an edit, add, delete or merger.
 * Display only: it reads positions it is given and never affects the camera, the display scale or the bodies.
 */
export const TrajectoryLayer: React.FC<TrajectoryLayerProps> = ({ trajectories, transform, selectedBodyId }) => {
  const prepared = useMemo(
    () => trajectories.map((t) => {
      const lines = buildTimedPolylines(t.samples, transform)
        .map(smoothTimedPolyline)
        .filter((line) => line.points.length >= 2);
      const selected = t.bodyId === selectedBodyId;
      const base = new Color(selected ? '#f0bd70' : t.colorHex);
      return {
        t,
        selected,
        lines,
        colors: lines.map((line) => spatialTrailProgress(line.points).map((progress) => (
          [base.r, base.g, base.b, progress] as [number, number, number, number]
        ))),
      };
    }),
    [trajectories, transform, selectedBodyId],
  );
  return (
    <group name="trajectories">
      {prepared.flatMap(({ t, selected, lines, colors }) =>
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
  );
};
