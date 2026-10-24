import React from 'react';
import type { BodyKind } from '../../api/types';
import type { FieldErrors, FieldKey, FormValues } from '../../sim/validation';
import { btnStyle, errorTextStyle, fieldGroup, inputStyle, labelStyle } from './styles';

interface BodyFieldsProps {
  /** Value shown for each field (draft if the user edited it, otherwise the confirmed value). */
  values: FormValues;
  errors: FieldErrors;
  onChange: (key: FieldKey, value: string) => void;
  idPrefix: string;
  onPickPosition?: () => void;
  isPickingPosition?: boolean;
  /** When given, a "Type" (star / planet) selector is shown. */
  kind?: BodyKind;
  onKindChange?: (kind: BodyKind) => void;
}

const SCALARS: Array<{ key: FieldKey; label: string }> = [
  { key: 'mass', label: 'Mass (kg)' },
  { key: 'radius', label: 'Radius (m)' },
];

const VECTORS: Array<{ label: string; keys: [FieldKey, FieldKey, FieldKey] }> = [
  { label: 'Position (m): X, Y, Z', keys: ['px', 'py', 'pz'] },
  { label: 'Velocity (m/s): X, Y, Z', keys: ['vx', 'vy', 'vz'] },
];

/** Shared SI-unit fields for the create form and the inspector. Numbers are entered as plain text so 1.5e11 works. */
export const BodyFields: React.FC<BodyFieldsProps> = ({ values, errors, onChange, idPrefix, onPickPosition, isPickingPosition = false, kind, onKindChange }) => (
  <>
    <div style={fieldGroup}>
      <label style={labelStyle} htmlFor={`${idPrefix}-name`}>Name</label>
      <input
        id={`${idPrefix}-name`}
        style={inputStyle}
        value={values.name}
        onChange={(e) => onChange('name', e.target.value)}
      />
      {errors.name && <span style={errorTextStyle}>{errors.name}</span>}
    </div>

    {kind !== undefined && onKindChange && (
      <div style={fieldGroup}>
        <label style={labelStyle} htmlFor={`${idPrefix}-kind`}>Type</label>
        <select
          id={`${idPrefix}-kind`}
          style={inputStyle}
          value={kind}
          onChange={(e) => onKindChange(e.target.value === 'star' ? 'star' : 'planet')}
        >
          <option value="planet">Planet</option>
          <option value="star">Star</option>
        </select>
      </div>
    )}

    {SCALARS.map(({ key, label }) => (
      <div style={fieldGroup} key={key}>
        <label style={labelStyle} htmlFor={`${idPrefix}-${key}`}>{label}</label>
        <input
          id={`${idPrefix}-${key}`}
          style={inputStyle}
          inputMode="decimal"
          value={values[key]}
          onChange={(e) => onChange(key, e.target.value)}
        />
        {key === 'radius' && (
          <span style={{ ...labelStyle, fontSize: '11px' }}>
            Physical radius (used for collisions). The 3D view draws it exaggerated for visibility.
          </span>
        )}
        {errors[key] && <span style={errorTextStyle}>{errors[key]}</span>}
      </div>
    ))}

    {VECTORS.map(({ label, keys }) => (
      <div style={fieldGroup} key={label}>
        <span style={labelStyle}>{label}</span>
        {keys[0] === 'px' && onPickPosition && (
          <button
            type="button"
            style={{ ...btnStyle, borderColor: isPickingPosition ? '#5aa2ff' : '#3a4656', background: isPickingPosition ? '#23406b' : '#182029' }}
            aria-pressed={isPickingPosition}
            onClick={onPickPosition}
          >
            {isPickingPosition ? 'Cancel 3D placement' : 'Choose position in 3D'}
          </button>
        )}
        <div style={{ display: 'flex', gap: '5px' }}>
          {keys.map((k, i) => (
            <input
              key={k}
              aria-label={`${label.split(':')[0]} ${'XYZ'[i]}`}
              style={inputStyle}
              inputMode="decimal"
              value={values[k]}
              onChange={(e) => onChange(k, e.target.value)}
            />
          ))}
        </div>
        {keys.map((k) => errors[k] && <span key={k} style={errorTextStyle}>{errors[k]}</span>)}
      </div>
    ))}

    <div style={fieldGroup}>
      <label style={labelStyle} htmlFor={`${idPrefix}-color`}>Color</label>
      <div style={{ display: 'flex', gap: '5px' }}>
        <input
          type="color"
          aria-label="Color picker"
          value={/^#[0-9a-fA-F]{6}$/.test(values.color) ? values.color : '#ffffff'}
          onChange={(e) => onChange('color', e.target.value)}
          style={{ ...inputStyle, width: '40px', padding: 0 }}
        />
        <input
          id={`${idPrefix}-color`}
          style={inputStyle}
          value={values.color}
          onChange={(e) => onChange('color', e.target.value)}
        />
      </div>
      {errors.color && <span style={errorTextStyle}>{errors.color}</span>}
    </div>
  </>
);
