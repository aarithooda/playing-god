import React, { useEffect, useState } from 'react';
import type { ExperimentDto, InitialDifferencesDto, OrbitLabSystemDto, Vec3Tuple } from '../../api/types';
import { ConfirmButton } from './ConfirmButton';
import { btnStyle, errorTextStyle, panelStyle } from './styles';
import { theme } from './theme';

interface OrbitLabPanelProps {
  systems: readonly OrbitLabSystemDto[];
  /** The experiment the active universe belongs to, if any. */
  experiment: ExperimentDto | undefined;
  /** Every experiment the backend holds (so a reload does not lose them). */
  experiments: readonly ExperimentDto[];
  activeUniverseId: string;
  busy: boolean;
  error: string | null;
  /** Switching universes is blocked (a write is in flight). */
  switchDisabled: boolean;
  onStart: (systemId: string) => void;
  onCreateRun: (experimentId: string, speedFactor: number, replaceExisting: boolean) => void;
  onActivate: (universeId: string) => void;
  onDelete: (experimentId: string) => void;
  onDismissError: () => void;
  getInitialDifferences: (experimentId: string) => Promise<InitialDifferencesDto>;
}

const f2 = (x: number) => x.toFixed(2);
const vec = (v: Vec3Tuple) => `(${v.map(f2).join(', ')})`;
const speed = (v: Vec3Tuple) => Math.hypot(v[0], v[1], v[2]);
const speedText = (s: number) => `${f2(s)} m/s (${(s / 1000).toFixed(3)} km/s)`;
const factorText = (f: number) => `×${f.toFixed(2)}`;

const rowStyle: React.CSSProperties = { fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 };
const mono: React.CSSProperties = { fontFamily: theme.mono, fontSize: 11 };

/**
 * The Experiment 01 workflow (spec section 7): inspect the baseline, choose a speed factor with a preview, create the
 * modified run, verify that the velocity is the only difference, switch between the runs. It shows only what the backend
 * reported; a run is shown as created only after the backend confirmed it.
 */
