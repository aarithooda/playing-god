import React from 'react';
import { btnStyle, panelStyle } from './styles';
import { theme } from './theme';
import { DEFAULT_SIZE_MODE, type SizeMode } from '../../sim/renderTransform';

interface ViewPanelProps {
  /** Axes and grid toggles. Omit all of them when the caller shows those controls elsewhere (the view toolbar). */
  axes?: boolean;
  grid?: boolean;
  /** The grid is being shown only because a body is being placed (the user's own setting is unchanged). */
  gridShownForPlacement?: boolean;
  onAxesChange?: (on: boolean) => void;
  onGridChange?: (on: boolean) => void;
  /** Recorded paths (UI-0 trajectories). The control appears only when the caller supports it. */
  paths?: boolean;
  onPathsChange?: (on: boolean) => void;
  /** Why fewer paths are drawn than expected (for example a crowded scene). */
  pathsNote?: string;
  /** How the same simulation is drawn: Universe View or Exploration View (the default, with larger objects). */
  sizeMode?: SizeMode;
  onSizeModeChange?: (mode: SizeMode) => void;
}

const toggleStyle = (on: boolean): React.CSSProperties => ({
  ...btnStyle,
  flex: 1,
  borderColor: on ? theme.accent : theme.borderStrong,
  background: on ? '#1d3557' : theme.surfaceRaised,
});

/** Independent view aids and display preferences. */
export const ViewPanel: React.FC<ViewPanelProps> = ({ axes = false, grid = false, gridShownForPlacement = false, onAxesChange, onGridChange, paths = false, onPathsChange, pathsNote, sizeMode = DEFAULT_SIZE_MODE, onSizeModeChange }) => (


  <div style={panelStyle}>
    <h3 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>View</h3>
    {onAxesChange && onGridChange && (
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="button" aria-pressed={axes} style={toggleStyle(axes)} onClick={() => onAxesChange(!axes)}>
          Axes
        </button>
        <button type="button" aria-pressed={grid} style={toggleStyle(grid)} onClick={() => onGridChange(!grid)}>
          Grid
        </button>
      </div>
    )}
    {onPathsChange && (
      <div style={{ marginTop: onAxesChange ? '8px' : 0 }}>
        <button type="button" aria-pressed={paths} style={{ ...toggleStyle(paths), width: '100%' }} onClick={() => onPathsChange(!paths)}>
          Show paths
        </button>
        {paths && pathsNote && (
          <p style={{ margin: '6px 0 0 0', fontSize: '11px', color: theme.textMuted }}>{pathsNote}</p>
        )}
      </div>
    )}
    {onSizeModeChange && (
      <div role="group" aria-label="Rendering view" style={{ marginTop: '8px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" aria-pressed={sizeMode === 'universe'} style={toggleStyle(sizeMode === 'universe')} onClick={() => onSizeModeChange('universe')}>
            Universe View
          </button>
          <button type="button" aria-pressed={sizeMode === 'exploration'} style={toggleStyle(sizeMode === 'exploration')} onClick={() => onSizeModeChange('exploration')}>
            Exploration View
          </button>
        </div>
        <p style={{ margin: '6px 0 0 0', fontSize: '11px', color: theme.textMuted }}>
          {sizeMode === 'universe'
            ? 'Smaller true-scale view; a minimum screen size keeps planets and moons visible.'
            : 'Larger planets and moons for easier viewing; zooming in reveals more detail.'}
        </p>
      </div>
    )}
    {gridShownForPlacement && !grid && (
      <p data-testid="grid-placement-note" style={{ margin: '8px 0 0 0', fontSize: '11px', color: theme.textMuted }}>
        The grid is shown while you place a body, then hidden again.
      </p>
    )}
  </div>
);
