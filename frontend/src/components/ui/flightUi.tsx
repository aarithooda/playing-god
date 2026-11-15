// Small shared pieces of the mission-design panels (labelled number fields, fact rows, the mission status badge).
import React from 'react';
import type { MissionStatus } from '../../api/types';
import { errorTextStyle, inputStyle, labelStyle, noteTextStyle } from './styles';
import { theme } from './theme';

export const NumberField: React.FC<{
  id: string; label: string; unit?: string; value: string; onChange: (value: string) => void; hint?: string; disabled?: boolean; invalid?: boolean;
}> = ({ id, label, unit, value, onChange, hint, disabled = false, invalid = false }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
    <label htmlFor={id} style={labelStyle}>{label}{unit ? <span style={{ color: theme.textFaint }}> ({unit})</span> : null}</label>
    <input id={id} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={value} disabled={disabled}
      aria-invalid={invalid} onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, ...(invalid ? { borderColor: theme.danger } : {}), ...(disabled ? { opacity: 0.55 } : {}) }} />
    {hint && <span style={{ ...noteTextStyle, fontSize: 10.5 }}>{hint}</span>}
  </div>
);

export const SelectField: React.FC<{
  id: string; label: string; value: string; onChange: (value: string) => void; options: readonly { value: string; label: string }[]; disabled?: boolean;
}> = ({ id, label, value, onChange, options, disabled = false }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
    <label htmlFor={id} style={labelStyle}>{label}</label>
    <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

export const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px' };

/** A label / value row of a fact list. */
export const Fact: React.FC<{ label: string; value: React.ReactNode; testId?: string; tone?: 'ok' | 'danger' | 'muted' }> = ({ label, value, testId, tone }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, lineHeight: 1.5 }}>
    <dt style={{ color: theme.textMuted, flex: '0 0 auto' }}>{label}</dt>
    <dd data-testid={testId} style={{
      margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: 0,
      color: tone === 'ok' ? theme.ok : tone === 'danger' ? theme.danger : tone === 'muted' ? theme.textMuted : theme.text,
    }}>{value}</dd>
  </div>
);

export const Facts: React.FC<{ children: React.ReactNode; label?: string }> = ({ children, label }) => (
  <dl aria-label={label} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</dl>
);

const STATUS: Record<MissionStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: theme.textMuted },
  planned: { label: 'Planned', color: theme.info },
  in_progress: { label: 'In progress', color: theme.accent },
  completed: { label: 'Completed', color: theme.ok },
  failed: { label: 'Unsuccessful', color: theme.danger },
  unsupported: { label: 'Unsupported', color: theme.warn },
};

/** The mission's status in words. "Planned" is never shown for something that has flown, nor "Completed" for a plan. */
export const MissionStatusBadge: React.FC<{ status: MissionStatus; committed: boolean }> = ({ status, committed }) => {
  const s = STATUS[status];
  const label = status === 'planned' ? (committed ? 'Planned · scheduled' : 'Planned · proposal') : s.label;
  return (
    <span data-testid="mission-status" data-status={status} style={{
      fontSize: 10.5, fontWeight: 600, letterSpacing: 0.2, color: s.color, border: `1px solid ${s.color}`, borderRadius: 999,
      padding: '1px 8px', lineHeight: '16px', whiteSpace: 'nowrap',
    }}>{label}</span>
  );
};

export const ErrorText: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  children ? <p role="alert" style={{ ...errorTextStyle, margin: 0 }}>{children}</p> : null
);

/** The small diamond that stands for a spacecraft everywhere in the panels (the same shape as its marker in the scene). */
export const CraftGlyph: React.FC<{ color: string; size?: number }> = ({ color, size = 12 }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 12 12" style={{ flex: '0 0 auto' }}>
    <path d="M6 0.8 11.2 6 6 11.2 0.8 6Z" fill={color} stroke="#05070c" strokeWidth="0.6" />
  </svg>
);
