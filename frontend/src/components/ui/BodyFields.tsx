import React from 'react';
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
export const BodyFields: React.FC<BodyFieldsProps> = ({ values, errors, onChange, idPrefix, onPickPosition, isPickingPosition = false }) => (
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
        {errors[key] && <span style={errorTextStyle}>{errors[key]}</span>}
      </div>
    ))}

    {VECTORS.map(({ label, keys }) => (
      <div style={fieldGroup} key={label}>
        <span style={labelStyle}>{label}</span>
        {keys[0] === 'px' && onPickPosition && (
          <button
            type="button"
            style={{ ...btnStyle, borderColor: isPickingPosition ? '#b9c5d4' : '#555', background: isPickingPosition ? '#4b5563' : '#333' }}
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
