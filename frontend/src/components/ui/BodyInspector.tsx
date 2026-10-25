import { bodyFact } from '../../sim/bodyFacts';
import React, { useEffect, useRef, useState } from 'react';
import type { BodyKind, BodyUpdateDto, CatalogueEntryDto } from '../../api/types';
import { resolveCelestialAssets } from '../../assets/registry';
import type { ActionResult } from '../../sim/useSimulation';
import { formatNumber, formatReadout } from '../../sim/format';
import { escapeSpeed, magnitude, meanDensity, surfaceGravity } from '../../sim/derivedQuantities';
import {
  parseBodyEdits,
  valuesFromBody,
  type FieldErrors,
  type FieldKey,
  type FormValues,
} from '../../sim/validation';
import type { BodyView } from '../../sim/viewModel';
import { BodyFields } from './BodyFields';
import { Icon } from './Icon';
import { btnStyle, errorTextStyle, noteTextStyle, primaryBtnStyle } from './styles';
import { theme } from './theme';
import type { SizeMode } from '../../sim/renderTransform';

interface BodyInspectorProps {
  /** Confirmed backend state of the selected body (null when nothing is selected). */
  body: BodyView | null;
  onSave: (id: string, patch: BodyUpdateDto) => Promise<ActionResult>;
  onDelete: (id: string) => Promise<ActionResult>;
  onFocus: (id: string) => void;
  onClose?: () => void;
  /** The camera is currently following this body. */
  focused?: boolean;
  /** When set, editing is blocked and this is why (for example "Pause to edit."). */
  editBlockedReason?: string;
  /** Radius the scene actually draws for this body (display only), when it differs from the nominal display radius. */
  drawnRadiusUnits?: number;
  /** Rendering view: when set, the drawn radius is the true radius in scene units (both views draw true geometry). */
  sizeMode?: SizeMode;
  /** Name of the body this one orbits, when the backend reports a primary that is present. */
  primaryName?: string;
  /** The catalogue entry the body was created from, when it still exists in the catalogue. */
  catalogueEntry?: CatalogueEntryDto;
}

const KIND_LABEL: Record<BodyKind, string> = { star: 'Star', planet: 'Planet' };

/**
 * Dismissal on an empty-space click is owned by the canvas (UniverseCanvas onPointerMissed), not by
 * this panel; the panel only offers the explicit close button.
 *
 * Edits go into a draft that holds only the fields the user changed; every other field follows the
 * confirmed (live) backend value. Saving sends a PATCH and clears the draft; the shown values then come
 * from the refreshed authoritative state, never from the draft.
 */
