import React, { useEffect, useRef, useState } from 'react';
import type { BodyUpdateDto } from '../../api/types';
import type { ActionResult } from '../../sim/useSimulation';
import { formatNumber } from '../../sim/format';
import {
  parseBodyEdits,
  valuesFromBody,
  type FieldErrors,
  type FieldKey,
  type FormValues,
} from '../../sim/validation';
import type { BodyView } from '../../sim/viewModel';
import { BodyFields } from './BodyFields';
import { btnStyle, errorTextStyle, panelStyle } from './styles';
import { theme } from './theme';

interface BodyInspectorProps {
  /** Confirmed backend state of the selected body (null when nothing is selected). */
  body: BodyView | null;
  onSave: (id: string, patch: BodyUpdateDto) => Promise<ActionResult>;
  onDelete: (id: string) => Promise<ActionResult>;
  onFocus: (id: string) => void;
  onClose?: () => void;
  /** The camera is currently following this body. */
  focused?: boolean;
}

/**
 * Dismissal on an empty-space click is owned by the canvas (UniverseCanvas onPointerMissed), not by
 * this panel; the panel only offers the explicit close button.
 *
 * Edits go into a draft that holds only the fields the user changed; every other field follows the
 * confirmed (live) backend value. Saving sends a PATCH and clears the draft; the shown values then come
 * from the refreshed authoritative state, never from the draft.
 */
export const BodyInspector: React.FC<BodyInspectorProps> = ({ body, onSave, onDelete, onFocus, onClose, focused = false }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Partial<FormValues>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const bodyId = body?.id;
  // Bring the inspector into view when a different body is selected (the sidebar scrolls).
  useEffect(() => {
    if (bodyId) panelRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [bodyId]);

  useEffect(() => {
    setDraft({});
    setErrors({});
    setConfirmDelete(false);
    setServerError(null);
  }, [bodyId]);

  if (!body) return null;

  const confirmed = valuesFromBody(body, formatNumber);
  const shown: FormValues = { ...confirmed, ...draft };
  const dirty = Object.keys(draft).length > 0;

  const change = (key: FieldKey, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const save = async () => {
    const parsed = parseBodyEdits(draft, body);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setBusy(true);
    setServerError(null);
    const result = await onSave(body.id, parsed.value);
    setBusy(false);
    if (result.ok) setDraft({});
    else setServerError(result.error);
  };

  const remove = async () => {
    setBusy(true);
    setServerError(null);
    const result = await onDelete(body.id);
    setBusy(false);
    if (result.ok) setConfirmDelete(false);
    else setServerError(result.error);
  };

  return (
    <div ref={panelRef} style={{ ...panelStyle, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '16px' }}>Body Inspector</h3>
        {focused && (
          <span
            data-testid="focused-badge"
            title="The camera is following this body"
            style={{
              marginRight: 'auto', fontSize: '10px', letterSpacing: 1, textTransform: 'uppercase',
              color: theme.accent, border: `1px solid ${theme.accent}`, borderRadius: '3px', padding: '1px 5px',
            }}
          >
            Focused
          </span>
        )}
        <button
          type="button"
          aria-label="Close body inspector"
          title="Close"
          onClick={onClose}
          style={{
            ...btnStyle,
            width: '24px',
            height: '24px',
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            lineHeight: 1,
            borderColor: theme.borderStrong,
          }}
        >
          ×
        </button>
      </div>
      <p style={{ fontSize: '11px', color: theme.textMuted, margin: '0 0 10px 0' }}>
        {body.id} · speed {formatNumber(body.speedMPerS)} m/s · SI units
      </p>

      <form
        aria-label="Edit body"
        noValidate
        onSubmit={(event) => { event.preventDefault(); void save(); }}
      >
        <BodyFields values={shown} errors={errors} onChange={change} idPrefix="inspect" />
        {serverError && <p role="alert" style={errorTextStyle}>{serverError}</p>}

        {confirmDelete && (
          <div role="group" aria-labelledby="delete-body-heading" aria-describedby="delete-body-description" style={{
            border: '1px solid ' + theme.danger,
            borderRadius: '5px',
            padding: '8px',
            marginBottom: '8px',
          }}>
            <strong id="delete-body-heading" style={{ fontSize: '12px' }}>Delete {body.name}?</strong>
            <p id="delete-body-description" style={{ fontSize: '11px', color: theme.textMuted, margin: '5px 0 8px' }}>
              This removes the body from the simulation. This action cannot be undone here.
            </p>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              <button type="button" style={btnStyle} onClick={() => setConfirmDelete(false)} disabled={busy}>Keep body</button>
              <button type="button" style={{ ...btnStyle, borderColor: theme.danger }} onClick={() => void remove()} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete body'}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
          <button type="submit" style={btnStyle} disabled={!dirty || busy}>Apply</button>
          <button type="button" style={btnStyle} onClick={() => { setDraft({}); setErrors({}); setServerError(null); }} disabled={!dirty || busy}>Revert</button>
          <button type="button" style={btnStyle} onClick={() => onFocus(body.id)}>Focus</button>
          {!confirmDelete && (
            <button type="button" style={{ ...btnStyle, borderColor: theme.danger }} onClick={() => { setConfirmDelete(true); setServerError(null); }} disabled={busy}>Delete</button>
          )}
        </div>
      </form>
    </div>
  );
};
