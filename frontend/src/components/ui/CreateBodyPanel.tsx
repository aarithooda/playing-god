import React, { useEffect, useRef, useState } from 'react';
import type { BodyCreateDto, BodyKind, BodyType, CatalogueEntryDto } from '../../api/types';
import type { ActionResult } from '../../sim/useSimulation';
import { circularOrbitVelocity, pickPrimaryStar } from '../../sim/orbitVelocity';
import { MATERIAL_OPTIONS } from '../../sim/defaultMaterial';
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
import { btnStyle, errorTextStyle, inputStyle, labelStyle, noteTextStyle, primaryBtnStyle, sectionTitleStyle } from './styles';
import { theme } from './theme';

interface CreateBodyPanelProps {
  bodies?: readonly BodyView[];
  /** The simulation is not loaded. */
  disabled: boolean;
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
  /** A recorded state is on screen: adding is off until the view returns to live. */
  historyView?: boolean;
  /** Open the create form prefilled from a catalogue entry (a copy: the entry is never changed). */
  catalogueRequest?: { entry: CatalogueEntryDto; nonce: number };
}

/**
 * Creating a body: the form holds SI values, and a body enters the simulation only when the backend accepts it.
 * Position comes from a clear automatic default, typed values, or a click in the scene (3D placement); velocity is
 * whatever is entered (zero means the body starts at rest). Nothing here computes an orbit for the user.
 */
export const CreateBodyPanel: React.FC<CreateBodyPanelProps> = ({
  bodies = [],
  disabled,
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
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<FormValues>(NEW_BODY_DEFAULTS);
  const [positionManuallyEdited, setPositionManuallyEdited] = useState(false);
  const positionManuallyEditedRef = useRef(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  // The type is not a text field; it is sent only when it is not the backend default (planet) or came from the catalogue.
  const [kind, setKind] = useState<BodyKind>('planet');
  const [catalogueEntry, setCatalogueEntry] = useState<{ id: string; name: string; bodyType?: BodyType; assetKey?: string } | null>(null);
  // '' = not specified: no material is sent (D-033 DQ-2 (a): never assigned silently; the body's contacts then merge exactly as before).
  // Anything else is a backend material profile id the user chose, sent to the collision engine.
  const [materialId, setMaterialId] = useState('');
  // Offered when the universe has a star and the new body is a planet: start it on a circular orbit around that star.
  const [orbitStar, setOrbitStar] = useState(true);
  const primaryStar = kind === 'planet' ? pickPrimaryStar(bodies) : undefined;
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
    const orbitV = orbitStar && primaryStar ? circularOrbitVelocity(primaryStar, parsed.value.positionM, parsed.value.massKg) : undefined;
    const payload: BodyCreateDto = {
      ...parsed.value,
      ...(orbitV ? { velocityMPerS: orbitV } : {}),
      ...(kind !== 'planet' || catalogueEntry ? { kind } : {}),
      ...(catalogueEntry ? { catalogueEntryId: catalogueEntry.id } : {}),
      ...(catalogueEntry?.bodyType ? { bodyType: catalogueEntry.bodyType } : {}),
      ...(catalogueEntry?.assetKey ? { assetKey: catalogueEntry.assetKey } : {}),
      ...(materialId ? { material: { profileId: materialId, layers: null } } : {}),
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
      setMaterialId('');
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
    if (key === 'vx' || key === 'vy' || key === 'vz') setOrbitStar(false); // an explicit velocity wins
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
    setOrbitStar(true);
    setMaterialId('');
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
    setOrbitStar(true);
    setMaterialId('');
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
  const blockedNote = addBlockedReason ?? (historyView ? 'Return to live to add a body.' : undefined);
  const atRest = values.vx.trim() === '0' && values.vy.trim() === '0' && values.vz.trim() === '0';

  return (
    <section aria-label="Custom body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h3 style={sectionTitleStyle}>{creating ? (catalogueEntry ? `New ${catalogueEntry.name}` : 'New body') : 'Custom body'}</h3>
          {!creating && <p style={noteTextStyle}>Set the mass, size, position and velocity yourself.</p>}
        </div>
        <button
          type="button"
          style={{ ...(creating ? btnStyle : primaryBtnStyle), whiteSpace: 'nowrap', flex: '0 0 auto' }}
          onClick={toggleCreate}
          disabled={disabled || historyView || !!addBlockedReason}
          title={blockedNote}
        >
          {creating ? 'Cancel' : 'Add body…'}
        </button>
      </div>
      {blockedNote && !creating && <p role="status" style={noteTextStyle}>{blockedNote}</p>}

      {creating && placementMode && (
        <div
          role="status"
          data-testid="placement-banner"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px',
            borderRadius: 8, background: theme.accentSoft, border: `1px solid ${theme.accent}`, fontSize: 12,
          }}
        >
          <span>Click in the scene to place {catalogueEntry?.name ?? 'the body'}. Esc cancels.</span>
        </div>
      )}

      {creating && (
        <form
          aria-label="Create body"
          noValidate
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
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
          {primaryStar && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '0 0 10px', fontSize: 12.5 }}>
              <input type="checkbox" checked={orbitStar} onChange={(e) => setOrbitStar(e.target.checked)} style={{ marginTop: 2 }} />
              <span>Orbit {primaryStar.name}? It is given the circular-orbit velocity from its distance, and its path is traced.{orbitStar ? '' : ' (Off: it uses the velocity above.)'}</span>
            </label>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px' }}>
            <label style={{ ...labelStyle, flex: '0 0 auto' }} htmlFor="create-material">Material</label>
            <select id="create-material" style={inputStyle} value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              <option value="">Not specified (collisions merge, no material)</option>
              {MATERIAL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <p style={{ ...noteTextStyle, margin: '0 0 10px' }}>
            {atRest ? 'Starts at rest (velocity 0). ' : 'Starts with the velocity above. '}
            The backend integrates it from there under gravity.
          </p>
          {catalogueEntry && (
            <p style={{ ...noteTextStyle, margin: '0 0 10px' }}>
              Started from the catalogue entry {catalogueEntry.name}. This is a copy: editing it never changes the catalogue.
            </p>
          )}
          {serverError && <p role="alert" style={{ ...errorTextStyle, margin: '0 0 8px' }}>{serverError}</p>}
          <button type="submit" style={{ ...primaryBtnStyle, width: '100%', padding: '8px 12px' }} disabled={busy} aria-busy={busy}>
            Create
          </button>
        </form>
      )}
    </section>
  );
};
