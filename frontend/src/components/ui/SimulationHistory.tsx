import React, { useEffect, useMemo, useState } from "react";
import { formatDuration, formatNumber } from "../../sim/format";
import type { TrajectoryHistory, TrajectorySnapshot } from "../../sim/trajectoryHistory";
import { btnStyle, panelStyle } from "./styles";
import { theme } from "./theme";

interface SimulationHistoryProps {
  history: TrajectoryHistory | null;
}

function snapshotLabel(snapshot: TrajectorySnapshot, index: number, count: number): string {
  return `Recorded state ${index + 1} of ${count} at ${formatDuration(snapshot.simulationTimeS)}`;
}

/** Browse bounded backend-returned snapshots; this never seeks or mutates backend simulation time. */
export const SimulationHistory: React.FC<SimulationHistoryProps> = ({ history }) => {
  const samples = history?.samples ?? [];
  const latest = samples[samples.length - 1];
  const [selectedSequence, setSelectedSequence] = useState<number | null>(null);

  useEffect(() => {
    setSelectedSequence(null);
  }, [history?.runId]);

  useEffect(() => {
    if (selectedSequence !== null && !samples.some((sample) => sample.sequence === selectedSequence)) {
      setSelectedSequence(samples[0]?.sequence ?? null);
    }
  }, [samples, selectedSequence]);

  const selected = useMemo(
    () => samples.find((sample) => sample.sequence === selectedSequence) ?? latest,
    [samples, selectedSequence, latest],
  );
  const selectedIndex = selected ? samples.indexOf(selected) : -1;
  const isLive = selected === latest;

  const chooseIndex = (index: number) => {
    const sample = samples[index];
    if (sample) setSelectedSequence(sample.sequence === latest?.sequence ? null : sample.sequence);
  };

  return (
    <section aria-label="Recorded simulation history" data-testid="simulation-history" style={{ ...panelStyle, width: "100%" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Simulation History</h3>
      {samples.length === 0 ? (
        <p role="status" style={{ margin: 0, fontSize: 12, color: theme.textMuted }}>
          Recorded states will appear after the backend loads.
        </p>
      ) : (
        <>
          <p style={{ margin: "0 0 8px", fontSize: 11, color: theme.textMuted }}>
            Recorded backend states only. Browsing does not rewind the simulation or change the live scene.
          </p>
          <label htmlFor="history-snapshot" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
            {isLive ? "Live backend state" : "Recorded snapshot"}: {formatDuration(selected!.simulationTimeS)}
          </label>
          <input
            id="history-snapshot"
            data-testid="history-snapshot"
            type="range"
            min={0}
            max={samples.length - 1}
            step={1}
            value={Math.max(0, selectedIndex)}
            aria-label="Recorded simulation time"
            aria-valuetext={snapshotLabel(selected!, selectedIndex, samples.length)}
            onChange={(event) => chooseIndex(Number(event.currentTarget.value))}
            style={{ width: "100%", accentColor: theme.accent }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              type="button"
              style={btnStyle}
              aria-label="Previous recorded state"
              disabled={selectedIndex <= 0}
              onClick={() => chooseIndex(selectedIndex - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              style={btnStyle}
              aria-label="Next recorded state"
              disabled={selectedIndex >= samples.length - 1}
              onClick={() => chooseIndex(selectedIndex + 1)}
            >
              Next
            </button>
            <button type="button" style={btnStyle} disabled={isLive} onClick={() => setSelectedSequence(null)}>
              Return to live
            </button>
          </div>
          <p aria-live="polite" style={{ margin: "8px 0 0", fontSize: 11, color: theme.textMuted }}>
            {snapshotLabel(selected!, selectedIndex, samples.length)} · {selected!.bodies.length} bodies
          </p>
          {history?.truncated && (
            <p style={{ margin: "6px 0 0", fontSize: 11, color: theme.warn }}>
              Older snapshots were trimmed to keep memory bounded.
            </p>
          )}
          <div style={{ marginTop: 8, maxHeight: 180, overflowY: "auto" }}>
            {selected!.bodies.length === 0 ? (
              <p style={{ margin: 0, fontSize: 11, color: theme.textMuted }}>No bodies in this recorded state.</p>
            ) : selected!.bodies.map((body) => (
              <div key={body.id} data-testid="history-body" style={{ padding: "5px 0", borderTop: `1px solid ${theme.border}` }}>
                <strong style={{ fontSize: 11 }}>{body.name}</strong>
                <div style={{ fontSize: 10, color: theme.textMuted, fontFamily: theme.mono, overflowWrap: "anywhere" }}>
                  position: ({formatNumber(body.positionM.x)}, {formatNumber(body.positionM.y)}, {formatNumber(body.positionM.z)}) m
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
};
