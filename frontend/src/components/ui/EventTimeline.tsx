import React from 'react';
import { formatDuration } from '../../sim/format';
import { formatVector } from '../../sim/diagnosticsFormat';
import { impactSpeedBasis } from '../../sim/collision/describe';
import { eventFocusBodyId, type EventView } from '../../sim/viewModel';
import { panelStyle } from './styles';
import { theme } from './theme';

interface EventTimelineProps {
  events: EventView[];
  bodyName: (id: string) => string;
  activeBodyIds?: ReadonlySet<string>;
  selectedBodyId?: string;
  onSelectBody?: (id: string) => void;
  /** Opens the collision inspector for a `collision` event (only collision events have a record). */
  onInspect?: (eventId: string) => void;
}

/** Describes a backend event using only fields the API supplied. */
const OUTCOME_LABEL: Record<string, string> = {
  perfect_merge: 'Merger', graze_and_merge: 'Graze-and-merge', hit_and_run: 'Hit-and-run', partial_accretion: 'Partial accretion',
  partial_erosion: 'Partial erosion', cratering: 'Cratering', catastrophic_disruption: 'Catastrophic disruption',
  super_catastrophic_disruption: 'Super-catastrophic disruption', envelope_deposition: 'Deposition in a gas envelope',
  envelope_merge_approximation: 'Envelope merger (approximation)', legacy_merge: 'Merger',
};

/** Fidelity labels exactly as the backend reports them, so an approximation is never shown as a computed result. */
export function describeFidelity(summary: Record<string, string>): string {
  return Object.entries(summary).map(([quantity, label]) => `${quantity}: ${label}`).join(' · ');
}

export function describeEvent(event: EventView, bodyName: (id: string) => string): string {
  if (event.type === 'collision') {
    const [target, projectile] = event.bodyIds;
    return `${OUTCOME_LABEL[event.outcome] ?? event.outcome}: ${bodyName(projectile ?? '?')} hit ${bodyName(target ?? '?')} ` +
      `at ${event.impactSpeedMPerS.toPrecision(3)} m/s ${impactSpeedBasis(event.warnings)}, ${event.impactAngleDeg.toFixed(1)}° from the normal`;
  }
  const [survivor, absorbed] = event.bodyIds;
  return `${bodyName(absorbed ?? '?')} merged into ${bodyName(survivor ?? event.resultBodyId)} ` +
    `at ${event.relativeSpeedMPerS.toPrecision(3)} m/s relative speed at detection`;
}

export const EventTimeline: React.FC<EventTimelineProps> = ({
  events,
  bodyName,
  activeBodyIds,
  selectedBodyId,
  onSelectBody,
  onInspect,
}) => {
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
          {newestFirst.map((event) => {
            const focusId = eventFocusBodyId(event);
            return (
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
              {onSelectBody && focusId !== undefined && activeBodyIds?.has(focusId) && (
                <button
                  type="button"
                  aria-label={`Highlight surviving body ${bodyName(focusId)}`}
                  aria-pressed={selectedBodyId === focusId}
                  onClick={() => onSelectBody(focusId)}
                  style={{ marginTop: '6px', fontSize: '11px' }}
                >
                  Highlight surviving body: {bodyName(focusId)}
                </button>
              )}
              {event.type === 'collision' ? (
                <>
                  {onInspect && (
                    <button type="button" aria-label={`Inspect collision ${event.id}`} onClick={() => onInspect(event.id)} style={{ marginTop: '6px', fontSize: '11px' }}>
                      Inspect record
                    </button>
                  )}
                  <div style={{ color: theme.textMuted, marginTop: '3px' }}>
                    largest remnant {event.largestRemnantMassKg.toExponential(3)} kg · debris {event.debrisMassKg.toExponential(3)} kg
                    {' · '}Q_R {event.specificImpactEnergyJPerKg.toExponential(2)} J/kg
                  </div>
                  <div style={{ color: theme.textMuted, marginTop: '3px' }}>
                    model {event.modelId} {event.modelVersion} · mass residual {event.massResidualRel.toExponential(1)} · momentum residual{' '}
                    {event.momentumResidualRel.toExponential(1)}
                  </div>
                  <div style={{ color: theme.textMuted, marginTop: '3px' }} data-testid="event-fidelity">
                    {describeFidelity(event.fidelitySummary)}
                  </div>
                  {event.warnings.length > 0 && (
                    <div style={{ color: theme.textMuted, marginTop: '3px' }} data-testid="event-warnings">warnings: {event.warnings.join(', ')}</div>
                  )}
                </>
              ) : (
              <>
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
              </>
              )}
            </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};
