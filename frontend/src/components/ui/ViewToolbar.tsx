import React from "react";
import type { ViewControlContract } from "../../sim/viewControlContract";
import { theme } from "./theme";
import { btnStyle } from "./styles";

interface ViewToolbarProps {
  controls: ViewControlContract;
  playing: boolean;
  canRun: boolean;
  disabled: boolean;
  onPlay: () => void;
  onPause: () => void;
}

/** Responsive simulation, view and camera actions. */
export const ViewToolbar: React.FC<ViewToolbarProps> = ({ controls, playing, canRun, disabled, onPlay, onPause }) => {
  const toggleStyle = (active: boolean): React.CSSProperties => ({
    ...btnStyle,
    borderColor: active ? theme.accent : theme.borderStrong,
    background: active ? "#1d3557" : theme.surfaceRaised,
  });

  return (
    <nav className="view-toolbar" aria-label="Simulation and view controls">
      <button type="button" className="view-toolbar__button" style={btnStyle} onClick={onPlay} disabled={disabled || playing || !canRun}>Play</button>
      <button type="button" className="view-toolbar__button" style={btnStyle} onClick={onPause} disabled={!playing}>Pause</button>
      <button
        type="button"
        className="view-toolbar__button"
        aria-label="Axes"
        aria-pressed={controls.state.axesVisible}
        style={toggleStyle(controls.state.axesVisible)}
        onClick={() => controls.actions.setAxesVisible(!controls.state.axesVisible)}
      >
        <span className="view-toolbar__full-label">Axes</span>
        <span className="view-toolbar__compact-label" aria-hidden="true">A</span>
      </button>
      <button
        type="button"
        className="view-toolbar__button"
        aria-label="Grid"
        aria-pressed={controls.state.gridEnabled}
        style={toggleStyle(controls.state.gridEnabled)}
        onClick={() => controls.actions.setGridVisible(!controls.state.gridEnabled)}
      >
        <span className="view-toolbar__full-label">Grid</span>
        <span className="view-toolbar__compact-label" aria-hidden="true">G</span>
      </button>
      <button
        type="button"
        className="view-toolbar__button"
        aria-label="Fit view to all bodies"
        title="Fit view to all bodies"
        style={btnStyle}
        disabled={!controls.state.canFitView}
        onClick={controls.actions.fitView}
      >
        <span className="view-toolbar__full-label">Overview</span>
        <span className="view-toolbar__compact-label" aria-hidden="true">Fit</span>
      </button>
      <button
        type="button"
        className="view-toolbar__button"
        aria-label="Focus selected body"
        title="Focus selected body"
        style={btnStyle}
        disabled={!controls.state.canFocusSelected}
        onClick={controls.actions.focusSelected}
      >
        <span className="view-toolbar__full-label">Focus</span>
        <span className="view-toolbar__compact-label" aria-hidden="true">Focus</span>
      </button>
      {controls.state.gridShownForPlacement && !controls.state.gridEnabled && (
        <span className="view-toolbar__placement-note" data-testid="grid-placement-note" role="status">Grid is temporarily on for placement</span>
      )}
    </nav>
  );
};
