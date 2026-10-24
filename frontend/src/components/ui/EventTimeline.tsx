import React from 'react';
import { formatDuration } from '../../sim/format';
import { formatVector } from '../../sim/diagnosticsFormat';
import type { EventView } from '../../sim/viewModel';
import { panelStyle } from './styles';
import { theme } from './theme';

interface EventTimelineProps {
  events: EventView[];
  bodyName: (id: string) => string;
}

/** Describes a backend event using only fields the API supplied. */
export function describeEvent(event: EventView, bodyName: (id: string) => string): string {
  const [survivor, absorbed] = event.bodyIds;
  return `${bodyName(absorbed ?? '?')} merged into ${bodyName(survivor ?? event.resultBodyId)} ` +
    `at ${event.relativeSpeedMPerS.toPrecision(3)} m/s`;
}

export const EventTimeline: React.FC<EventTimelineProps> = ({ events, bodyName }) => {
  const newestFirst = [...events].reverse();
  return (
    <section aria-labelledby="event-history-heading" style={{
      ...panelStyle,
      width: '100%',
    }}>
      <h3 id="event-history-heading" style={{ margin: '0 0 12px 0', fontSize: '14px' }}>Event History</h3>
      {events.length === 0 ? (
        <p style={{ fontSize: '12px', color: theme.textMuted, margin: 0 }}>No events yet.</p>
      ) : (
        <ol aria-label="Merger events" style={{ display: 'flex', flexDirection: 'column', gap: '10px', listStyle: 'none', margin: 0, padding: 0 }}>
          {newestFirst.map((event) => (
            <li key={event.id} data-testid="event-item" style={{
              padding: '8px',
              background: theme.surfaceRaised,
              borderRadius: '4px',
              fontSize: '12px',
              borderLeft: `3px solid ${theme.danger}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <strong>{event.type.toUpperCase()} · {event.id}</strong>
                <span
                  title={`${event.simulationTimeS} seconds as reported by the backend`}
                  style={{ color: theme.textMuted }}
                >
                  detected at t = {formatDuration(event.simulationTimeS)}
                </span>
              </div>
              <div>{describeEvent(event, bodyName)}</div>
              <div style={{ color: theme.textMuted, marginTop: '3px' }}>
                result mass {event.resultMassKg.toExponential(3)} kg · KE lost {event.kineticEnergyLostJ.toExponential(2)} J
              </div>
              <div style={{ color: theme.textMuted, marginTop: '3px' }}>
                estimated contact {event.estimatedContactTimeS === null
                  ? 'unavailable'
                  : `t = ${formatDuration(event.estimatedContactTimeS)}`}
                {' · '}straight-line estimate, not exact; detection time is at integrator-step granularity
              </div>
              <div style={{ color: theme.textMuted, marginTop: '3px' }}>
                spin booked {formatVector(event.spinAddedKgM2PerS, 'kg·m²/s')} · bookkeeping only; no rotation dynamics
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