export const OrbitLabPanel: React.FC<OrbitLabPanelProps> = ({
  systems, experiment, experiments, activeUniverseId, busy, error, switchDisabled,
  onStart, onCreateRun, onActivate, onDelete, onDismissError, getInitialDifferences,
}) => {
  const [factor, setFactor] = useState<number | null>(null);
  const [differences, setDifferences] = useState<InitialDifferencesDto | null>(null);
  const [differencesError, setDifferencesError] = useState<string | null>(null);

  const modifiedId = experiment?.modifiedUniverseId ?? null;
  const experimentId = experiment?.id;
  useEffect(() => {
    setDifferences(null);
    setDifferencesError(null);
    if (!experimentId || !modifiedId) return;
    let cancelled = false;
    getInitialDifferences(experimentId)
      .then((d) => !cancelled && setDifferences(d))
      .catch((e) => !cancelled && setDifferencesError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // The check is about the runs' initial states: it is read again whenever the modified run is (re)created.
  }, [experimentId, modifiedId, experiment?.modification?.createdAtIso, getInitialDifferences]);

  const header = <h3 style={{ margin: 0, fontSize: 14 }}>Orbit Lab</h3>;
  const errorBox = error && (
    <p role="alert" style={{ ...errorTextStyle, margin: 0 }}>
      {error}{' '}
      <button type="button" onClick={onDismissError} style={{ ...btnStyle, fontSize: 11, padding: '2px 6px' }}>dismiss</button>
    </p>
  );

  if (!experiment) {
    const system = systems[0];
    return (
      <section aria-label="Orbit Lab" style={{ ...panelStyle, width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {header}
        {system ? (
          <>
            <p style={{ margin: 0, fontSize: 12 }}>{system.description}</p>
            <p style={{ margin: 0, fontSize: 11, color: theme.textMuted }}>System: {system.name}</p>
            <button type="button" style={btnStyle} disabled={busy || switchDisabled} onClick={() => onStart(system.id)}>
              Start Experiment 01
            </button>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: theme.textMuted }}>The backend offers no Orbit Lab system.</p>
        )}
        {experiments.length > 0 && (
          <div style={rowStyle}>
            <span style={{ color: theme.textMuted }}>Existing experiments</span>
            {experiments.map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button type="button" style={btnStyle} disabled={switchDisabled}
                  onClick={() => onActivate(e.baselineUniverseId)}>
                  Open baseline of {e.name}
                </button>
                <ConfirmButton
                  label="Delete experiment"
                  confirmLabel="Delete both runs"
                  disabled={busy}
                  onConfirm={() => onDelete(e.id)}
                />
              </div>
            ))}
          </div>
        )}
        {errorBox}
      </section>
    );
  }

  const system = experiment.system;
  const earth = experiment.initialState.bodies.find((b) => system.selectableBodyIds.includes(b.id));
  const baselineActive = activeUniverseId === experiment.baselineUniverseId;
  const modifiedActive = modifiedId !== null && activeUniverseId === modifiedId;
  const inThisExperiment = baselineActive || modifiedActive;
  const hasRun = modifiedId !== null;
  const baseSpeed = earth ? earth.speedMPerS : null;
  const m = experiment.modification;

  return (
    <section aria-label="Orbit Lab" style={{ ...panelStyle, width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {header}
      <p style={{ margin: 0, fontSize: 12 }}>{system.description}</p>
      <div style={rowStyle}>
        <strong>Baseline (immutable reference)</strong>
        <span style={{ color: theme.textMuted }}>
          Bodies: {experiment.initialState.bodies.map((b) => b.name).join(', ')}
        </span>
        <span style={{ color: theme.textMuted }}>Epoch: {experiment.initialState.epoch ?? '—'} · Frame: {experiment.initialState.frame ?? '—'}</span>
        <span style={{ color: theme.textMuted }}>Units: {experiment.initialState.units ?? '—'} · Origin: {experiment.initialState.origin ?? '—'}</span>
        <span style={{ ...mono, color: theme.textMuted }} title={experiment.initialState.digest}>Initial-state digest: {experiment.initialState.digest.slice(0, 16)}…</span>
        <span style={{ fontSize: 11 }}>{experiment.initialState.modelNote}</span>
      </div>

      {earth && (
        <div style={rowStyle}>
          <strong>Planet to modify: {earth.name}</strong>
          <span data-testid="initial-velocity" style={mono}>Initial velocity (m/s): {vec(earth.velocityMPerS)}</span>
          <span data-testid="initial-speed" style={mono}>Initial speed: {speedText(earth.speedMPerS)}</span>
        </div>
      )}

      <fieldset style={{ border: `1px solid ${theme.border}`, borderRadius: 4, margin: 0, padding: 8 }}>
        <legend style={{ fontSize: 12, padding: '0 4px' }}>Speed factor</legend>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {system.speedFactors.map((f) => (
            <label key={f} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="radio" name="speed-factor" value={f} checked={factor === f} onChange={() => setFactor(f)} />
              {factorText(f)}
            </label>
          ))}
        </div>
        {factor === null ? (
          <p style={{ margin: '6px 0 0 0', fontSize: 11, color: theme.textMuted }}>Choose a speed factor to see the preview. The direction of the velocity is kept.</p>
        ) : (
          earth && baseSpeed !== null && (
            <p data-testid="velocity-preview" style={{ margin: '6px 0 0 0', fontSize: 11 }}>
              Preview: {speedText(baseSpeed)} → {speedText(baseSpeed * factor)} ({factorText(factor)}, direction unchanged;
              components {vec(earth.velocityMPerS.map((c) => c * factor) as Vec3Tuple)} m/s). Nothing has been created yet.
            </p>
          )
        )}
        {!hasRun ? (
          <button type="button" style={{ ...btnStyle, marginTop: 8 }} disabled={factor === null || busy || !inThisExperiment}
            onClick={() => factor !== null && onCreateRun(experiment.id, factor, false)}>
            Create modified run
          </button>
        ) : (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {modifiedActive ? (
              <>
                <button type="button" style={btnStyle} disabled>Recreate modified run</button>
                <span style={{ fontSize: 11, color: theme.textMuted }}>Switch to the baseline to recreate the modified run.</span>
              </>
            ) : factor === null ? (
              <button type="button" style={btnStyle} disabled>Recreate modified run</button>
            ) : (
              <ConfirmButton
                label="Recreate modified run"
                confirmLabel="Recreate (discards the existing modified run and its progress)"
                disabled={busy}
                onConfirm={() => onCreateRun(experiment.id, factor, true)}
              />
            )}
          </div>
        )}
      </fieldset>

      {hasRun && m && (
        <div data-testid="modification-record" style={rowStyle}>
          <strong>Modified run {factorText(m.speedFactor)} speed</strong>
          <span style={mono}>Body: {m.bodyId} · Baseline: {m.baselineUniverseId}</span>
          <span style={mono}>Original velocity ({m.units}): {vec(m.originalVelocityMPerS)} · speed {speedText(speed(m.originalVelocityMPerS))}</span>
          <span style={mono}>Modified velocity ({m.units}): {vec(m.modifiedVelocityMPerS)} · speed {speedText(speed(m.modifiedVelocityMPerS))}</span>
          <span style={{ ...mono, color: theme.textMuted }}>Created {m.createdAtIso}</span>
        </div>
      )}

      {hasRun && (
        <div data-testid="initial-check" role={differences && (differences.differences.length !== 1 || !differences.configEqual) ? 'alert' : 'status'}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: `1px solid ${differences && differences.differences.length === 1 && differences.configEqual ? theme.ok : theme.warn}` }}>
          <strong>Initial-state check: </strong>
          {differencesError ? (
            <span style={{ color: theme.danger }}>could not verify ({differencesError})</span>
          ) : !differences ? (
            'checking…'
          ) : differences.differences.length === 1 ? (
            <span>
              Exactly one difference: {differences.differences[0]!.field} of {differences.differences[0]!.bodyId}.{' '}
              {differences.configEqual ? 'Configuration identical.' : 'Configuration differs between the runs.'}
            </span>
          ) : (
            <span>
              {differences.differences.length} differences: {differences.differences.map((d) => `${d.field} of ${d.bodyId}`).join(', ')}.{' '}
              {differences.configEqual ? 'Configuration identical.' : 'Configuration differs between the runs.'}
            </span>
          )}
        </div>
      )}

      {hasRun && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button type="button" style={btnStyle} disabled={baselineActive || switchDisabled} onClick={() => onActivate(experiment.baselineUniverseId)}>
            Go to baseline
          </button>
          <button type="button" style={btnStyle} disabled={modifiedActive || switchDisabled} onClick={() => modifiedId && onActivate(modifiedId)}>
            Go to modified run
          </button>
        </div>
      )}
      {hasRun && (
        <p style={{ margin: 0, fontSize: 11, color: theme.textMuted }}>
          Use Play or Step in Controls to advance the active run. A run advances only while it is the active one.
        </p>
      )}

      {inThisExperiment ? (
        <span style={{ fontSize: 11, color: theme.textMuted }}>Switch to another universe first to delete this experiment.</span>
      ) : (
        <ConfirmButton
          label="Delete experiment"
          confirmLabel="Delete both runs"
          disabled={busy}
          onConfirm={() => onDelete(experiment.id)}
        />
      )}
      {errorBox}
    </section>
  );
};
