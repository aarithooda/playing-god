import React, { useEffect, useState } from 'react';
import type { ComparisonDto, Vec3Tuple } from '../../api/types';
import { formatDuration } from '../../sim/format';
import { btnStyle, errorTextStyle, panelStyle } from './styles';
import { theme } from './theme';

interface ComparisonPanelProps {
  comparison: ComparisonDto | null;
  error: string | null;
  onRefresh: () => void;
}

const W = 280;
const H = 90;
const PAD = { l: 44, r: 8, t: 8, b: 22 };
const DAY = 86400;

const sci = (x: number) => x.toExponential(3);
const vec = (v: Vec3Tuple) => `(${v.map(sci).join(', ')})`;

/**
 * The separation of the two runs' selected body against time, from the common samples both runs have reached. It only
 * reads what the backend computed; it never asks either run to advance or change.
 */
export const ComparisonPanel: React.FC<ComparisonPanelProps> = ({ comparison: c, error, onRefresh }) => {
  const n = c?.commonSampleCount ?? 0;
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => {
    if (pick !== null && pick > n - 1) setPick(null);
  }, [n, pick]);
  const index = pick ?? Math.max(n - 1, 0);

  let chart: React.ReactNode = null;
  if (c && n >= 2) {
    const tMax = c.timesS[n - 1]! || 1;
    const sMax = Math.max(...c.separationM, 1e-300);
    const x = (t: number) => PAD.l + (t / tMax) * (W - PAD.l - PAD.r);
    const y = (s: number) => H - PAD.b - (s / sMax) * (H - PAD.t - PAD.b);
    const points = c.timesS.map((t, i) => `${x(t).toFixed(1)},${y(c.separationM[i]!).toFixed(1)}`).join(' ');
    chart = (
      <svg role="img" aria-label="Separation of the two runs against time" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ background: theme.surfaceRaised, borderRadius: 4 }}>
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke={theme.borderStrong} />
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke={theme.borderStrong} />
        <polyline fill="none" stroke={theme.warn} strokeWidth={1.5} points={points} />
        <circle cx={x(c.timesS[index]!)} cy={y(c.separationM[index]!)} r={3} fill={theme.accent} />
        <text x={W / 2} y={H - 4} fontSize={9} fill={theme.textMuted} textAnchor="middle">t (days)</text>
        <text x={PAD.l} y={H - PAD.b + 10} fontSize={8} fill={theme.textMuted} textAnchor="middle">0</text>
        <text x={W - PAD.r} y={H - PAD.b + 10} fontSize={8} fill={theme.textMuted} textAnchor="end">{(tMax / DAY).toFixed(0)}</text>
        <text x={4} y={PAD.t + 8} fontSize={8} fill={theme.textMuted}>separation (m)</text>
        <text x={4} y={PAD.t + 18} fontSize={8} fill={theme.textMuted}>max {sci(sMax)}</text>
      </svg>
    );
  }

  const windowDays = c ? c.observationWindowS / DAY : 730;
  const samplesInWindow = c ? Math.round(c.observationWindowS / c.sampleIntervalS) + 1 : 731;
  return (
    <section aria-label="Comparison" style={{ ...panelStyle, width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Comparison</h3>
        <button type="button" style={btnStyle} onClick={onRefresh}>Refresh comparison</button>
      </div>
      {!c ? (
        <p style={{ margin: 0, fontSize: 12, color: theme.textMuted }}>No comparison available yet.</p>
      ) : (
        <>
          <div data-testid="comparison-times" style={{ fontSize: 12, fontFamily: theme.mono }}>
            Baseline t = {formatDuration(c.baseline.simulationTimeS)} · Modified t = {c.modified ? formatDuration(c.modified.simulationTimeS) : '—'}
          </div>
          {c.timesDiffer && (
            <p data-testid="comparison-time-mismatch" role="status" style={{ margin: 0, fontSize: 11, padding: '4px 8px', border: `1px solid ${theme.warn}`, borderRadius: 4 }}>
              The runs are at different simulation times. Only the samples both have reached are compared: compared up to t = {c.comparedUpToS === null ? '—' : formatDuration(c.comparedUpToS)}.
              Neither run was changed to match the other.
            </p>
          )}
          {!c.controlled && (
            <p data-testid="comparison-uncontrolled" role="status" style={{ margin: 0, fontSize: 12, color: theme.danger }}>
              {`Uncontrolled since t = ${c.firstUncontrolledAtS === null ? '?' : formatDuration(c.firstUncontrolledAtS)}: the modified run no longer differs from the baseline only by the chosen speed.`}
            </p>
          )}
          <div data-testid="comparison-window" style={{ fontSize: 11, color: theme.textMuted }}>
            Window: {windowDays.toFixed(0)} d, {c.windowCompleteBoth ? 'complete' : 'incomplete'} (baseline {c.baseline.sampleCount} of {samplesInWindow} samples
            {c.modified ? `, modified ${c.modified.sampleCount} of ${samplesInWindow}` : ''}).
          </div>
          {chart ?? (
            <p style={{ margin: 0, fontSize: 12, color: theme.textMuted }}>Not enough common samples yet: advance both runs to compare them.</p>
          )}
          {n >= 2 && (
            <>
              <input
                type="range"
                aria-label="Common sample"
                min={0}
                max={n - 1}
                step={1}
                value={index}
                onChange={(e) => setPick(Number(e.target.value))}
                style={{ width: '100%', margin: 0 }}
              />
              <div data-testid="comparison-readout" style={{ fontSize: 11, fontFamily: theme.mono, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>t = {formatDuration(c.timesS[index]!)} (common sample {index + 1} of {n})</span>
                <span>Separation: {sci(c.separationM[index]!)} m</span>
                <span>Baseline position (m): {vec(c.baselinePositionM[index]!)}</span>
                <span>Modified position (m): {vec(c.modifiedPositionM[index]!)}</span>
              </div>
            </>
          )}
          {c.issues.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: theme.warn }}>
              {c.issues.map((i) => <li key={i}>{i}</li>)}
            </ul>
          )}
        </>
      )}
      {error && <p role="alert" style={{ ...errorTextStyle, margin: 0 }}>Could not update the comparison: {error}</p>}
    </section>
  );
};
