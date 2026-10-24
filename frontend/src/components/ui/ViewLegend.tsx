import React from 'react';
import { AXIS_COLORS } from '../../sim/axes';
import { formatNumber } from '../../sim/format';
import { panelStyle } from './styles';
import { theme } from './theme';

interface ViewLegendProps {
  showAxes: boolean;
  showGrid: boolean;
  cellMeters: number;
}

/** Scale reference for the visible grid and directional axis labels. */
export const ViewLegend: React.FC<ViewLegendProps> = ({ showAxes, showGrid, cellMeters }) => {
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
          Axes extend through (0, 0, 0):{' '}
          <span style={{ color: AXIS_COLORS.x }}>x</span> <span style={{ color: AXIS_COLORS.y }}>y</span>{' '}
          <span style={{ color: AXIS_COLORS.z }}>z (up)</span>
        </div>
      )}
    </div>
  );
};
