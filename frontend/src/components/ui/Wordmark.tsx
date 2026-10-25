import React from 'react';
import type { Health } from '../../sim/useSimulation';
import { theme } from './theme';

const LABEL: Record<Health, string> = { unknown: 'checking…', ok: 'connected', down: 'unreachable' };
const COLOR: Record<Health, string> = { unknown: theme.textFaint, ok: theme.ok, down: theme.danger };

/** Product mark with the backend connection state. The connection is spelled out, never shown by colour alone. */
export const Wordmark: React.FC<{ health: Health }> = ({ health }) => (
  <div style={{ pointerEvents: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 12, color: theme.onSpace, textShadow: theme.onSpaceShadow }}>
    <span style={{ fontFamily: theme.serif, fontSize: 23, fontWeight: 600, letterSpacing: '0.03em', lineHeight: 1 }}>Playing God</span>
    <span
      role="status"
      aria-live="polite"
      data-testid="backend-status"
      title={`Backend: ${LABEL[health]}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: health === 'down' ? theme.danger : theme.textMuted, fontFamily: theme.font }}
    >
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: COLOR[health] }} />
      Backend: {LABEL[health]}
    </span>
  </div>
);
