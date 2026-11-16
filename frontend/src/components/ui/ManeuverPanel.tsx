import React, { useEffect, useRef, useState } from 'react';
import type { ManeuverCreateDto, ManeuverDto, ManeuverPreviewDto } from '../../api/types';
import { formatCountdown, formatLength, formatMass, formatSpan, formatSpeed, parseNumber } from '../../sim/spaceflight/format';
import type { SpaceflightApi } from '../../sim/spaceflight/useSpaceflight';
import type { BodyView } from '../../sim/viewModel';
import { ErrorText, Fact, Facts, NumberField, SelectField, grid2 } from './flightUi';
import { btnStyle, drawerSectionStyle, noteTextStyle, primaryBtnStyle, sectionTitleStyle } from './styles';
import { theme } from './theme';

interface ManeuverPanelProps {
  api: SpaceflightApi;
  /** The selected spacecraft (null: none selected). */
  craft: BodyView | null;
  nowS: number;
  bodyName: (id: string) => string;
  disabled: boolean;
  /** The simulation is stopped at a collision: no burns. */
  halted: boolean;
}

type When = 'now' | 'periapsis' | 'apoapsis' | 'delay';

const NODE_STATUS: Record<ManeuverDto['status'], { label: string; color: string }> = {
  planned: { label: 'planned', color: theme.info },
  executing: { label: 'burning', color: theme.accent },
  executed: { label: 'executed', color: theme.ok },
  failed: { label: 'not executed', color: theme.danger },
};

function describeNode(m: ManeuverDto): string {
  if (m.deltaVMagnitudeMPerS === 0) return 'observation';
  if (m.frame === 'inertial') return `${formatSpeed(m.deltaVMagnitudeMPerS)} (inertial)`;
  const parts: string[] = [];
  if (m.progradeMPerS) parts.push(`${m.progradeMPerS > 0 ? 'prograde' : 'retrograde'} ${formatSpeed(Math.abs(m.progradeMPerS))}`);
  if (m.normalMPerS) parts.push(`${m.normalMPerS > 0 ? 'normal' : 'anti-normal'} ${formatSpeed(Math.abs(m.normalMPerS))}`);
  if (m.radialMPerS) parts.push(`${m.radialMPerS > 0 ? 'radial out' : 'radial in'} ${formatSpeed(Math.abs(m.radialMPerS))}`);
  return parts.join(', ');
}

