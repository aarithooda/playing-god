import React from 'react';
import type { Health } from '../../sim/useSimulation';
import { theme } from './theme';

const LABEL: Record<Health, string> = { unknown: 'checking…', ok: 'connected', down: 'unreachable' };
const COLOR: Record<Health, string> = { unknown: theme.textMuted, ok: theme.ok, down: theme.danger };

/** Compact product mark with the backend connection state. */
export const Wordmark: React.FC<{ health: Health }> = ({ health }) => (
  <div style={{
    pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, padding: '6px 12px',
    background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: theme.radius,
    color: theme.text, fontFamily: theme.font,
  }}>
    <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 2 }}>PLAYING GOD</span>
    <span role="status" aria-live="polite" data-testid="backend-status" title={`Backend: ${LABEL[health]}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: theme.textMuted }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: COLOR[health] }} />
      Backend: {LABEL[health]}
    </span>
  </div>
);
