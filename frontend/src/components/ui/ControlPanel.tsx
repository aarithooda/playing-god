import React, { useEffect, useRef, useState } from 'react';
import type { BodyCreateDto, BodyKind, BodyType, CatalogueEntryDto } from '../../api/types';
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
import { ConfirmButton } from './ConfirmButton';
import { btnStyle, errorTextStyle, panelStyle } from './styles';
import { theme } from './theme';
import { ViewToolbar } from './ViewToolbar';
import type { ViewControlContract } from '../../sim/viewControlContract';

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
  /** Reset discards the current state: ask for a second press first. */
  confirmReset?: boolean;
  onFit: () => void;
  viewControls?: ViewControlContract;
  onCreate: (body: BodyCreateDto) => Promise<ActionResult>;
  placementMode?: boolean;
  onPlacementModeChange?: (active: boolean) => void;
  pickedPosition?: { position: Vec3; nonce: number };
  onPlacementRadiusChange?: (radiusM: number) => void;
  onPlacementCreateResult?: (success: boolean) => void;
  /** Increment to open the create form (used by the empty-universe call to action). */
  openCreateRequest?: number;
  /** When set, adding bodies is not possible and this is why (for example the immutable Orbit Lab baseline). */
  addBlockedReason?: string;
  /** A recorded state is on screen: stepping, resetting and adding are off. Play stays (it returns to live first). */
  historyView?: boolean;
  /** Open the create form prefilled from a catalogue entry (a copy: the entry is never changed). */
  catalogueRequest?: { entry: CatalogueEntryDto; nonce: number };
}

