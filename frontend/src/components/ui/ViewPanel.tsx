import React from 'react';
import { btnStyle, panelStyle } from './styles';
import { theme } from './theme';

interface ViewPanelProps {
  axes: boolean;
  grid: boolean;
  /** The grid is being shown only because a body is being placed (the user's own setting is unchanged). */
  gridShownForPlacement: boolean;
  onAxesChange: (on: boolean) => void;
  onGridChange: (on: boolean) => void;
}

const toggleStyle = (on: boolean): React.CSSProperties => ({
  ...btnStyle,
  flex: 1,
  borderColor: on ? theme.accent : theme.borderStrong,
  background: on ? '#1d3557' : theme.surfaceRaised,
});

/** Two independent view aids. Both start off. */
export const ViewPanel: React.FC<ViewPanelProps> = ({ axes, grid, gridShownForPlacement, onAxesChange, onGridChange }) => (
  <div style={panelStyle}>
    <h3 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>View</h3>
    <div style={{ display: 'flex', gap: '8px' }}>
      <button type="button" aria-pressed={axes} style={toggleStyle(axes)} onClick={() => onAxesChange(!axes)}>
        Axes
      </button>
      <button type="button" aria-pressed={grid} style={toggleStyle(grid)} onClick={() => onGridChange(!grid)}>
        Grid
      </button>
    </div>
    {gridShownForPlacement && !grid && (
      <p data-testid="grid-placement-note" style={{ margin: '8px 0 0 0', fontSize: '11px', color: theme.textMuted }}>
        The grid is shown while you place a body, then hidden again.
      </p>
    )}
  </div>
);
