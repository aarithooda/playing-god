import type React from 'react';
import { theme } from './theme';

/**
 * A section inside a drawer or a floating notice. Sections inside a drawer are separated by hairlines rather than
 * boxed again, so the panel itself carries no fill of its own beyond a faint lift.
 */
export const panelStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  background: theme.surface,
  padding: `${theme.pad}px`,
  borderRadius: `${theme.radius}px`,
  border: `1px solid ${theme.border}`,
  color: theme.text,
  fontFamily: theme.font,
  fontSize: 13,
  lineHeight: 1.45,
  boxSizing: 'border-box',
};

export const btnStyle: React.CSSProperties = {
  padding: '6px 11px',
  cursor: 'pointer',
  background: theme.surfaceRaised,
  color: theme.text,
  border: `1px solid ${theme.borderStrong}`,
  borderRadius: '8px',
  fontSize: '12px',
  fontWeight: 500,
  fontFamily: theme.font,
  lineHeight: 1.3,
};

/** The one filled button style: the primary action of a section (sunlight). */
export const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: theme.accent,
  borderColor: theme.accent,
  color: theme.accentInk,
  fontWeight: 600,
};

export const inputStyle: React.CSSProperties = {
  background: 'var(--well)',
  border: `1px solid ${theme.borderStrong}`,
  color: theme.text,
  padding: '5px 7px',
  borderRadius: '7px',
  fontSize: '12.5px',
  fontFamily: theme.font,
  fontVariantNumeric: 'tabular-nums',
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

export const errorTextStyle: React.CSSProperties = { color: theme.danger, fontSize: '11.5px' };

/** Section heading inside a drawer: sentence case, medium weight; hierarchy comes from size and weight, not caps. */
export const sectionTitleStyle: React.CSSProperties = { margin: 0, fontSize: 14, fontWeight: 600, color: theme.text, letterSpacing: 0 };

/** Supporting text under a heading or a control. */
export const noteTextStyle: React.CSSProperties = { margin: 0, fontSize: 11.5, lineHeight: 1.45, color: theme.textMuted };

/** A section inside a drawer: no box of its own, separated from the previous one by a hairline. */
export const drawerSectionStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingTop: 14,
  borderTop: `1px solid ${theme.border}`,
  color: theme.text,
  fontFamily: theme.font,
  fontSize: 13,
  lineHeight: 1.45,
  boxSizing: 'border-box',
};
