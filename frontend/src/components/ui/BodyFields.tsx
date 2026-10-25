import React from 'react';
import type { BodyKind, BodyType } from '../../api/types';
import type { FieldErrors, FieldKey, FormValues } from '../../sim/validation';
import { displayRadiusUnits, type SizeMode } from '../../sim/renderTransform';
import { btnStyle, errorTextStyle, inputStyle, labelStyle } from './styles';
import { theme } from './theme';

interface BodyFieldsProps {
  values: FormValues;
  errors: FieldErrors;
  onChange: (key: FieldKey, value: string) => void;
  idPrefix: string;
  onPickPosition?: () => void;
  isPickingPosition?: boolean;
  /** When given, a star / planet physics-role selector is shown. */
  kind?: BodyKind;
  /** Renderer class from the catalogue, separate from the star/planet physics role. */
  bodyType?: BodyType;
  onKindChange?: (kind: BodyKind) => void;
  /** The radius actually drawn in the scene (after the crowding adjustment); when it is smaller than the nominal one the readout says so. */
  drawnRadiusUnits?: number;
  sizeMode?: SizeMode;
}

const SCALARS: Array<{ key: FieldKey; label: string; unit: string }> = [
  { key: 'mass', label: 'Mass (kg)', unit: 'kg' },
  { key: 'radius', label: 'Physical radius (m)', unit: 'm' },
];
const VECTORS: Array<{ label: string; unit: string; keys: [FieldKey, FieldKey, FieldKey] }> = [
  { label: 'Position (m): X, Y, Z', unit: 'm', keys: ['px', 'py', 'pz'] },
  { label: 'Velocity (m/s): X, Y, Z', unit: 'm/s', keys: ['vx', 'vy', 'vz'] },
];

/** Property rows shared by the create form and the inspector. Every value is SI, with its unit beside it. */
export const BodyFields: React.FC<BodyFieldsProps> = ({ values, errors, onChange, idPrefix, onPickPosition, isPickingPosition = false, kind, bodyType, onKindChange, drawnRadiusUnits, sizeMode }) => (
  <>
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Identity</legend>
      <div style={rowStyle}>
        <label style={labelStyle} htmlFor={idPrefix + '-name'}>Name</label>
        <input id={idPrefix + '-name'} style={inputStyle} value={values.name} aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? idPrefix + '-name-error' : undefined}
          onChange={(e) => onChange('name', e.target.value)} />
      </div>
      {errors.name && <span id={idPrefix + '-name-error'} role="alert" style={rowErrorStyle}>{errors.name}</span>}
      {kind !== undefined && onKindChange && (
        <div style={rowStyle}>
          <label style={labelStyle} htmlFor={idPrefix + '-kind'}>Physics role</label>
          <select id={idPrefix + '-kind'} style={inputStyle} value={kind}
            onChange={(e) => onKindChange(e.target.value === 'star' ? 'star' : 'planet')}>
            <option value="planet">Planet</option>
            <option value="star">Star</option>
          </select>
        </div>
      )}
      {bodyType && (
        <div style={rowStyle}>
          <span style={labelStyle}>Object class</span>
          <span style={{ fontSize: 12.5, textTransform: 'capitalize', padding: '5px 0' }}>{bodyType.replace(/-/g, ' ')}</span>
        </div>
      )}
      <div style={rowStyle}>
        <label style={labelStyle} htmlFor={idPrefix + '-color'}>Color</label>
        <div style={{ display: 'flex', gap: '6px', minWidth: 0 }}>
          <input type="color" aria-label="Color picker" value={/^#[0-9a-fA-F]{6}$/.test(values.color) ? values.color : '#ffffff'}
            onChange={(e) => onChange('color', e.target.value)}
            style={{ ...inputStyle, width: '30px', flex: '0 0 30px', height: 28, padding: 2, cursor: 'pointer' }} />
          <input id={idPrefix + '-color'} style={inputStyle} value={values.color} aria-invalid={Boolean(errors.color)}
            aria-describedby={errors.color ? idPrefix + '-color-error' : undefined}
            onChange={(e) => onChange('color', e.target.value)} />
        </div>
      </div>
      {errors.color && <span id={idPrefix + '-color-error'} role="alert" style={rowErrorStyle}>{errors.color}</span>}
    </fieldset>

    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Physical properties</legend>
      {SCALARS.map(({ key, label, unit }) => (
        <React.Fragment key={key}>
          <div style={rowStyle}>
            <label style={labelStyle} htmlFor={idPrefix + '-' + key}>{label}</label>
            <div style={unitWrapStyle}>
              <input id={idPrefix + '-' + key} style={inputStyle} inputMode="decimal" value={values[key]}
                aria-invalid={Boolean(errors[key])}
                aria-describedby={errors[key] ? idPrefix + '-' + key + '-error' : undefined}
                onChange={(e) => onChange(key, e.target.value)} />
              <span aria-hidden="true" style={unitStyle}>{unit}</span>
            </div>
          </div>
          {errors[key] && <span id={idPrefix + '-' + key + '-error'} role="alert" style={rowErrorStyle}>{errors[key]}</span>}
        </React.Fragment>
      ))}
      <p style={helperStyle}>Physical radius is used by the simulation. {sizeMode !== undefined ? 'Bodies are drawn at true scale and enlarged on screen only to stay visible (Universe and Exploration views in the bar).' : 'The rendered visual radius is exaggerated independently for visibility.'}</p>
      <p data-testid={idPrefix + '-visual-radius'} style={helperStyle}>{visualRadiusReadout(values.radius, drawnRadiusUnits, sizeMode)}</p>
    </fieldset>

    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Position and motion</legend>
      {VECTORS.map(({ label, unit, keys }) => (
        <div style={{ marginBottom: 8 }} key={label}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
            <span style={labelStyle}>{label.split(':')[0]}</span>
            {keys[0] === 'px' && onPickPosition && (
              <button type="button"
                style={{
                  ...btnStyle, padding: '4px 9px', fontSize: 11.5,
                  borderColor: isPickingPosition ? theme.accent : theme.borderStrong,
                  background: isPickingPosition ? theme.accentSoft : theme.surfaceRaised,
                  color: isPickingPosition ? theme.accent : theme.text,
                }}
                aria-pressed={isPickingPosition} onClick={onPickPosition}>
                {isPickingPosition ? 'Cancel 3D placement' : 'Choose position in 3D'}
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '5px' }}>
            {keys.map((k, i) => (
              <div key={k} style={{ position: 'relative', minWidth: 0 }}>
                <span aria-hidden="true" style={axisTagStyle}>{'xyz'[i]}</span>
                <input aria-label={label.split(':')[0] + ' ' + 'XYZ'[i]}
                  aria-invalid={Boolean(errors[k])}
                  aria-describedby={errors[k] ? idPrefix + '-' + k + '-error' : undefined}
                  title={`${'XYZ'[i]} (${unit})`}
                  style={{ ...inputStyle, paddingLeft: 17, paddingRight: 4, fontSize: 11.5 }} inputMode="decimal" value={values[k]}
                  onChange={(e) => onChange(k, e.target.value)} />
              </div>
            ))}
          </div>
          {keys.map((k) => errors[k] && <span id={idPrefix + '-' + k + '-error'} key={k} role="alert" style={{ ...rowErrorStyle, display: 'block' }}>{errors[k]}</span>)}
        </div>
      ))}
    </fieldset>
  </>
);

