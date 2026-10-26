import React from 'react';
import type { CollisionDetailDto, ReplayReportDto } from '../../api/types';
import { describeRecord, describeReplay, hasSoftFidelity } from '../../sim/collision/describe';
import { btnStyle, drawerSectionStyle } from './styles';
import { theme } from './theme';

interface CollisionInspectorProps {
  eventId: string;
  detail: CollisionDetailDto | null;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  replay: ReplayReportDto | null;
  replayBusy: boolean;
  bodyName: (id: string) => string;
  onReplay: () => void;
  onOpenEvent: (eventId: string) => void;
  onClose: () => void;
}

const small: React.CSSProperties = { fontSize: '11px', color: theme.textMuted, margin: '2px 0' };

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: '8px' }}>
      <strong style={{ fontSize: '11.5px' }}>{title}</strong>
      <ul style={{ margin: '2px 0 0 0', paddingLeft: '16px' }}>
        {items.map((t, i) => (
          <li key={`${i}:${t}`} style={small}>
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Developer-facing inspection of one collision record (spec 10.2). Every text comes from API fields (see sim/collision/describe.ts). */
export const CollisionInspector: React.FC<CollisionInspectorProps> = ({
  eventId,
  detail,
  status,
  error,
  replay,
  replayBusy,
  bodyName,
  onReplay,
  onOpenEvent,
  onClose,
}) => {
  return (
    <section
      aria-labelledby="collision-inspector-heading"
      style={{ ...drawerSectionStyle, width: '100%', marginTop: '10px' }}
      data-testid="collision-inspector"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h3 id="collision-inspector-heading" style={{ margin: 0, fontSize: '14px' }}>
          Collision {eventId}
        </h3>
        <button type="button" onClick={onClose} aria-label="Close collision inspector" style={{ ...btnStyle, fontSize: '11px', padding: '3px 9px' }}>
          Close
        </button>
      </div>
      {status === 'loading' && <p style={small}>Loading the record…</p>}
      {status === 'error' && (
        <p role="status" style={small}>
          {error ?? 'Could not simulate this collision in detail, so the bodies were merged.'}
        </p>
      )}
      {status === 'ready' &&
        detail &&
        (() => {
          const t = describeRecord(detail, bodyName);
          return (
            <div style={{ fontSize: '12px', marginTop: '6px' }}>
              {hasSoftFidelity(detail.record.fidelity) && (
                <p data-testid="inspector-soft-fidelity" style={small}>
                  Not every quantity below is a computed result: see the fidelity labels. The science is provisional.
                </p>
              )}
              <div data-testid="inspector-headline">
                <strong>{t.headline}</strong>
              </div>
              <div style={small} data-testid="inspector-lineage">
                {t.lineage}
              </div>
              <List title="Why this outcome (from the record)" items={t.why} />
              <div style={{ ...small, marginTop: '8px' }} data-testid="inspector-materials">
                {t.materials}
              </div>
              <List title="Model parameters" items={t.parameters} />
              <List title="Mass accounting" items={t.accounting} />
              <List title="Residuals and energy" items={t.residuals} />
              <List title="What became of the products" items={t.aftermath} />
              <List title="Fidelity" items={t.fidelity} />
              <List title="Warnings" items={t.warnings} />
              {detail.childEventIds.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  {detail.childEventIds.map((id) => (
                    <button key={id} type="button" onClick={() => onOpenEvent(id)} style={{ ...btnStyle, fontSize: '11px', marginRight: '4px', padding: '3px 9px' }}>
                      Open {id}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ marginTop: '10px' }}>
                <button type="button" onClick={onReplay} disabled={replayBusy} style={{ ...btnStyle, fontSize: '11px', padding: '3px 9px' }}>
                  {replayBusy ? 'Replaying…' : 'Replay (dry run)'}
                </button>
                {replay && (
                  <p role="status" data-testid="inspector-replay" style={{ ...small, color: replay.reproduced ? theme.textMuted : theme.danger }}>
                    {describeReplay(replay)}
                  </p>
                )}
              </div>
              <p style={{ ...small, marginTop: '8px' }}>{t.caveat}</p>
              <p style={small}>
                input {detail.record.inputDigest.slice(0, 12)}… · result {detail.record.resultDigest.slice(0, 12) || 'n/a'}…
              </p>
            </div>
          );
        })()}
    </section>
  );
};
