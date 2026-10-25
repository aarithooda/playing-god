import React from 'react';
import { formatDuration } from '../../sim/format';
import { MAX_SPEED_EXP, MIN_SPEED_EXP } from '../../sim/useSimulation';
import { useObservedRate } from '../../sim/useObservedRate';
import type { SizeMode } from '../../sim/renderTransform';
import type { ViewControlContract } from '../../sim/viewControlContract';
import { ConfirmButton } from './ConfirmButton';
import { Icon } from './Icon';
import { theme } from './theme';
import { ViewToolbar } from './ViewToolbar';

export interface SimulationBarProps {
  playing: boolean;
  stepping: boolean;
  /** There is something to simulate (at least one body). */
  canRun: boolean;
  /** The simulation is not loaded: every simulation action is off. */
  disabled: boolean;
  /** Confirmed backend simulation time; null until the first state arrives. */
  simulationTimeS: number | null;
  speedExp: number;
  stepSeconds: number;
  onSpeedChange: (exp: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
  /** A recorded state is on screen: stepping and resetting are off; Play returns to live first. */
  historyView?: boolean;
  onReturnToLive?: () => void;
  viewControls: ViewControlContract;
  paths?: boolean;
  onPathsChange?: (on: boolean) => void;
  pathsNote?: string;
  sizeMode?: SizeMode;
  onSizeModeChange?: (mode: SizeMode) => void;
  sound?: { on: boolean; available: boolean; toggle: () => void };
}

type ClockState = 'running' | 'paused' | 'history' | 'waiting';

const STATE_LABEL: Record<ClockState, string> = {
  running: 'Running',
  paused: 'Paused',
  history: 'Showing history',
  waiting: 'Waiting for the simulation',
};

/**
 * The instrument bar along the bottom of the workspace: everything about time on the left (run, step, the simulated
 * clock, the step size, reset), everything about looking on the right. The clock shows only confirmed backend time;
 * the measured rate is observed, never predicted from the step size.
 */
export const SimulationBar: React.FC<SimulationBarProps> = ({
  playing, stepping, canRun, disabled, simulationTimeS, speedExp, stepSeconds, onSpeedChange, onPlay, onPause, onStep,
  onReset, historyView = false, onReturnToLive, viewControls, paths, onPathsChange, pathsNote, sizeMode, onSizeModeChange, sound,
}) => {
  const rate = useObservedRate(simulationTimeS, playing && !historyView);
  const clockState: ClockState = disabled ? 'waiting' : historyView ? 'history' : playing ? 'running' : 'paused';
  const step = formatDuration(stepSeconds);
  const time = simulationTimeS === null ? '—' : formatDuration(simulationTimeS);
  const exact = simulationTimeS === null ? '' : `${simulationTimeS.toExponential(3)} s`;

  return (
    <footer className="pg-bar" aria-label="Simulation">
      <h2 className="sr-only">Simulation</h2>
      <div className="pg-bar__group">
        {playing ? (
          <button type="button" className="pg-icon-btn pg-icon-btn--primary" data-playing="true" aria-label="Pause" title="Pause (the current step finishes first)" onClick={onPause}>
            <Icon name="pause" />
          </button>
        ) : (
          <button
            type="button"
            className="pg-icon-btn pg-icon-btn--primary"
            aria-label="Play"
            title={historyView ? 'Return to live and play' : canRun ? 'Play: run backend steps back to back' : 'Add a body to run the simulation'}
            disabled={disabled || !canRun}
            onClick={onPlay}
          >
            <Icon name="play" />
          </button>
        )}
        <button
          type="button"
          className="pg-icon-btn"
          aria-label="Step Forward"
          title={historyView ? 'Return to live to step' : `Step forward once (${step})`}
          disabled={disabled || stepping || !canRun || historyView}
          aria-busy={stepping}
          onClick={onStep}
        >
          <Icon name="step" />
        </button>
      </div>

      <div className="pg-clock" data-testid="sim-clock">
        <span className="sr-only">Sim time: {simulationTimeS === null ? '—' : `${time} (${exact})`}</span>
        <span className="pg-clock__value" data-testid="sim-time" aria-hidden="true" title={exact ? `${exact} of simulated time since this universe's t = 0` : undefined}>
          {time}
        </span>
        <span className="pg-clock__meta" role="status" aria-live="polite">
          <span className="pg-status-dot" data-state={clockState} aria-hidden="true" />
          <span data-testid="sim-state">{stepping && !playing ? 'Stepping…' : STATE_LABEL[clockState]}</span>
          {historyView && onReturnToLive && (
            <button
              type="button"
              onClick={onReturnToLive}
              style={{ border: 0, background: 'transparent', color: theme.info, padding: 0, fontSize: 11, textDecoration: 'underline', textUnderlineOffset: 2 }}
            >
              Back to live
            </button>
          )}
        </span>
      </div>

      <div className="pg-speed">
        <label htmlFor="sim-speed" title="Simulated time advanced by each backend step. Play runs steps back to back.">
          <span>Step size</span>
          <strong>{step}</strong>
        </label>
        <input
          id="sim-speed"
          type="range"
          aria-label={`Sim Speed: ${step} per step`}
          min={MIN_SPEED_EXP}
          max={MAX_SPEED_EXP}
          step={0.25}
          value={speedExp}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
        />
      </div>
      <span className="pg-bar__rate" data-testid="sim-rate" title="Measured from the backend's confirmed times while playing">
        {rate === null ? '' : `≈ ${formatDuration(rate)} per second`}
      </span>

      <ConfirmButton
        label="Reset"
        ariaLabel="Reset Universe"
        confirmLabel="Confirm reset"
        title={historyView ? 'Return to live to reset' : 'Return this universe to its initial state'}
        icon={<Icon name="reset" size={16} />}
        onConfirm={onReset}
        disabled={disabled || historyView}
        style={{ background: 'transparent', borderColor: theme.border, color: theme.textMuted }}
      />

      <span className="pg-bar__spacer" />

      <ViewToolbar
        controls={viewControls}
        paths={paths}
        onPathsChange={onPathsChange}
        pathsNote={pathsNote}
        sizeMode={sizeMode}
        onSizeModeChange={onSizeModeChange}
      />
      {sound?.available && (
        <button
          type="button"
          className="pg-icon-btn"
          aria-label="Ambient sound"
          aria-pressed={sound.on}
          title={sound.on ? 'Stop the ambient sound' : 'Play a quiet ambient sound (optional)'}
          onClick={sound.toggle}
        >
          <Icon name={sound.on ? 'sound' : 'soundOff'} />
        </button>
      )}
    </footer>
  );
};
