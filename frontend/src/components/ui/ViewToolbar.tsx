import React from "react";
import type { ViewControlContract } from "../../sim/viewControlContract";
import { DEFAULT_SIZE_MODE, type SizeMode } from "../../sim/renderTransform";
import { Icon } from "./Icon";

interface ViewToolbarProps {
  controls: ViewControlContract;
  /** Recorded paths. The toggle appears only when the caller supports it. */
  paths?: boolean;
  onPathsChange?: (on: boolean) => void;
  /** Why fewer paths are drawn than expected (for example a crowded scene). */
  pathsNote?: string;
  /** How the same simulation is drawn: Universe View (true scale) or Exploration View (larger objects). */
  sizeMode?: SizeMode;
  onSizeModeChange?: (mode: SizeMode) => void;
}

const SIZE_MODE_NOTE: Record<SizeMode, string> = {
  universe: "Smaller true-scale view; a minimum screen size keeps planets and moons visible.",
  exploration: "Larger planets and moons for easier viewing; zooming in reveals more detail.",
};

/** The view half of the instrument bar: spatial aids, camera framing and the drawing scale. Display only. */
export const ViewToolbar: React.FC<ViewToolbarProps> = ({ controls, paths = false, onPathsChange, pathsNote, sizeMode = DEFAULT_SIZE_MODE, onSizeModeChange }) => {
  const { state, actions } = controls;
  return (
    <nav className="pg-bar__group pg-bar__view" aria-label="View controls">
      {state.gridShownForPlacement && !state.gridEnabled && (
        <span className="pg-bar__note" data-testid="grid-placement-note" role="status">Grid is temporarily on for placement</span>
      )}
      <button
        type="button"
        className="pg-icon-btn"
        aria-label="Axes"
        aria-pressed={state.axesVisible}
        title="Axes through the origin (x, y, z)"
        onClick={() => actions.setAxesVisible(!state.axesVisible)}
      >
        <Icon name="axes" />
      </button>
      <button
        type="button"
        className="pg-icon-btn"
        aria-label="Grid"
        aria-pressed={state.gridEnabled}
        title="Reference grid on the z = 0 plane"
        onClick={() => actions.setGridVisible(!state.gridEnabled)}
      >
        <Icon name="grid" />
      </button>
      {onPathsChange && (
        <button
          type="button"
          className="pg-icon-btn"
          aria-label="Show paths"
          aria-pressed={paths}
          aria-describedby={paths && pathsNote ? "paths-note" : undefined}
          title={paths && pathsNote ? pathsNote : "Recorded paths (drawn from the backend's recorded history)"}
          onClick={() => onPathsChange(!paths)}
        >
          <Icon name="paths" />
        </button>
      )}
      {paths && pathsNote && <span id="paths-note" className="sr-only">{pathsNote}</span>}
      <span className="pg-divider" aria-hidden="true" />
      <button
        type="button"
        className="pg-icon-btn"
        aria-label="Fit view to all bodies"
        title="Fit view to all bodies"
        disabled={!state.canFitView}
        onClick={actions.fitView}
      >
        <Icon name="fit" />
      </button>
      <button
        type="button"
        className="pg-icon-btn"
        aria-label="Focus selected body"
        title={state.canFocusSelected ? "Focus selected body" : "Select a body to focus the camera on it"}
        disabled={!state.canFocusSelected}
        onClick={actions.focusSelected}
      >
        <Icon name="focus" />
      </button>
      {onSizeModeChange && (
        <>
          <span className="pg-divider pg-view-extra" aria-hidden="true" />
          <div className="pg-seg" role="group" aria-label="Rendering view">
            <button type="button" aria-label="Universe View" aria-pressed={sizeMode === "universe"} title={SIZE_MODE_NOTE.universe} onClick={() => onSizeModeChange("universe")}>
              Universe
            </button>
            <button type="button" aria-label="Exploration View" aria-pressed={sizeMode === "exploration"} title={SIZE_MODE_NOTE.exploration} onClick={() => onSizeModeChange("exploration")}>
              Exploration
            </button>
          </div>
        </>
      )}
    </nav>
  );
};
