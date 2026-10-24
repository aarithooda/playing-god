import React from 'react';
import type { UniverseRole, UniverseSummaryDto } from '../../api/types';
import { formatDuration } from '../../sim/format';
import { ConfirmButton } from './ConfirmButton';
import { btnStyle, errorTextStyle, panelStyle } from './styles';
import { theme } from './theme';

const ROLE_LABEL: Record<UniverseRole, string> = {
  sandbox: 'sandbox',
  preset: 'preset',
  baseline: 'Orbit Lab baseline',
  modified: 'Orbit Lab modified run',
};

interface UniverseSwitcherProps {
  universes: readonly UniverseSummaryDto[];
  /** Switching is blocked (a write is in flight, or the list is being resynced). */
  switchDisabled: boolean;
  switchDisabledReason?: string;
  busy: boolean;
  error: string | null;
  onActivate: (id: string) => void;
  onCreateEmpty: () => void;
  onDelete: (id: string) => void;
  onDismissError: () => void;
}

/** Lists the universes, says which one is active, and switches between them. Only the active one advances. */
export const UniverseSwitcher: React.FC<UniverseSwitcherProps> = ({
  universes, switchDisabled, switchDisabledReason, busy, error, onActivate, onCreateEmpty, onDelete, onDismissError,
}) => {
  const active = universes.find((u) => u.active);
  return (
    <section aria-label="Universes" style={{ ...panelStyle, width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Universe</h3>
      {active && (
        <div data-testid="active-universe" style={{ fontSize: 12 }}>
          <strong>{active.name}</strong>{' '}
          <span style={{ color: theme.textMuted }}>· {ROLE_LABEL[active.role]} · active</span>
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {universes.map((u) => (
          <li key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'space-between' }}>
            <button
              type="button"
              aria-current={u.active ? 'true' : undefined}
              aria-label={`${u.active ? 'Active universe' : 'Switch to'} ${u.name}`}
              disabled={u.active || switchDisabled}
              title={u.active ? 'This universe is active' : switchDisabled ? switchDisabledReason : `Switch to ${u.name} (it resumes at t = ${formatDuration(u.simulationTimeS)})`}
              onClick={() => onActivate(u.id)}
              style={{
                ...btnStyle, flex: 1, textAlign: 'left', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', borderColor: u.active ? theme.accent : theme.borderStrong,
              }}
            >
              {u.name}
              <span style={{ color: theme.textMuted }}> · {u.active ? 'active' : `t = ${formatDuration(u.simulationTimeS)}`}</span>
            </button>
            {!u.active && (u.role === 'sandbox' || u.role === 'preset') && (
              <ConfirmButton
                label="Delete"
                confirmLabel={`Delete ${u.name}`}
                disabled={busy || switchDisabled}
                onConfirm={() => onDelete(u.id)}
                style={{ fontSize: 11, padding: '3px 6px' }}
              />
            )}
          </li>
        ))}
      </ul>
      {switchDisabled && switchDisabledReason && (
        <p role="status" style={{ margin: 0, fontSize: 11, color: theme.textMuted }}>{switchDisabledReason}</p>
      )}
      <button type="button" style={btnStyle} onClick={onCreateEmpty} disabled={busy || switchDisabled}>New empty universe</button>
      {error && (
        <p role="alert" style={{ ...errorTextStyle, margin: 0 }}>
          {error}{' '}
          <button type="button" onClick={onDismissError} style={{ ...btnStyle, fontSize: 11, padding: '2px 6px' }}>dismiss</button>
        </p>
      )}
    </section>
  );
};
