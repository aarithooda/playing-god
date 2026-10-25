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
  /** Solar System presets only (D-064): display-only reference orbits and the main-belt sample. */
  guides?: SolarSystemGuides;
}

export interface SolarSystemGuides {
  orbits: boolean;
  onOrbitsChange: (on: boolean) => void;
  belt: boolean;
  onBeltChange: (on: boolean) => void;
}

const GUIDES_NOTE =
  "Display only, not simulated: J2000 Kepler orbits from JPL Horizons, and 10,000 numbered main-belt asteroids " +
  "(JPL SBDB) moved along their own two-body orbits. Pluto and the other outer bodies are labelled guides.";

const SIZE_MODE_NOTE: Record<SizeMode, string> = {
  universe: "Smaller true-scale view; a minimum screen size keeps planets and moons visible.",
  exploration: "Larger planets and moons for easier viewing; zooming in reveals more detail.",
};

/** The view half of the instrument bar: spatial aids, camera framing and the drawing scale. Display only. */
export const ViewToolbar: React.FC<ViewToolbarProps> = ({ controls, paths = false, onPathsChange, pathsNote, sizeMode = DEFAULT_SIZE_MODE, onSizeModeChange, guides }) => {
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
      {guides && (
        <div className="pg-bar__group" role="group" aria-label="Solar System guides" aria-describedby="reference-orbits-note">
          <button
            type="button"
            className="pg-icon-btn"
            aria-label="Orbit guides"
            aria-pressed={guides.orbits}
            title={`Orbit guides. ${GUIDES_NOTE}`}
            onClick={() => guides.onOrbitsChange(!guides.orbits)}
          >
            <Icon name="guides" />
          </button>
          <button
            type="button"
            className="pg-icon-btn"
            aria-label="Asteroid belt"
            aria-pressed={guides.belt}
            title={`Asteroid belt. ${GUIDES_NOTE}`}
            onClick={() => guides.onBeltChange(!guides.belt)}
          >
            <Icon name="belt" />
          </button>
          <span id="reference-orbits-note" data-testid="reference-orbits-note" className="sr-only">{GUIDES_NOTE}</span>
        </div>
      )}
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