function visualRadiusReadout(radiusText: string, drawnRadiusUnits?: number, sizeMode?: SizeMode): string {
  const radiusM = Number(radiusText);
  if (!Number.isFinite(radiusM) || radiusM <= 0) return 'Visual radius preview unavailable until physical radius is valid.';
  if (sizeMode !== undefined && drawnRadiusUnits !== undefined) {
    return `Rendered visual radius: ${drawnRadiusUnits.toPrecision(2)} scene units (true physical scale; enlarged on screen only as far as needed to stay visible).`;
  }
  const nominal = displayRadiusUnits(radiusM);
  if (drawnRadiusUnits !== undefined && drawnRadiusUnits < nominal * 0.99) {
    return `Rendered visual radius: ${drawnRadiusUnits.toPrecision(2)} scene units (display only; reduced from ${nominal.toFixed(2)} so nearby bodies do not overlap).`;
  }
  return `Rendered visual radius: ${nominal.toFixed(2)} scene units (display only).`;
}

const sectionStyle: React.CSSProperties = { border: 0, borderTop: `1px solid ${theme.border}`, padding: '10px 0 4px', margin: 0, minWidth: 0 };
const legendStyle: React.CSSProperties = { color: theme.text, fontSize: 12, fontWeight: 600, padding: '0 8px 0 0' };
const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '42% minmax(0, 1fr)', alignItems: 'center', gap: 8, marginBottom: 6 };
const unitWrapStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 };
const unitStyle: React.CSSProperties = { fontSize: 11, color: theme.textFaint, flex: '0 0 auto', minWidth: 14 };
const axisTagStyle: React.CSSProperties = { position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', fontSize: 10.5, color: theme.textFaint, pointerEvents: 'none' };
const rowErrorStyle: React.CSSProperties = { ...errorTextStyle, display: 'block', margin: '-2px 0 6px 42%' };
const helperStyle: React.CSSProperties = { color: theme.textMuted, fontSize: '11px', lineHeight: 1.45, margin: '2px 0 6px' };
