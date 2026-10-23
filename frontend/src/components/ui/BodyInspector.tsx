import React, { useEffect, useState } from 'react';
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

interface BodyInspectorProps {
  /** Confirmed backend state of the selected body (null when nothing is selected). */
  body: BodyView | null;
  onSave: (id: string, patch: BodyUpdateDto) => Promise<ActionResult>;
  onDelete: (id: string) => Promise<ActionResult>;
  onFocus: (id: string) => void;
}

/**
 * Edits go into a draft that holds only the fields the user changed; every other field follows the
 * confirmed (live) backend value. Saving sends a PATCH and clears the draft; the shown values then come
 * from the refreshed authoritative state, never from the draft.
 */
export const BodyInspector: React.FC<BodyInspectorProps> = ({ body, onSave, onDelete, onFocus }) => {
  const [draft, setDraft] = useState<Partial<FormValues>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bodyId = body?.id;
  useEffect(() => {
    setDraft({});
    setErrors({});
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
    const result = await onDelete(body.id);
    setBusy(false);
    if (!result.ok) setServerError(result.error);
  };

  return (
    <div style={{ ...panelStyle, position: 'absolute', bottom: '20px', right: '20px', width: '280px', maxHeight: 'calc(100vh - 310px)', minHeight: '200px', overflowY: 'auto' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Body Inspector</h3>
      <p style={{ fontSize: '11px', opacity: 0.55, margin: '0 0 10px 0' }}>
        {body.id} · speed {formatNumber(body.speedMPerS)} m/s · SI units
      </p>

      <BodyFields values={shown} errors={errors} onChange={change} idPrefix="inspect" />

      {serverError && <p role="alert" style={errorTextStyle}>{serverError}</p>}

      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
        <button style={btnStyle} onClick={save} disabled={!dirty || busy}>Apply</button>
        <button style={btnStyle} onClick={() => { setDraft({}); setErrors({}); setServerError(null); }} disabled={!dirty || busy}>Revert</button>
        <button style={btnStyle} onClick={() => onFocus(body.id)}>Focus</button>
        <button style={{ ...btnStyle, borderColor: '#a33' }} onClick={remove} disabled={busy}>Delete</button>
      </div>
    </div>
  );
};
