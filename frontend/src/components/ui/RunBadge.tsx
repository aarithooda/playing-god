import React from 'react';
import type { ModificationDto } from '../../api/types';
import { formatDuration } from '../../sim/format';
import { panelStyle } from './styles';
import { theme } from './theme';

interface RunBadgeProps {
  role: 'baseline' | 'modified';
  /** The recorded modification of the experiment (needed for the factor in the modified run's label). */
  modification: ModificationDto | null;
  controlled: boolean;
  firstUncontrolledAtS: number | null;
}

/** Names the active Orbit Lab run so the baseline and the modified run are never confused. */
export const RunBadge: React.FC<RunBadgeProps> = ({ role, modification, controlled, firstUncontrolledAtS }) => {
  const label = role === 'baseline'
    ? 'Orbit Lab · BASELINE'
    : `Orbit Lab · MODIFIED ×${modification ? modification.speedFactor.toFixed(2) : '?'} speed`;
  const accent = role === 'baseline' ? theme.accent : theme.warn;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div data-testid="run-badge" style={{ ...panelStyle, padding: '4px 10px', fontSize: 12, fontWeight: 600, letterSpacing: 1, borderColor: accent, color: accent }}>
        {label}
      </div>
      {!controlled && (
        <div
          role="status"
          data-testid="run-uncontrolled"
          style={{ ...panelStyle, padding: '4px 10px', fontSize: 12, borderColor: theme.danger, color: theme.danger }}
        >
          {`Uncontrolled since t = ${firstUncontrolledAtS === null ? '?' : formatDuration(firstUncontrolledAtS)}`}
        </div>
      )}
    </div>
  );
};
