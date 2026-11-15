import React, { useMemo, useState } from 'react';
import type { MissionDto } from '../../api/types';
import { formatCountdown, formatLength, formatMass, formatSpan, formatSpeed, parseNumber } from '../../sim/spaceflight/format';
import type { SpaceflightApi } from '../../sim/spaceflight/useSpaceflight';
import type { BodyView } from '../../sim/viewModel';
import { ErrorText, Fact, Facts, MissionStatusBadge, NumberField, SelectField, grid2 } from './flightUi';
import { btnStyle, drawerSectionStyle, noteTextStyle, primaryBtnStyle, sectionTitleStyle } from './styles';
import { theme } from './theme';

interface MissionPanelProps {
  api: SpaceflightApi;
  bodies: readonly BodyView[];
  nowS: number;
  /** Preselects the spacecraft of a new mission. */
  selectedBodyId?: string;
  bodyName: (id: string) => string;
  disabled: boolean;
  halted: boolean;
  /** Start the simulation (offered once a plan is committed). */
  onPlay: () => void;
  playing: boolean;
}

const OPEN: MissionDto['status'][] = ['draft', 'planned', 'in_progress'];

function formatCheckValue(value: number | string | null, unit: string): string {
  if (value === null) return '—';
  if (typeof value === 'string') return value;
  return unit === 'm' ? formatLength(value) : Number(value.toPrecision(4)).toString();
}

