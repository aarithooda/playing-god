import React, { useEffect, useRef, useState } from 'react';
import type { BodyCreateDto } from '../../api/types';
import { formatDuration } from '../../sim/format';
import { MAX_SPEED_EXP, MIN_SPEED_EXP, type ActionResult } from '../../sim/useSimulation';
import {
  NEW_BODY_DEFAULTS,
  defaultsForNewBody,
  parseBodyForm,
  type FieldErrors,
  type FieldKey,
  type FormValues,
} from '../../sim/validation';
import type { BodyView } from '../../sim/viewModel';
import type { Vec3 } from '../../api/types';
import { BodyFields } from './BodyFields';
import { btnStyle, errorTextStyle, panelStyle } from './styles';

interface ControlPanelProps {
  bodies?: readonly BodyView[];
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
  placementMode?: boolean;
  onPlacementModeChange?: (active: boolean) => void;
  pickedPosition?: { position: Vec3; nonce: number };
  onPlacementRadiusChange?: (radiusM: number) => void;
  onPlacementCreateResult?: (success: boolean) => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  bodies = [],
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
  placementMode = false,
  onPlacementModeChange = () => {},
  pickedPosition,
  onPlacementRadiusChange,
  onPlacementCreateResult,
}) => {
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<FormValues>(NEW_BODY_DEFAULTS);
  const [positionManuallyEdited, setPositionManuallyEdited] = useState(false);
  const positionManuallyEditedRef = useRef(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const createFromDraft = async (draft: FormValues) => {
    const parsed = parseBodyForm(draft);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      onPlacementCreateResult?.(false);
      return;
    }
    setBusy(true);
    setServerError(null);
    const result = await onCreate(parsed.value);
    setBusy(false);
    onPlacementCreateResult?.(result.ok);
    if (result.ok) {
      onPlacementModeChange(false);
      setCreating(false);
      setValues(NEW_BODY_DEFAULTS);
      onPlacementRadiusChange?.(Number(NEW_BODY_DEFAULTS.radius));
      setPositionManuallyEdited(false);
      positionManuallyEditedRef.current = false;
      setErrors({});
    } else setServerError(result.error);
  };

  useEffect(() => {
    if (!pickedPosition) return;
    const pickedDraft = {
      ...values,
      px: String(pickedPosition.position.x),
      py: String(pickedPosition.position.y),
      pz: String(pickedPosition.position.z),
    };
    setValues(pickedDraft);
    setPositionManuallyEdited(true);
    positionManuallyEditedRef.current = true;
    setErrors({});
    setServerError(null);
    void createFromDraft(pickedDraft);
  }, [pickedPosition?.nonce]);

  const change = (key: FieldKey, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (key === 'radius') onPlacementRadiusChange?.(Number(value));
    if (key === 'px' || key === 'py' || key === 'pz') {
      setPositionManuallyEdited(true);
      positionManuallyEditedRef.current = true;
    }
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  // Keep an untouched automatic position clear if the body set or the requested radius changes.
  useEffect(() => {
    if (!creating || positionManuallyEditedRef.current) return;
    const defaults = defaultsForNewBody(bodies, values.radius);
    setValues((current) => current.px === defaults.px && current.py === defaults.py && current.pz === defaults.pz
      ? current
      : { ...current, px: defaults.px, py: defaults.py, pz: defaults.pz });
  }, [bodies, creating, positionManuallyEdited, values.radius]);

  const toggleCreate = () => {
    if (creating) {
      onPlacementModeChange(false);
      setCreating(false);
      return;
    }
    const defaults = defaultsForNewBody(bodies);
    setValues(defaults);
    onPlacementRadiusChange?.(Number(defaults.radius));
    setPositionManuallyEdited(false);
    positionManuallyEditedRef.current = false;
    setErrors({});
    setServerError(null);
    setCreating(true);
  };

  const submit = async () => createFromDraft(values);

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
        <button style={btnStyle} onClick={toggleCreate} disabled={disabled}>
          {creating ? 'Cancel' : 'Add body…'}
        </button>
        {creating && (
          <div style={{ marginTop: '10px' }}>
            <BodyFields
              values={values}
              errors={errors}
              onChange={change}
              idPrefix="create"
              isPickingPosition={placementMode}
              onPickPosition={() => onPlacementModeChange(!placementMode)}
            />
            {serverError && <p role="alert" style={errorTextStyle}>{serverError}</p>}
            <button style={btnStyle} onClick={submit} disabled={busy}>Create</button>
          </div>
        )}
      </div>
    </div>
  );
};
