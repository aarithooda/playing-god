import React from 'react';
import type { FieldErrors, FieldKey, FormValues } from '../../sim/validation';
import { displayRadiusUnits } from '../../sim/renderTransform';
import { btnStyle, errorTextStyle, fieldGroup, inputStyle, labelStyle } from './styles';

interface BodyFieldsProps {
  values: FormValues;
  errors: FieldErrors;
  onChange: (key: FieldKey, value: string) => void;
  idPrefix: string;
  onPickPosition?: () => void;
  isPickingPosition?: boolean;
}

const SCALARS: Array<{ key: FieldKey; label: string }> = [
  { key: 'mass', label: 'Mass (kg)' },
  { key: 'radius', label: 'Physical radius (m)' },
];
const VECTORS: Array<{ label: string; keys: [FieldKey, FieldKey, FieldKey] }> = [
  { label: 'Position (m): X, Y, Z', keys: ['px', 'py', 'pz'] },
  { label: 'Velocity (m/s): X, Y, Z', keys: ['vx', 'vy', 'vz'] },
];

export const BodyFields: React.FC<BodyFieldsProps> = ({ values, errors, onChange, idPrefix, onPickPosition, isPickingPosition = false }) => (
  <>
    <fieldset style={sectionStyle}>
      <legend style={sectionTitleStyle}>Identity and appearance</legend>
      <div style={fieldGroup}>
        <label style={labelStyle} htmlFor={idPrefix + '-name'}>Name</label>
        <input id={idPrefix + '-name'} style={inputStyle} value={values.name} aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? idPrefix + '-name-error' : undefined}
          onChange={(e) => onChange('name', e.target.value)} />
        {errors.name && <span id={idPrefix + '-name-error'} role="alert" style={errorTextStyle}>{errors.name}</span>}
      </div>
      <div style={fieldGroup}>
        <label style={labelStyle} htmlFor={idPrefix + '-color'}>Color</label>
        <div style={{ display: 'flex', gap: '5px' }}>
          <input type="color" aria-label="Color picker" value={/^#[0-9a-fA-F]{6}$/.test(values.color) ? values.color : '#ffffff'}
            onChange={(e) => onChange('color', e.target.value)} style={{ ...inputStyle, width: '40px', padding: 0 }} />
          <input id={idPrefix + '-color'} style={inputStyle} value={values.color} aria-invalid={Boolean(errors.color)}
            aria-describedby={errors.color ? idPrefix + '-color-error' : undefined}
            onChange={(e) => onChange('color', e.target.value)} />
        </div>
        {errors.color && <span id={idPrefix + '-color-error'} role="alert" style={errorTextStyle}>{errors.color}</span>}
      </div>
    </fieldset>

    <fieldset style={sectionStyle}>
      <legend style={sectionTitleStyle}>Physical properties</legend>
      {SCALARS.map(({ key, label }) => (
        <div style={fieldGroup} key={key}>
          <label style={labelStyle} htmlFor={idPrefix + '-' + key}>{label}</label>
          <input id={idPrefix + '-' + key} style={inputStyle} inputMode="decimal" value={values[key]}
            aria-invalid={Boolean(errors[key])}
            aria-describedby={errors[key] ? idPrefix + '-' + key + '-error' : undefined}
            onChange={(e) => onChange(key, e.target.value)} />
          {errors[key] && <span id={idPrefix + '-' + key + '-error'} role="alert" style={errorTextStyle}>{errors[key]}</span>}
        </div>
      ))}
      <p style={helperStyle}>Physical radius is used by the simulation. The rendered visual radius is exaggerated independently for visibility.</p>
      <p data-testid={idPrefix + '-visual-radius'} style={helperStyle}>{visualRadiusReadout(values.radius)}</p>
    </fieldset>

    <fieldset style={sectionStyle}>
      <legend style={sectionTitleStyle}>Position and motion</legend>
      {VECTORS.map(({ label, keys }) => (
        <div style={fieldGroup} key={label}>
          <span style={labelStyle}>{label}</span>
          {keys[0] === 'px' && onPickPosition && (
            <button type="button"
              style={{ ...btnStyle, borderColor: isPickingPosition ? '#5aa2ff' : '#3a4656', background: isPickingPosition ? '#23406b' : '#182029' }}
              aria-pressed={isPickingPosition} onClick={onPickPosition}>
              {isPickingPosition ? 'Cancel 3D placement' : 'Choose position in 3D'}
            </button>
          )}
          <div style={{ display: 'flex', gap: '5px' }}>
            {keys.map((k, i) => (
              <input key={k} aria-label={label.split(':')[0] + ' ' + 'XYZ'[i]}
                aria-invalid={Boolean(errors[k])}
                aria-describedby={errors[k] ? idPrefix + '-' + k + '-error' : undefined}
                style={inputStyle} inputMode="decimal" value={values[k]}
                onChange={(e) => onChange(k, e.target.value)} />
            ))}
          </div>
          {keys.map((k) => errors[k] && <span id={idPrefix + '-' + k + '-error'} key={k} role="alert" style={errorTextStyle}>{errors[k]}</span>)}
        </div>
      ))}
    </fieldset>
  </>
);

function visualRadiusReadout(radiusText: string): string {
  const radiusM = Number(radiusText);
  if (!Number.isFinite(radiusM) || radiusM <= 0) return 'Visual radius preview unavailable until physical radius is valid.';
  return `Rendered visual radius: ${displayRadiusUnits(radiusM).toFixed(2)} scene units (display only).`;
}

const sectionStyle: React.CSSProperties = { border: '1px solid #2b3542', borderRadius: '5px', padding: '8px', margin: '0 0 8px', minWidth: 0 };
const sectionTitleStyle: React.CSSProperties = { color: '#c6d0da', fontSize: '11px', padding: '0 4px' };
const helperStyle: React.CSSProperties = { color: '#9aa7b5', fontSize: '10px', lineHeight: 1.4, margin: '0 0 7px' };
