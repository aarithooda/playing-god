import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ScopedClient } from '../../api/client';
import type { SnapshotSummaryDto } from '../../api/types';
import { formatDuration } from '../../sim/format';
import { ConfirmButton } from './ConfirmButton';
import { btnStyle, errorTextStyle, inputStyle, drawerSectionStyle } from './styles';
import { theme } from './theme';

interface SnapshotPanelProps {
  client: ScopedClient;
  /** Not usable now (history view, load error, a baseline run): the reason is shown instead of the controls. */
  blockedReason?: string;
  disabled: boolean;
  /** Called before a restore so a running Play loop stops first. */
  onBeforeRestore: () => void;
  /** Called after a successful restore: the workspace re-reads the universe. */
  onRestored: () => void;
  onBusyChange: (busy: boolean) => void;
  /** A refusal that means the scope is out of date (stale epoch, universe gone). */
  onError?: (e: unknown) => void;
}

/** Save, restore and delete in-memory snapshots of this universe. Snapshots last until the backend restarts. */
export const SnapshotPanel: React.FC<SnapshotPanelProps> = ({
  client, blockedReason, disabled, onBeforeRestore, onRestored, onBusyChange, onError,
}) => {
  const [items, setItems] = useState<SnapshotSummaryDto[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const list = await client.listSnapshots();
      if (mounted.current) setItems(list);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [client]);
  useEffect(() => void load(), [load]);

  const run = async (task: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await task();
      after?.();
      await load();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
      onError?.(e);
    } finally {
      if (mounted.current) setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <section aria-label="Snapshots" style={{ ...drawerSectionStyle, width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Snapshots</h3>
      {blockedReason ? (
        <p style={{ margin: 0, fontSize: 11, color: theme.textMuted }}>{blockedReason}</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              aria-label="Snapshot name"
              placeholder="name (optional)"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
            <button
              type="button"
              style={btnStyle}
              disabled={disabled || busy}
              onClick={() => void run(() => client.createSnapshot(name.trim() || undefined), () => setName(''))}
            >
              Save
            </button>
          </div>
          {items.length === 0 ? (
            <p style={{ margin: 0, fontSize: 11, color: theme.textMuted }}>No snapshots yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((s) => (
                <li key={s.id} data-testid="snapshot-item" style={{ fontSize: 12 }}>
                  <div>{s.name}</div>
                  <div style={{ color: theme.textMuted, fontSize: 11 }}>
                    t = {formatDuration(s.simulationTimeS)} · {s.bodyCount} bodies{s.controlled ? '' : ' · uncontrolled'}
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                    <ConfirmButton
                      label="Restore"
                      confirmLabel="Restore (discards the current state)"
                      disabled={disabled || busy}
                      onConfirm={() => {
                        onBeforeRestore();
                        void run(() => client.restoreSnapshot(s.id), onRestored);
                      }}
                    />
                    <button type="button" style={btnStyle} disabled={disabled || busy} onClick={() => void run(() => client.deleteSnapshot(s.id))}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p style={{ margin: 0, fontSize: 11, color: theme.textMuted }}>Snapshots are kept in backend memory and are lost when it restarts.</p>
        </>
      )}
      {error && <p role="alert" style={{ ...errorTextStyle, margin: 0 }}>{error}</p>}
    </section>
  );
};
