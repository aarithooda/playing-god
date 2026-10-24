import React, { useMemo } from 'react';
import { Color, DoubleSide } from 'three';
import { Grid, Html } from '@react-three/drei';
import { axisSegments } from '../../sim/axes';
import { gridCell } from '../../sim/gridScale';
import type { RenderTransform } from '../../sim/renderTransform';

// Optional analysis overlays. Display only: they read the render transform and never touch simulation state.
// Kept deliberately faint so they support reading positions without competing with the bodies.

const CELL_COLOR = '#26364a';
const SECTION_COLOR = '#41638a';
/** Keep the shader grid visible across the camera far plane, with only a distant horizon fade. */
const GRID_FADE_DISTANCE = 10_000;

/** Horizontal grid on the physics x-y plane (z = 0), cells of a 1-2-5 number of metres. */
export const GridOverlay: React.FC<{ transform: RenderTransform }> = ({ transform }) => {
  const cell = gridCell(transform.metersPerUnit);
  return (
    <Grid
      infiniteGrid
      followCamera={false}
      side={DoubleSide}
      cellSize={cell.cellUnits}
      sectionSize={cell.sectionUnits}
      cellThickness={0.6}
      sectionThickness={1}
      cellColor={CELL_COLOR}
      sectionColor={SECTION_COLOR}
      fadeDistance={GRID_FADE_DISTANCE}
      fadeStrength={1.4}
      renderOrder={-1}
    />
  );
};

/** x, y, z axes through the origin, positioned through the same mapping the bodies use. */
export const AxesOverlay: React.FC<{ transform: RenderTransform }> = ({ transform }) => {
  const segments = useMemo(() => axisSegments(transform), [transform]);
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    for (const s of segments) {
      const c = new Color(s.color); // converts the sRGB hex to the linear values vertex colours are in
      positions.push(...s.from, ...s.to);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    return { positions: new Float32Array(positions), colors: new Float32Array(colors) };
  }, [segments]);

  return (
    <group>
      <lineSegments renderOrder={-1}>
        <bufferGeometry key={segments.length + ':' + transform.metersPerUnit}>
          <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[geometry.colors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent opacity={0.6} depthWrite={false} />
      </lineSegments>
      {segments.map((s) => (
        <Html
          key={s.axis}
          position={s.labelAt}
          center
          zIndexRange={[5, 0]}
          style={{ pointerEvents: 'none', userSelect: 'none', color: s.color, font: '600 12px system-ui, sans-serif' }}
        >
          {s.axis}
        </Html>
      ))}
    </group>
  );
};
