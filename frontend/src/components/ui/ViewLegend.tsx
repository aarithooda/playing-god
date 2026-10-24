import React from 'react';
import { AXIS_COLORS } from '../../sim/axes';
import { formatNumber } from '../../sim/format';
import { panelStyle } from './styles';
import { theme } from './theme';

interface ViewLegendProps {
  showAxes: boolean;
  showGrid: boolean;
  cellMeters: number;
  /** Physical half-length of each axis, metres. */
  axisHalfLengthM: number;
}

/** Units for whatever overlay is visible: what a grid cell and an axis length are in metres. */
export const ViewLegend: React.FC<ViewLegendProps> = ({ showAxes, showGrid, cellMeters, axisHalfLengthM }) => {
  if (!showAxes && !showGrid) return null;
  return (
    <div data-testid="view-legend" style={{ ...panelStyle, padding: '6px 10px', fontSize: 11, color: theme.textMuted, lineHeight: 1.5 }}>
      {showGrid && (
        <div>
          Grid on z = 0: <strong style={{ color: theme.text }}>{formatNumber(cellMeters)} m</strong> per cell, stronger line every 5 cells
        </div>
      )}
      {showAxes && (
        <div>
          Axes through (0, 0, 0), ±{formatNumber(axisHalfLengthM)} m:{' '}
          <span style={{ color: AXIS_COLORS.x }}>x</span> <span style={{ color: AXIS_COLORS.y }}>y</span>{' '}
          <span style={{ color: AXIS_COLORS.z }}>z (up)</span>
        </div>
      )}
    </div>
  );
};
