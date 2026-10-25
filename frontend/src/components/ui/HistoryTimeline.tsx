import React from 'react';
import type { HistoryCache } from '../../sim/history/historyModel';
import { REPLAY_RATES, type HistoryNavigation } from '../../sim/history/useHistoryNavigation';
import type { HistoryStatus } from '../../sim/history/useHistory';
import { formatDuration } from '../../sim/format';
import type { EventView } from '../../sim/viewModel';
import { btnStyle, inputStyle, drawerSectionStyle } from './styles';
import { theme } from './theme';

interface HistoryTimelineProps {
  cache: HistoryCache | null;
  status: HistoryStatus;
  error: string | null;
  nav: HistoryNavigation;
  /** The live simulation time (what "Return to live" goes back to). */
  liveTimeS: number | null;
  /** Merger events of this universe, marked at their simulation time. */
  events: readonly EventView[];
  onRefresh: () => void;
}

const bannerStyle = (color: string): React.CSSProperties => ({
  margin: 0, fontSize: 11, padding: '4px 8px', borderRadius: 4, border: `1px solid ${color}`, color: theme.text,
});

/**
 * Timeline over the recorded history of the active universe: seek, step, replay, return to live. Missing data is shown
 * as missing (banners), never filled in. It knows nothing about rendering: the workspace turns the viewed frame into
 * bodies for the canvas through the existing display path.
 */
export const HistoryTimeline: React.FC<HistoryTimelineProps> = ({ cache, status, error, nav, liveTimeS, events, onRefresh }) => {
  const n = cache?.samples.length ?? 0;
  const live = liveTimeS === null ? '—' : formatDuration(liveTimeS);
  const incomplete: string[] = [];
  if (status === 'stale') incomplete.push(`could not update (${error ?? 'unknown error'})`);
  if (cache && cache.gaps.length > 0) incomplete.push('some samples were not received');
  if (cache?.truncated) incomplete.push('the backend stopped recording (its history limit was reached)');

  const first = cache?.samples[0]?.simulationTimeS;
  const last = cache?.samples[n - 1]?.simulationTimeS;
  const span = first !== undefined && last !== undefined ? last - first : 0;
  const markers = cache && span > 0
    ? events.filter((e) => e.simulationTimeS >= first! && e.simulationTimeS <= last!)
    : [];

  return (
    <section aria-label="History" style={{ ...drawerSectionStyle, width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>History</h3>
      {n === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: theme.textMuted }}>No recorded history yet.</p>
      ) : (
        <>
          <div style={{ fontSize: 12 }}>
            <div data-testid="history-time" style={{ fontFamily: theme.mono }}>
              {nav.mode === 'history' && nav.position !== null
                ? `t = ${formatDuration(cache!.samples[nav.position]!.simulationTimeS)} (sample ${nav.position + 1} of ${n})`
                : `Live: t = ${live}`}
            </div>
            {nav.mode === 'history' && (
              <div data-testid="history-live-time" style={{ color: theme.textMuted, fontSize: 11 }}>Live: t = {live}</div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <input
              type="range"
              aria-label="History position"
              min={0}
              max={n - 1}
              step={1}
              value={nav.position ?? n - 1}
              onChange={(e) => nav.seek(Number(e.target.value))}
              style={{ width: '100%', margin: 0 }}
            />
            <div style={{ position: 'relative', height: 8 }}>
              {markers.map((e) => (
                <span
                  key={e.id}
                  data-testid="history-event-marker"
                  title={`Merger at t = ${formatDuration(e.simulationTimeS)}`}
                  style={{
                    position: 'absolute', top: 0, width: 2, height: 8, background: theme.danger,
                    left: `${((e.simulationTimeS - first!) / span) * 100}%`,
                  }}
                />
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" style={btnStyle} aria-label="Previous sample" onClick={() => nav.stepBy(-1)}>◀</button>
            <button type="button" style={btnStyle} aria-label="Next sample" onClick={() => nav.stepBy(1)}>▶</button>
            {nav.replaying ? (
              <button type="button" style={btnStyle} onClick={nav.stopReplay}>Stop</button>
            ) : (
              <button type="button" style={btnStyle} onClick={() => nav.replay(nav.rate)}>Replay</button>
            )}
            <select
              aria-label="Replay speed"
              value={nav.rate}
              onChange={(e) => nav.setRate(Number(e.target.value))}
              style={{ ...inputStyle, width: 'auto' }}
            >
              {REPLAY_RATES.map((r) => (
                <option key={r} value={r}>{r} sample{r > 1 ? 's' : ''}/tick</option>
              ))}
            </select>
          </div>
          {nav.mode === 'history' && (
            <button type="button" style={btnStyle} onClick={nav.returnToLive}>Return to live</button>
          )}
        </>
      )}

      {nav.mode === 'history' && (
        <p role="status" style={bannerStyle(theme.accent)}>Viewing recorded history — the simulation is not advancing</p>
      )}
      {incomplete.length > 0 && (
        <p role="status" style={bannerStyle(theme.warn)}>
          History may be incomplete: {incomplete.join('; ')}.{' '}
          {status === 'stale' && <button type="button" style={{ ...btnStyle, fontSize: 11, padding: '2px 6px' }} onClick={onRefresh}>Retry</button>}
        </p>
      )}
      {cache && (cache.droppedBefore > 0 || cache.clientTrimmed) && (
        <p role="status" style={bannerStyle(theme.borderStrong)}>Oldest samples discarded (the earliest recorded states are no longer available).</p>
      )}
    </section>
  );
};