export const BodyInspector: React.FC<BodyInspectorProps> = ({ body, onSave, onDelete, onFocus, onClose, focused = false, editBlockedReason, drawnRadiusUnits, sizeMode, primaryName, catalogueEntry }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Partial<FormValues>>({});
  const [kindDraft, setKindDraft] = useState<BodyKind | undefined>(undefined);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const bodyId = body?.id;
  // A different body starts at the top of the panel.
  useEffect(() => {
    if (bodyId) panelRef.current?.scrollTo?.({ top: 0 });
  }, [bodyId]);

  useEffect(() => {
    setDraft({});
    setKindDraft(undefined);
    setErrors({});
    setConfirmDelete(false);
    setServerError(null);
  }, [bodyId]);

  if (!body) return null;

  const confirmed = valuesFromBody(body, formatNumber);
  const shown: FormValues = { ...confirmed, ...draft };
  const kindChanged = kindDraft !== undefined && kindDraft !== body.kind;
  const dirty = Object.keys(draft).length > 0 || kindChanged;

  const change = (key: FieldKey, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const save = async () => {
    const parsed = Object.keys(draft).length > 0 ? parseBodyEdits(draft, body) : ({ ok: true, value: {} } as const);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    const patch: BodyUpdateDto = { ...parsed.value, ...(kindChanged ? { kind: kindDraft } : {}) };
    setBusy(true);
    setServerError(null);
    const result = await onSave(body.id, patch);
    setBusy(false);
    if (result.ok) {
      setDraft({});
      setKindDraft(undefined);
    } else setServerError(result.error);
  };

  const remove = async () => {
    setBusy(true);
    setServerError(null);
    const result = await onDelete(body.id);
    setBusy(false);
    if (result.ok) setConfirmDelete(false);
    else setServerError(result.error);
  };

  const image = resolveCelestialAssets(body.assetKey, body.bodyType)?.diffuse;
  const typeLabel = body.bodyType && body.bodyType !== 'default' && body.bodyType.replace(/-/g, ' ') !== KIND_LABEL[body.kind].toLowerCase()
    ? body.bodyType.replace(/-/g, ' ')
    : null;
  const density = meanDensity(body.massKg, body.radiusM);
  const gravity = surfaceGravity(body.massKg, body.radiusM);
  const escape = escapeSpeed(body.massKg, body.radiusM);
  const firstSource = catalogueEntry?.properties.massKg.sources[0] ?? catalogueEntry?.properties.radiusM.sources[0];

  return (
    <>
      <div className="pg-panel-head" style={{ alignItems: 'flex-start', paddingTop: 16, paddingBottom: 14 }}>
        <h2 className="sr-only">Body Inspector</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          {image ? (
            <img src={image} alt="" draggable={false} style={{ ...swatchStyle, objectFit: 'cover', backgroundColor: body.colorHex }} />
          ) : (
            <span aria-hidden="true" style={{ ...swatchStyle, background: `radial-gradient(circle at 35% 30%, #ffffff55, ${body.colorHex} 55%, #000 140%)` }} />
          )}
          <div style={{ minWidth: 0 }}>
            <div
              data-testid="inspector-name"
              style={{ fontFamily: theme.serif, fontSize: 25, fontWeight: 600, lineHeight: 1.05, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={body.name}
            >
              {body.name}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12, color: theme.textMuted }}>
              <span>{KIND_LABEL[body.kind]}{typeLabel ? `, ${typeLabel}` : ''}{primaryName ? ` of ${primaryName}` : ''}</span>
              {focused && (
                <span
                  data-testid="focused-badge"
                  title="The camera is following this body"
                  style={{ fontSize: 10.5, color: theme.accent, border: `1px solid ${theme.accent}`, borderRadius: 999, padding: '0 7px', lineHeight: '16px' }}
                >
                  Focused
                </span>
              )}
            </div>
          </div>
        </div>
        <button type="button" className="pg-icon-btn pg-icon-btn--sm" aria-label="Close body inspector" title="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div ref={panelRef} className="pg-panel-body" style={{ gap: 14 }}>
        <section aria-label="Readouts">
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', margin: 0 }}>
            <Readout label="Speed" value={formatReadout(body.speedMPerS)} unit="m/s" testId="readout-speed" />
            <Readout label="Distance from origin" value={formatReadout(magnitude(body.positionM))} unit="m" />
            <Readout label="Mean density" value={density === null ? '—' : formatReadout(density)} unit="kg/m³" />
            <Readout label="Surface gravity" value={gravity === null ? '—' : formatReadout(gravity)} unit="m/s²" />
            <Readout label="Escape speed" value={escape === null ? '—' : formatReadout(escape)} unit="m/s" />
            <Readout label="Mass" value={formatReadout(body.massKg)} unit="kg" />
          </dl>
          <p style={{ ...noteTextStyle, marginTop: 10, fontSize: 11 }}>
            Speed and distance are this body's confirmed backend state (distance is from the simulation origin). Density,
            surface gravity and escape speed are derived here from mass and radius for a uniform, non-rotating sphere.
          </p>
        </section>

        <p data-testid="body-fact" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: theme.textMuted }}>{bodyFact(body.id)}</p>

        {catalogueEntry && (
          <section aria-label="About" style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 12 }}>
            {catalogueEntry.notes && <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>{catalogueEntry.notes}</p>}
            {firstSource && (
              <p style={{ ...noteTextStyle, marginTop: 6 }}>
                Initial mass and radius from the catalogue: {firstSource.citation}.
              </p>
            )}
          </section>
        )}

        <form
          aria-label="Edit body"
          noValidate
          onSubmit={(event) => { event.preventDefault(); void save(); }}
        >
          <BodyFields
            values={shown}
            errors={errors}
            onChange={change}
            idPrefix="inspect"
            kind={kindDraft ?? body.kind}
            bodyType={body.bodyType}
            onKindChange={setKindDraft}
            drawnRadiusUnits={drawnRadiusUnits}
            sizeMode={sizeMode}
          />
          <p style={{ ...noteTextStyle, margin: '0 0 10px', fontFamily: theme.mono, fontSize: 10.5, color: theme.textFaint }}>
            {body.id} · SI units · speed {formatNumber(body.speedMPerS)} m/s
          </p>
          {editBlockedReason && (
            <p role="status" style={{ ...noteTextStyle, margin: '0 0 10px' }}>{editBlockedReason}</p>
          )}
          {serverError && <p role="alert" style={{ ...errorTextStyle, margin: '0 0 8px' }}>{serverError}</p>}

          {confirmDelete && (
            <div role="group" aria-labelledby="delete-body-heading" aria-describedby="delete-body-description" style={{
              border: '1px solid ' + theme.danger,
              borderRadius: 8,
              padding: '10px',
              marginBottom: '10px',
              background: theme.dangerSoft,
            }}>
              <strong id="delete-body-heading" style={{ fontSize: '12.5px' }}>Delete {body.name}?</strong>
              <p id="delete-body-description" style={{ ...noteTextStyle, margin: '5px 0 8px' }}>
                This removes the body from the simulation. This action cannot be undone here.
              </p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button type="button" style={btnStyle} onClick={() => setConfirmDelete(false)} disabled={busy}>Keep body</button>
                <button type="button" style={{ ...btnStyle, borderColor: theme.danger, color: theme.danger }} onClick={() => void remove()} disabled={busy}>
                  {busy ? 'Deleting…' : 'Delete body'}
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="submit" style={dirty ? primaryBtnStyle : btnStyle} disabled={!dirty || busy || !!editBlockedReason}>Apply</button>
            <button type="button" style={btnStyle} onClick={() => { setDraft({}); setKindDraft(undefined); setErrors({}); setServerError(null); }} disabled={!dirty || busy}>Revert</button>
            <span style={{ flex: 1 }} />
            <button type="button" style={btnStyle} onClick={() => onFocus(body.id)} title="Fly the camera to this body and follow it">Focus</button>
            {!confirmDelete && (
              <button type="button" style={{ ...btnStyle, color: theme.danger, borderColor: theme.dangerLine }} onClick={() => { setConfirmDelete(true); setServerError(null); }} disabled={busy || !!editBlockedReason}>Delete</button>
            )}
          </div>
        </form>
      </div>
    </>
  );
};

const swatchStyle: React.CSSProperties = { width: 46, height: 46, flex: '0 0 46px', borderRadius: '50%', boxShadow: '0 0 0 1px var(--line), 0 4px 16px rgba(0,0,0,0.35)', display: 'block' };

const Readout: React.FC<{ label: string; value: string; unit: string; testId?: string }> = ({ label, value, unit, testId }) => (
  <div style={{ minWidth: 0 }}>
    <dt style={{ fontSize: 11, color: theme.textMuted, marginBottom: 2 }}>{label}</dt>
    <dd data-testid={testId} style={{ margin: 0, fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {value} <span style={{ fontSize: 11, color: theme.textMuted, fontWeight: 400 }}>{unit}</span>
    </dd>
  </div>
);