const MissionCard: React.FC<{
  mission: MissionDto; api: SpaceflightApi; nowS: number; bodyName: (id: string) => string; disabled: boolean; halted: boolean; onPlay: () => void; playing: boolean;
}> = ({ mission, api, nowS, bodyName, disabled, halted, onPlay, playing }) => {
  const [transfer, setTransfer] = useState<'minimum' | 'fixed'>('minimum');
  const [days, setDays] = useState('3');
  const [burnMode, setBurnMode] = useState<'impulsive' | 'finite'>('impulsive');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plan = mission.plan;
  const over = mission.status === 'completed' || mission.status === 'failed';
  const canDesign = !mission.committed && !over;
  const fixedDays = parseNumber(days);

  const act = async (name: string, task: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(name);
    setError(null);
    const result = await task();
    setBusy(null);
    if (!result.ok) setError(result.error);
  };
  const design = () => act('design', () => api.planMission(mission.id, {
    burnMode, ...(transfer === 'fixed' && fixedDays !== null ? { transferTimeS: fixedDays * 86400 } : {}),
  }));

  const objective = mission.objective;
  const target = objective.type === 'flyby'
    ? `flyby at ${formatLength(objective.periapsisAltitudeM)}`
    : objective.apoapsisAltitudeM === null
      ? `${formatLength(objective.periapsisAltitudeM)} circular orbit`
      : `${formatLength(objective.periapsisAltitudeM)} × ${formatLength(objective.apoapsisAltitudeM)} orbit`;

  return (
    <li data-testid="mission-card" data-mission-id={mission.id} style={{ padding: 11, borderRadius: 10, background: theme.tint, border: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{mission.name}</strong>
          <div style={{ fontSize: 11.5, color: theme.textMuted }}>
            {bodyName(mission.spacecraftId)} → {bodyName(mission.destinationBodyId)} · {target}, {objective.direction}
          </div>
        </div>
        <MissionStatusBadge status={mission.status} committed={mission.committed} />
      </div>
      <div data-testid="mission-phase" style={{ fontSize: 12 }}>{mission.phase}</div>
      {mission.reasons.length > 0 && (
        <ul data-testid="mission-reasons" style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, lineHeight: 1.45, color: mission.status === 'failed' ? theme.danger : mission.status === 'unsupported' ? theme.warn : theme.textMuted }}>
          {mission.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}

      {canDesign && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={grid2}>
            <SelectField id={`${mission.id}-transfer`} label="Transfer" value={transfer} onChange={(x) => setTransfer(x as 'minimum' | 'fixed')}
              options={[{ value: 'minimum', label: 'Minimum energy' }, { value: 'fixed', label: 'Fixed flight time' }]} />
            {transfer === 'fixed'
              ? <NumberField id={`${mission.id}-days`} label="Flight time" unit="days" value={days} onChange={setDays} invalid={fixedDays === null || fixedDays <= 0} />
              : <SelectField id={`${mission.id}-burns`} label="Burns" value={burnMode} onChange={(x) => setBurnMode(x as 'impulsive' | 'finite')}
                  options={[{ value: 'impulsive', label: 'Impulsive' }, { value: 'finite', label: 'Finite (engine thrust)' }]} />}
            {transfer === 'fixed' && <SelectField id={`${mission.id}-burns`} label="Burns" value={burnMode} onChange={(x) => setBurnMode(x as 'impulsive' | 'finite')}
              options={[{ value: 'impulsive', label: 'Impulsive' }, { value: 'finite', label: 'Finite (engine thrust)' }]} />}
          </div>
          <div>
            <button type="button" style={plan ? btnStyle : primaryBtnStyle} disabled={disabled || halted || busy !== null || (transfer === 'fixed' && (fixedDays === null || fixedDays <= 0))} onClick={() => void design()}>
              {busy === 'design' ? 'Designing the transfer…' : plan ? 'Design again' : 'Design transfer'}
            </button>
          </div>
        </div>
      )}

      {plan && (
        <div data-testid="mission-plan" style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 8 }}>
          <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 4 }}>
            {mission.committed ? 'Plan (the prediction this flight is compared with)' : 'Proposed plan (a prediction; nothing is scheduled yet)'}
          </div>
          <Facts label="Transfer plan">
            <Fact label="Departure burn" testId="plan-departure"
              value={`${formatSpeed(plan.departure.deltaVMPerS)} · ${nowS <= plan.departure.epochS ? formatCountdown(plan.departure.ignitionS, nowS) : 'done'}`} />
            <Fact label="Flight time" value={formatSpan(plan.arrival.transferTimeS)} testId="plan-flight-time" />
            <Fact label="Arrival periapsis" value={`${formatLength(plan.arrival.periapsisAltitudeM)} at ${formatSpeed(plan.arrival.periapsisSpeedMPerS)}`} />
            {plan.insertion && <Fact label="Insertion burn" value={formatSpeed(plan.insertion.deltaVMPerS)} testId="plan-insertion" />}
            <Fact label="Total delta-v" value={`${formatSpeed(plan.totals.deltaVMPerS)} of ${formatSpeed(plan.totals.deltaVAvailableMPerS)}`}
              tone={plan.totals.feasible ? undefined : 'danger'} testId="plan-total" />
            <Fact label="Propellant" value={`${formatMass(plan.totals.propellantRequiredKg)} of ${formatMass(plan.totals.propellantAvailableKg)}`} tone={plan.totals.feasible ? undefined : 'danger'} />
            {plan.predictedOrbit && (
              <Fact label="Predicted orbit" testId="plan-orbit"
                value={plan.predictedOrbit.bound ? `${formatLength(plan.predictedOrbit.minAltitudeM)} to ${formatLength(plan.predictedOrbit.maxAltitudeM)}` : 'not captured'}
                tone={plan.predictedOrbit.bound ? undefined : 'danger'} />
            )}
            <Fact label="Two-body estimate" tone="muted"
              value={`${formatSpeed(plan.patchedConic.hohmannDepartureDeltaVMPerS)}, ${formatSpan(plan.patchedConic.hohmannTransferTimeS)}`} />
          </Facts>
          <p style={{ ...noteTextStyle, fontSize: 10.5, marginTop: 5 }}>
            Designed by flying {plan.model.trialFlights} trial trajectories on a copy of this universe ({plan.model.bodiesInFinalFlight} gravitating bodies,
            {plan.model.burnModel} burns); periapsis found to {formatLength(plan.model.periapsisResidualM)}. The two-body estimate (Hohmann ellipse, destination
            massless) is shown for comparison only.
          </p>
          {mission.planStale && mission.committed && <p role="status" style={{ ...noteTextStyle, color: theme.warn }}>The universe changed after this plan was made: it no longer predicts this flight.</p>}
        </div>
      )}

      {mission.agreement.length > 0 && (
        <div data-testid="mission-agreement">
          <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 3 }}>Plan against simulation, at the same instant</div>
          <Facts label="Plan against simulation">
            {mission.agreement.map((a) => (
              <Fact key={a.maneuverId} label={`Before the ${a.role ?? 'node'}`} tone={a.ok ? 'ok' : 'danger'}
                value={`${formatLength(a.positionDifferenceM)}, ${a.velocityDifferenceMPerS.toExponential(1)} m/s`} />
            ))}
          </Facts>
          <p style={{ ...noteTextStyle, fontSize: 10.5 }}>Tolerance {formatLength(mission.agreement[0]!.positionToleranceM)} and {mission.agreement[0]!.velocityToleranceMPerS} m/s.</p>
        </div>
      )}

      {mission.checks.length > 0 && (
        <ul data-testid="mission-checks" aria-label="Mission conditions" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11.5, lineHeight: 1.45 }}>
          {mission.checks.map((c) => (
            <li key={c.id} data-ok={c.ok} style={{ display: 'flex', gap: 6 }}>
              <span aria-hidden="true" style={{ color: c.ok ? theme.ok : theme.danger, flex: '0 0 auto' }}>{c.ok ? '✓' : '✗'}</span>
              <span style={{ flex: 1 }}>
                {c.label}
                <span style={{ color: theme.textMuted }}>
                  {' '}· actual {formatCheckValue(c.actual, c.unit)}{typeof c.target === 'number' ? `, target ${formatCheckValue(c.target, c.unit)}` : ''}
                  {c.tolerance !== null ? ` ± ${formatLength(c.tolerance)}` : ''}
                </span>
              </span>
              <span className="sr-only">{c.ok ? 'met' : 'not met'}</span>
            </li>
          ))}
        </ul>
      )}
      {mission.status === 'completed' && <p data-testid="mission-outcome" role="status" style={{ ...noteTextStyle, color: theme.ok }}>These conditions hold in the simulated state, not only in the plan.</p>}

      <ErrorText>{error}</ErrorText>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {mission.status === 'planned' && !mission.committed && (
          <button type="button" style={primaryBtnStyle} disabled={disabled || halted || busy !== null} onClick={() => void act('commit', () => api.commitMission(mission.id))}
            title="Schedule the planned burns in the simulation">
            {busy === 'commit' ? 'Scheduling…' : 'Commit plan'}
          </button>
        )}
        {mission.committed && !over && !playing && (
          <button type="button" style={primaryBtnStyle} disabled={disabled || halted} onClick={onPlay}>Run the simulation</button>
        )}
        {mission.committed && !over && (
          <button type="button" style={btnStyle} disabled={disabled || busy !== null} onClick={() => void act('abort', () => api.abortMission(mission.id))}>Abort mission</button>
        )}
        <button type="button" style={{ ...btnStyle, color: theme.danger, borderColor: theme.dangerLine }} disabled={disabled || busy !== null}
          onClick={() => void act('delete', () => api.deleteMission(mission.id))}>Delete</button>
      </div>
    </li>
  );
};