const EMPTY_VIEW_CONTROLS: ViewControlContract = {
  state: { axesVisible: false, gridEnabled: false, gridShownForPlacement: false, canFitView: false, canFocusSelected: false },
  actions: { setAxesVisible: () => {}, setGridVisible: () => {}, fitView: () => {}, focusSelected: () => {} },
};
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
  confirmReset = false,
  onFit,
  viewControls,
  onCreate,
  placementMode = false,
  onPlacementModeChange = () => {},
  pickedPosition,
  onPlacementRadiusChange,
  onPlacementCreateResult,
  openCreateRequest = 0,
  catalogueRequest,
  historyView = false,
  addBlockedReason,
}) => {
  const toolbarControls = viewControls ?? { ...EMPTY_VIEW_CONTROLS, actions: { ...EMPTY_VIEW_CONTROLS.actions, fitView: onFit } };
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<FormValues>(NEW_BODY_DEFAULTS);
  const [positionManuallyEdited, setPositionManuallyEdited] = useState(false);
  const positionManuallyEditedRef = useRef(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  // The type is not a text field; it is sent only when it is not the backend default (planet) or came from the catalogue.
  const [kind, setKind] = useState<BodyKind>('planet');
  const [catalogueEntry, setCatalogueEntry] = useState<{ id: string; name: string; bodyType?: BodyType; assetKey?: string } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A second create request (for example a double press) must not start while one is in flight.
  const creatingRef = useRef(false);

  const createFromDraft = async (draft: FormValues) => {
    if (creatingRef.current) return;
    const parsed = parseBodyForm(draft);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      onPlacementCreateResult?.(false);
      return;
    }
    creatingRef.current = true;
    setBusy(true);
    setServerError(null);
    const payload: BodyCreateDto = {
      ...parsed.value,
      ...(kind !== 'planet' || catalogueEntry ? { kind } : {}),
      ...(catalogueEntry ? { catalogueEntryId: catalogueEntry.id } : {}),
      ...(catalogueEntry?.bodyType ? { bodyType: catalogueEntry.bodyType } : {}),
      ...(catalogueEntry?.assetKey ? { assetKey: catalogueEntry.assetKey } : {}),
    };
    const result = await onCreate(payload).finally(() => {
      creatingRef.current = false;
    });
    setBusy(false);
    onPlacementCreateResult?.(result.ok);
    if (result.ok) {
      onPlacementModeChange(false);
      setCreating(false);
      setKind('planet');
      setCatalogueEntry(null);
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

  const openCreate = () => {
    const defaults = defaultsForNewBody(bodies);
    setKind('planet');
    setCatalogueEntry(null);
    setValues(defaults);
    onPlacementRadiusChange?.(Number(defaults.radius));
    setPositionManuallyEdited(false);
    positionManuallyEditedRef.current = false;
    setErrors({});
    setServerError(null);
    setCreating(true);
  };

  // A catalogue entry opens the form prefilled with its name, mass, radius, colour and type. Position comes from the
  // usual clear default (or 3D placement) and the body starts at rest: the catalogue holds no positions or velocities.
  useEffect(() => {
    if (!catalogueRequest) return;
    const { entry } = catalogueRequest;
    const radiusText = String(entry.properties.radiusM.value);
    const defaults = defaultsForNewBody(bodies, radiusText);
    setValues({
      ...defaults,
      name: entry.name,
      mass: String(entry.properties.massKg.value),
      radius: radiusText,
      vx: '0', vy: '0', vz: '0',
      color: entry.visual.colorHex,
    });
    setKind(entry.kind);
    setCatalogueEntry({ id: entry.id, name: entry.name, bodyType: entry.bodyType, assetKey: entry.assetKey });
    onPlacementRadiusChange?.(entry.properties.radiusM.value);
    setPositionManuallyEdited(false);
    positionManuallyEditedRef.current = false;
    setErrors({});
    setServerError(null);
    setCreating(true);
    onPlacementModeChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogueRequest?.nonce]);

  const toggleCreate = () => {
    if (creating) {
      onPlacementModeChange(false);
      setCreating(false);
    } else openCreate();
  };

  // The empty-universe call to action asks for the form to open.
  useEffect(() => {
    if (openCreateRequest > 0 && !creating) openCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreateRequest]);

  const submit = async () => createFromDraft(values);

  return (
    <div style={{
      ...panelStyle,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    }}>
      <h3 style={{ margin: '0 0 4px 0', fontSize: '14px' }}>Simulation</h3>
      <div style={{ fontSize: '11px', color: theme.textMuted }}>
        Sim time: {simulationTimeS === null ? '—' : `${formatDuration(simulationTimeS)} (${simulationTimeS.toExponential(3)} s)`}
      </div>
      <ViewToolbar controls={toolbarControls} playing={playing} canRun={canRun} disabled={disabled} onPlay={onPlay} onPause={onPause} />
      <button style={btnStyle} onClick={onStep} disabled={disabled || stepping || !canRun || historyView} title={historyView ? 'Return to live to step' : undefined}>Step Forward</button>
      {confirmReset ? (
        <ConfirmButton
          label="Reset Universe"
          confirmLabel="Confirm reset (returns to the initial state)"
          onConfirm={onReset}
          disabled={disabled || historyView}
          style={{ width: '100%' }}
        />
      ) : (
        <button style={btnStyle} onClick={onReset} disabled={disabled || historyView}>Reset Universe</button>
      )}
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

      <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: '10px' }}>
        <button style={btnStyle} onClick={toggleCreate} disabled={disabled || historyView || !!addBlockedReason} title={addBlockedReason ?? (historyView ? 'Return to live to add a body' : undefined)}>
          {creating ? 'Cancel' : 'Add body…'}
        </button>
        {creating && (
          <form
            aria-label="Create body"
            noValidate
            onSubmit={(event) => { event.preventDefault(); void submit(); }}
            style={{ marginTop: '10px' }}
          >
            <BodyFields
              values={values}
              errors={errors}
              onChange={change}
              idPrefix="create"
              isPickingPosition={placementMode}
              onPickPosition={() => onPlacementModeChange(!placementMode)}
              kind={kind}
              bodyType={catalogueEntry?.bodyType}
              onKindChange={setKind}
            />
            {catalogueEntry && (
              <p style={{ fontSize: '11px', color: theme.textMuted, margin: '0 0 8px 0' }}>
                Started from the catalogue entry {catalogueEntry.name}. This is a copy: editing it never changes the catalogue.
              </p>
            )}
            {serverError && <p role="alert" style={errorTextStyle}>{serverError}</p>}
            <button type="submit" style={btnStyle} disabled={busy}>Create</button>
          </form>
        )}
      </div>
    </div>
  );
};
