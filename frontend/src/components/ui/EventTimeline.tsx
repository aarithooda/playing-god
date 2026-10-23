import React from 'react';
import { formatDuration } from '../../sim/format';
import type { EventView } from '../../sim/viewModel';
import { panelStyle } from './styles';

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
    <div style={{
      ...panelStyle,
      position: 'absolute',
      top: '20px',
      left: '20px',
      width: '280px',
      maxHeight: '400px',
      overflowY: 'auto',
    }}>
      <h3 style={{ margin: '0 0 15px 0', fontSize: '14px', opacity: 0.8 }}>Event History</h3>
      {events.length === 0 ? (
        <p style={{ fontSize: '12px', opacity: 0.5, margin: 0 }}>No events yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {newestFirst.map((event) => (
            <div key={event.id} data-testid="event-item" style={{
              padding: '8px',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '4px',
              fontSize: '12px',
              borderLeft: '3px solid #ff4444',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <strong>{event.type.toUpperCase()}</strong>
                <span style={{ opacity: 0.5 }}>t = {formatDuration(event.simulationTimeS)}</span>
              </div>
              <div>{describeEvent(event, bodyName)}</div>
              <div style={{ opacity: 0.5, marginTop: '3px' }}>
                result mass {event.resultMassKg.toExponential(3)} kg · KE lost {event.kineticEnergyLostJ.toExponential(2)} J
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