/** Plan and execute burns of the selected spacecraft. A node changes the simulation only when the simulation reaches it. */
export const ManeuverPanel: React.FC<ManeuverPanelProps> = ({ api, craft, nowS, bodyName, disabled, halted }) => {
  const [when, setWhen] = useState<When>('now');
  const [delay, setDelay] = useState('600');
  const [prograde, setPrograde] = useState('0');
  const [normal, setNormal] = useState('0');
  const [radial, setRadial] = useState('0');
  const [mode, setMode] = useState<'impulsive' | 'finite'>('impulsive');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ManeuverPreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const craftId = craft?.id;
  const p = parseNumber(prograde), n = parseNumber(normal), r = parseNumber(radial), d = parseNumber(delay);
  const valid = p !== null && n !== null && r !== null && (when !== 'delay' || (d !== null && d >= 0));
  const nonZero = valid && (p !== 0 || n !== 0 || r !== 0);
  const request: ManeuverCreateDto | null = craftId && nonZero ? {
    at: when === 'delay' ? 'now' : when, ...(when === 'delay' ? { delayS: d! } : {}), mode,
    progradeMPerS: p!, normalMPerS: n!, radialMPerS: r!,
  } : null;
  // the orbit the node starts from changes as the craft moves; re-preview when its orbit changes materially, not every frame
  const orbitKey = craft?.spacecraft?.orbit ? `${craft.spacecraft.orbit.referenceBodyId}:${craft.spacecraft.orbit.semiMajorAxisM?.toPrecision(6)}:${craft.spacecraft.orbit.eccentricity?.toFixed(5)}` : '';
  const requestKey = request ? `${craftId}|${JSON.stringify(request)}|${orbitKey}|${craft?.massKg.toPrecision(8)}` : '';

  const latest = useRef(0);
  useEffect(() => {
    if (!request || !craftId) {
      setPreview(null);
      setPreviewError(null);
      return undefined;
    }
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      const result = await api.previewManeuver(craftId, request);
      if (ticket !== latest.current) return;
      if (result.ok) {
        setPreview(result.value);
        setPreviewError(null);
      } else {
        setPreview(null);
        setPreviewError(result.error);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, api.previewManeuver]);

  useEffect(() => setError(null), [craftId]);

  if (!craft || !craft.spacecraft) {
    return (
      <section aria-labelledby="maneuver-heading" style={drawerSectionStyle}>
        <h3 id="maneuver-heading" style={sectionTitleStyle}>Manoeuvres</h3>
        <p style={noteTextStyle}>Select a spacecraft to plan a burn.</p>
      </section>
    );
  }

  const nodes = api.maneuvers.filter((m) => m.spacecraftId === craft.id);
  const noEngine = craft.spacecraft.ispS <= 0;
  const immediate = when === 'now' && mode === 'impulsive';
  const submit = async () => {
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    const result = await api.addManeuver(craft.id, { ...request, label: immediate ? 'Manual burn' : 'Manual node' });
    setBusy(false);
    if (!result.ok) setError(result.error);
  };
  const remove = async (id: string) => {
    setError(null);
    const result = await api.deleteManeuver(id);
    if (!result.ok) setError(result.error);
  };

  return (
    <section aria-labelledby="maneuver-heading" style={drawerSectionStyle}>
      <h3 id="maneuver-heading" style={sectionTitleStyle}>Manoeuvres · {craft.name}</h3>
      {noEngine ? (
        <p role="status" style={noteTextStyle}>This spacecraft has no engine (specific impulse 0): it can only coast.</p>
      ) : (
        <form aria-label="New manoeuvre" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={grid2}>
            <SelectField id="mnv-when" label="When" value={when} onChange={(x) => setWhen(x as When)}
              options={[{ value: 'now', label: 'Now' }, { value: 'periapsis', label: 'At the next periapsis' }, { value: 'apoapsis', label: 'At the next apoapsis' }, { value: 'delay', label: 'After a delay' }]} />
            {when === 'delay'
              ? <NumberField id="mnv-delay" label="Delay" unit="s" value={delay} onChange={setDelay} invalid={d === null || d < 0} />
              : <SelectField id="mnv-mode" label="Burn" value={mode} onChange={(x) => setMode(x as 'impulsive' | 'finite')}
                  options={[{ value: 'impulsive', label: 'Impulsive (instant)' }, { value: 'finite', label: 'Finite (engine thrust)' }]} />}
            {when === 'delay' && <SelectField id="mnv-mode" label="Burn" value={mode} onChange={(x) => setMode(x as 'impulsive' | 'finite')}
              options={[{ value: 'impulsive', label: 'Impulsive (instant)' }, { value: 'finite', label: 'Finite (engine thrust)' }]} />}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <NumberField id="mnv-prograde" label="Prograde" unit="m/s" value={prograde} onChange={setPrograde} invalid={p === null} hint="− = retrograde" />
            <NumberField id="mnv-normal" label="Normal" unit="m/s" value={normal} onChange={setNormal} invalid={n === null} hint="− = anti-normal" />
            <NumberField id="mnv-radial" label="Radial out" unit="m/s" value={radial} onChange={setRadial} invalid={r === null} hint="− = radial in" />
          </div>
          <p style={{ ...noteTextStyle, fontSize: 10.5 }}>
            Components are in the spacecraft&apos;s orbit frame about {craft.spacecraft.orbit?.referenceBodyName ?? 'its reference body'}: along the velocity, along the orbit normal, and perpendicular to both.
          </p>

          {preview && (
            <div data-testid="maneuver-preview" style={{ padding: 9, borderRadius: 8, background: theme.tint }}>
              <Facts label="Predicted result">
                <Fact label="Periapsis altitude" value={`${formatLength(preview.before.periapsisAltitudeM)} → ${formatLength(preview.after.periapsisAltitudeM)}`} />
                <Fact label="Apoapsis altitude" testId="preview-apoapsis"
                  value={`${formatLength(preview.before.apoapsisAltitudeM)} → ${preview.after.regime === 'escape' ? 'escape' : formatLength(preview.after.apoapsisAltitudeM)}`} />
                <Fact label="Period" value={`${formatSpan(preview.before.periodS)} → ${formatSpan(preview.after.periodS)}`} />
                <Fact label="Propellant" value={formatMass(preview.propellantKg)} tone={preview.feasible ? undefined : 'danger'} />
                {mode === 'finite' && <Fact label="Burn duration" value={formatSpan(preview.burnDurationS)} />}
              </Facts>
              {!preview.feasible && <p role="status" style={{ ...noteTextStyle, color: theme.danger, marginTop: 4 }}>Not enough propellant: the burn would fall short.</p>}
              {preview.after.regime === 'suborbital' && <p role="status" style={{ ...noteTextStyle, color: theme.warn, marginTop: 4 }}>The new periapsis is below the surface: the spacecraft would impact.</p>}
              <p style={{ ...noteTextStyle, fontSize: 10.5, marginTop: 4 }}>
                Estimate for an instant burn from the {preview.basis}{mode === 'finite' ? '; a finite burn differs by its gravity losses' : ''}. The simulation decides the real result.
              </p>
            </div>
          )}
          {previewError && <p role="status" style={{ ...noteTextStyle, color: theme.danger }}>{previewError}</p>}
          {halted && <p role="status" style={noteTextStyle}>The simulation is stopped at a collision: no burns until it is cleared.</p>}
          <ErrorText>{error}</ErrorText>
          <div>
            <button type="submit" style={primaryBtnStyle} disabled={disabled || halted || busy || !request || previewError !== null}>
              {busy ? 'Working…' : immediate ? 'Burn now' : 'Add manoeuvre node'}
            </button>
          </div>
        </form>
      )}

      {nodes.length > 0 && (
        <ol aria-label="Manoeuvre nodes" style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[...nodes].reverse().map((m) => (
            <li key={m.id} data-testid="maneuver-node" data-status={m.status} style={{ padding: '7px 9px', borderRadius: 8, background: theme.tint, borderLeft: `2px solid ${NODE_STATUS[m.status].color}`, fontSize: 12, lineHeight: 1.45 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontWeight: 600 }}>{m.label || 'Manoeuvre'}</strong>
                <span style={{ color: NODE_STATUS[m.status].color }}>{NODE_STATUS[m.status].label}</span>
              </div>
              <div>{describeNode(m)}{m.referenceBodyId ? ` · about ${bodyName(m.referenceBodyId)}` : ''} · {m.mode}</div>
              <div style={{ color: theme.textMuted }}>
                {m.status === 'planned' && `${formatCountdown(m.startS, nowS)}${m.endS > m.startS ? ` · burn ${formatSpan(m.endS - m.startS)}` : ''} · ${formatMass(m.plannedPropellantKg)} propellant`}
                {m.status === 'executing' && `cutoff in ${formatSpan(m.endS - nowS)}`}
                {m.status === 'executed' && `delivered ${formatSpeed(m.deliveredDeltaVMPerS)} · used ${formatMass(m.propellantUsedKg)}`}
                {m.failure ? ` · ${m.failure}` : ''}
                {m.status === 'planned' && !m.feasible ? ' · not enough propellant' : ''}
              </div>
              {(m.status === 'planned' || m.status === 'executed' || m.status === 'failed') && (
                <button type="button" aria-label={`Remove node ${m.label || m.id}`} style={{ ...btnStyle, marginTop: 5, fontSize: 11, padding: '2px 8px' }}
                  title={m.missionId && m.status === 'planned' ? 'This node belongs to a mission: removing it ends the mission' : undefined}
                  disabled={disabled} onClick={() => void remove(m.id)}>
                  {m.status === 'planned' ? 'Remove' : 'Clear'}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
