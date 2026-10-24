import type React from 'react';
import { theme } from './theme';

/** A solid panel section: used for each block inside a sidebar and for floating notices. */
export const panelStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  background: theme.surface,
  padding: `${theme.pad}px`,
  borderRadius: `${theme.radius}px`,
  border: `1px solid ${theme.border}`,
  color: theme.text,
  fontFamily: theme.font,
  boxSizing: 'border-box',
};

export const btnStyle: React.CSSProperties = {
  padding: '5px 10px',
  cursor: 'pointer',
  background: theme.surfaceRaised,
  color: theme.text,
  border: `1px solid ${theme.borderStrong}`,
  borderRadius: '4px',
  fontSize: '12px',
  fontFamily: theme.font,
};

export const inputStyle: React.CSSProperties = {
  background: theme.bg,
  border: `1px solid ${theme.borderStrong}`,
  color: theme.text,
  padding: '4px',
  borderRadius: '4px',
  fontSize: '13px',
  fontFamily: theme.mono,
  minWidth: 0,
  width: '100%',
  boxSizing: 'border-box',
};

export const labelStyle: React.CSSProperties = { fontSize: '12px', color: theme.textMuted };

export const fieldGroup: React.CSSProperties = {
  marginBottom: '10px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

export const errorTextStyle: React.CSSProperties = { color: theme.danger, fontSize: '11px' };
