import React from 'react';
import type { UniverseRole, UniverseSummaryDto } from '../../api/types';
import { formatDuration } from '../../sim/format';
import { ConfirmButton } from './ConfirmButton';
import { btnStyle, errorTextStyle, noteTextStyle, sectionTitleStyle } from './styles';
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
    <section aria-label="Universes" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={sectionTitleStyle}>Your universes</h3>
        <button type="button" style={{ ...btnStyle, padding: '4px 9px', fontSize: 11.5 }} onClick={onCreateEmpty} disabled={busy || switchDisabled}>New empty universe</button>
      </div>
      {active && (
        <div data-testid="active-universe" className="sr-only">
          <strong>{active.name}</strong>{' '}
          <span>· {ROLE_LABEL[active.role]} · active</span>
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {universes.map((u) => (
          <li key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              aria-current={u.active ? 'true' : undefined}
              aria-label={`${u.active ? 'Active universe' : 'Switch to'} ${u.name}`}
              disabled={u.active || switchDisabled}
              title={u.active ? 'This universe is active' : switchDisabled ? switchDisabledReason : `Switch to ${u.name} (it resumes at t = ${formatDuration(u.simulationTimeS)})`}
              onClick={() => onActivate(u.id)}
              style={{
                flex: 1, minWidth: 0, textAlign: 'left', padding: '8px 10px', borderRadius: 8,
                background: u.active ? theme.accentSoft : 'rgba(255,255,255,0.025)',
                border: `1px solid ${u.active ? 'rgba(235,199,127,0.4)' : theme.border}`,
                color: theme.text, display: 'flex', flexDirection: 'column', gap: 1,
                // The active universe is a disabled button only because it cannot be switched to; keep it legible.
                ...(u.active ? { opacity: 1, cursor: 'default' } : {}),
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
              <span style={{ fontSize: 11, color: u.active ? theme.accent : theme.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                {ROLE_LABEL[u.role]} · {u.active ? 'active' : `paused at t = ${formatDuration(u.simulationTimeS)}`}
              </span>
            </button>
            {!u.active && (u.role === 'sandbox' || u.role === 'preset') && (
              <ConfirmButton
                label="Delete"
                confirmLabel={`Delete ${u.name}`}
                disabled={busy || switchDisabled}
                onConfirm={() => onDelete(u.id)}
                style={{ fontSize: 11, padding: '4px 8px', background: 'transparent', borderColor: theme.border, color: theme.textMuted }}
              />
            )}
          </li>
        ))}
      </ul>
      {switchDisabled && switchDisabledReason && (
        <p role="status" style={noteTextStyle}>{switchDisabledReason}</p>
      )}
      <p style={{ ...noteTextStyle, color: theme.textFaint }}>Only the active universe advances; the others keep their exact time.</p>
      {error && (
        <p role="alert" style={{ ...errorTextStyle, margin: 0 }}>
          {error}{' '}
          <button type="button" onClick={onDismissError} style={{ ...btnStyle, fontSize: 11, padding: '2px 6px' }}>Dismiss</button>
        </p>
      )}
    </section>
  );
};