/** Missions: a spacecraft, a destination and an objective; a designed transfer; and what actually happened. */
export const MissionPanel: React.FC<MissionPanelProps> = ({ api, bodies, nowS, selectedBodyId, bodyName, disabled, halted, onPlay, playing }) => {
  const busyCraft = useMemo(() => new Set(api.missions.filter((m) => OPEN.includes(m.status)).map((m) => m.spacecraftId)), [api.missions]);
  const freeCraft = api.spacecraft.filter((c) => !busyCraft.has(c.id));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [craftId, setCraftId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [type, setType] = useState<'orbit' | 'flyby'>('orbit');
  const [periapsisKm, setPeriapsisKm] = useState('100');
  const [apoapsisKm, setApoapsisKm] = useState('');
  const [direction, setDirection] = useState<'prograde' | 'retrograde'>('prograde');
  const [toleranceKm, setToleranceKm] = useState('50');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const craft = freeCraft.find((c) => c.id === craftId) ?? freeCraft.find((c) => c.id === selectedBodyId) ?? freeCraft[0];
  const referenceId = craft?.spacecraft?.orbit?.referenceBodyId;
  const destinations = bodies.filter((b) => b.kind !== 'spacecraft' && b.id !== referenceId);
  // the natural destination: a satellite of the body the craft orbits
  const destination = destinations.find((b) => b.id === destinationId) ?? destinations.find((b) => b.primaryId === referenceId) ?? destinations[0];
  const rp = parseNumber(periapsisKm), ra = apoapsisKm.trim() === '' ? undefined : parseNumber(apoapsisKm), tol = parseNumber(toleranceKm);
  const valid = craft !== undefined && destination !== undefined && rp !== null && rp > 0 && ra !== null && (ra === undefined || ra >= rp) && tol !== null && tol > 0;

  const create = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const result = await api.createMission({
      name: name.trim() || `${craft.name} to ${destination.name}`, spacecraftId: craft.id, destinationBodyId: destination.id,
      objective: { type, periapsisAltitudeM: rp * 1000, ...(type === 'orbit' && ra !== undefined ? { apoapsisAltitudeM: ra * 1000 } : {}), direction, toleranceM: tol * 1000 },
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setName('');
    } else setError(result.error);
  };

  return (
    <section aria-labelledby="missions-heading" style={drawerSectionStyle}>
      <h3 id="missions-heading" style={sectionTitleStyle}>Missions</h3>
      {api.missions.length === 0 && !open && (
        <p style={noteTextStyle}>
          A mission takes a spacecraft to another body. The transfer is designed on a copy of this universe; the simulation then flies it, and
          the result is judged on what actually happens.
        </p>
      )}
      {api.missions.length > 0 && (
        <ul aria-label="Missions" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...api.missions].reverse().map((m) => (
            <MissionCard key={m.id} mission={m} api={api} nowS={nowS} bodyName={bodyName} disabled={disabled || api.planning} halted={halted} onPlay={onPlay} playing={playing} />
          ))}
        </ul>
      )}
      {api.missions.length > 0 && (
        <p data-testid="trajectory-legend" style={{ ...noteTextStyle, fontSize: 10.5 }}>
          In the scene: <span style={{ color: '#c4b5fd' }}>dashed violet</span> is a planned trajectory (a prediction), a solid line is the path actually flown,
          the thin ring is the spacecraft&apos;s present orbit. Lines are drawn relative to the body the spacecraft orbits.
        </p>
      )}

      {!open ? (
        <button type="button" style={api.missions.length === 0 && api.spacecraft.length > 0 ? primaryBtnStyle : btnStyle} disabled={disabled || freeCraft.length === 0 || destinations.length === 0}
          title={api.spacecraft.length === 0 ? 'Create a spacecraft first' : freeCraft.length === 0 ? 'Every spacecraft already has an open mission' : undefined}
          onClick={() => { setOpen(true); setError(null); }}>
          New mission…
        </button>
      ) : (
        <form aria-label="New mission" noValidate onSubmit={(e) => { e.preventDefault(); void create(); }}
          style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: 10, borderRadius: 8, background: theme.tint, border: `1px solid ${theme.border}` }}>
          <div style={grid2}>
            <SelectField id="msn-craft" label="Spacecraft" value={craft?.id ?? ''} onChange={setCraftId} options={freeCraft.map((c) => ({ value: c.id, label: c.name }))} />
            <SelectField id="msn-destination" label="Destination" value={destination?.id ?? ''} onChange={setDestinationId} options={destinations.map((b) => ({ value: b.id, label: b.name }))} />
            <SelectField id="msn-type" label="Objective" value={type} onChange={(x) => setType(x as 'orbit' | 'flyby')}
              options={[{ value: 'orbit', label: 'Enter orbit' }, { value: 'flyby', label: 'Fly by' }]} />
            <SelectField id="msn-direction" label="Direction" value={direction} onChange={(x) => setDirection(x as 'prograde' | 'retrograde')}
              options={[{ value: 'prograde', label: 'Prograde' }, { value: 'retrograde', label: 'Retrograde' }]} />
            <NumberField id="msn-periapsis" label={type === 'flyby' ? 'Closest approach' : 'Periapsis altitude'} unit="km" value={periapsisKm} onChange={setPeriapsisKm} invalid={rp === null || rp <= 0} />
            {type === 'orbit' && <NumberField id="msn-apoapsis" label="Apoapsis altitude" unit="km" value={apoapsisKm} onChange={setApoapsisKm} invalid={ra === null || (ra !== undefined && rp !== null && ra < rp)} hint="empty = circular" />}
            <NumberField id="msn-tolerance" label="Tolerance" unit="km" value={toleranceKm} onChange={setToleranceKm} invalid={tol === null || tol <= 0} hint="how close counts as success" />
          </div>
          <p style={{ ...noteTextStyle, fontSize: 10.5 }}>
            Supported: from a near-circular orbit about a body to one of that body&apos;s satellites (Earth to the Moon). Anything else is reported as unsupported, not approximated.
          </p>
          <ErrorText>{error}</ErrorText>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="submit" style={primaryBtnStyle} disabled={disabled || busy || !valid}>{busy ? 'Creating…' : 'Create mission'}</button>
            <button type="button" style={btnStyle} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
};
