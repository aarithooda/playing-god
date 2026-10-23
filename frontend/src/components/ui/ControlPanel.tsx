import React, { useState } from 'react';
import type { BodyCreateDto } from '../../api/types';
import { formatDuration } from '../../sim/format';
import { MAX_SPEED_EXP, MIN_SPEED_EXP, type ActionResult } from '../../sim/useSimulation';
import {
  NEW_BODY_DEFAULTS,
  parseBodyForm,
  type FieldErrors,
  type FieldKey,
  type FormValues,
} from '../../sim/validation';
import { BodyFields } from './BodyFields';
import { btnStyle, errorTextStyle, panelStyle } from './styles';

interface ControlPanelProps {
  playing: boolean;
  stepping: boolean;
  canRun: boolean;
  disabled: boolean;
  simulationTimeS: number | null;
  speedExp: number;
  stepSeconds: number;
  onSpeedChange: (exp: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
  onFit: () => void;
  onCreate: (body: BodyCreateDto) => Promise<ActionResult>;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  playing,
  stepping,
  canRun,
  disabled,
  simulationTimeS,
  speedExp,
  stepSeconds,
  onSpeedChange,
  onPlay,
  onPause,
  onStep,
  onReset,
  onFit,
  onCreate,
}) => {
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<FormValues>(NEW_BODY_DEFAULTS);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (key: FieldKey, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async () => {
    const parsed = parseBodyForm(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setBusy(true);
    setServerError(null);
    const result = await onCreate(parsed.value);
    setBusy(false);
    if (result.ok) setCreating(false);
    else setServerError(result.error);
  };

  return (
    <div style={{
      ...panelStyle,
      position: 'absolute',
      top: '20px',
      right: '20px',
      width: '250px',
      maxHeight: '60vh',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    }}>
      <h3 style={{ margin: '0 0 4px 0', fontSize: '14px', opacity: 0.8 }}>Simulation</h3>
      <div style={{ fontSize: '11px', opacity: 0.6 }}>
        Sim time: {simulationTimeS === null ? '—' : `${formatDuration(simulationTimeS)} (${simulationTimeS.toExponential(3)} s)`}
      </div>
      <div style={{ display: 'flex', gap: '5px' }}>
        <button style={btnStyle} onClick={onPlay} disabled={disabled || playing || !canRun}>Play</button>
        <button style={btnStyle} onClick={onPause} disabled={!playing}>Pause</button>
      </div>
      <button style={btnStyle} onClick={onStep} disabled={disabled || stepping || !canRun}>Step Forward</button>
      <button style={btnStyle} onClick={onReset} disabled={disabled}>Reset Universe</button>
      <button style={btnStyle} onClick={onFit}>Fit view</button>
      <div style={{ marginTop: '4px' }}>
        <label htmlFor="sim-speed" style={{ fontSize: '12px', display: 'block', marginBottom: '5px' }}>
          Sim Speed: {formatDuration(stepSeconds)} per step
        </label>
        <input
          id="sim-speed"
          type="range"
          min={MIN_SPEED_EXP}
          max={MAX_SPEED_EXP}
          step={0.25}
          value={speedExp}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ borderTop: '1px solid #333', paddingTop: '10px' }}>
        <button style={btnStyle} onClick={() => setCreating((c) => !c)} disabled={disabled}>
          {creating ? 'Cancel' : 'Add body…'}
        </button>
        {creating && (
          <div style={{ marginTop: '10px' }}>
            <BodyFields values={values} errors={errors} onChange={change} idPrefix="create" />
            {serverError && <p role="alert" style={errorTextStyle}>{serverError}</p>}
            <button style={btnStyle} onClick={submit} disabled={busy}>Create</button>
          </div>
        )}
      </div>
    </div>
  );
};
