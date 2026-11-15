import React, { useEffect, useState } from 'react';
import type { MissionDto, SpacecraftUpdateDto } from '../../api/types';
import { formatAngle, formatLength, formatMass, formatSpan, formatSpeed, parseNumber } from '../../sim/spaceflight/format';
import type { ActionResult } from '../../sim/useSimulation';
import type { BodyView } from '../../sim/viewModel';
import { CraftGlyph, ErrorText, Fact, Facts, MissionStatusBadge, NumberField, grid2 } from './flightUi';
import { Icon } from './Icon';
import { btnStyle, noteTextStyle, primaryBtnStyle } from './styles';
import { theme } from './theme';

interface SpacecraftInspectorProps {
  /** The selected spacecraft, confirmed backend state. */
  craft: BodyView;
  /** Its open or latest mission, if any. */
  mission?: MissionDto;
  focused?: boolean;
  /** When set, edits are blocked and this is why. */
  editBlockedReason?: string;
  onUpdate: (id: string, patch: SpacecraftUpdateDto) => Promise<ActionResult>;
  onDelete: (id: string) => Promise<ActionResult>;
  onFocus: (id: string) => void;
  onOpenMissions: () => void;
  onClose?: () => void;
}

const REGIME_NOTE: Record<string, string> = {
  escape: 'On an escape trajectory: it will leave this body unless it burns.',
  suborbital: 'The periapsis is below the surface: on this orbit it will impact.',
  degenerate: 'The motion is purely radial: there is no orbit to describe.',
};

const Readout: React.FC<{ label: string; value: string; testId?: string }> = ({ label, value, testId }) => (
  <div style={{ minWidth: 0 }}>
    <dt style={{ fontSize: 11, color: theme.textMuted, marginBottom: 2 }}>{label}</dt>
    <dd data-testid={testId} style={{ margin: 0, fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</dd>
  </div>
);

/**
 * The inspector of a spacecraft. Everything shown is the backend's: the propulsion state and the osculating orbit about the body
 * whose sphere of influence the spacecraft is in (an instantaneous two-body description, recomputed for every state).
 */
export const SpacecraftInspector: React.FC<SpacecraftInspectorProps> = ({ craft, mission, focused = false, editBlockedReason, onUpdate, onDelete, onFocus, onOpenMissions, onClose }) => {
  const sc = craft.spacecraft!;
  const orbit = sc.orbit;
  const [draft, setDraft] = useState({ dryMassKg: '', propellantKg: '', thrustN: '', ispS: '' });
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEditing(false);
    setConfirmDelete(false);
    setError(null);
  }, [craft.id]);

  const startEdit = () => {
    setDraft({ dryMassKg: String(sc.dryMassKg), propellantKg: String(Number(sc.propellantKg.toFixed(3))), thrustN: String(sc.thrustN), ispS: String(sc.ispS) });
    setEditing(true);
    setError(null);
  };
  const parsed = { dryMassKg: parseNumber(draft.dryMassKg), propellantKg: parseNumber(draft.propellantKg), thrustN: parseNumber(draft.thrustN), ispS: parseNumber(draft.ispS) };
  const draftValid = Object.values(parsed).every((n) => n !== null && n >= 0) && (parsed.dryMassKg ?? 0) > 0;
  const save = async () => {
    if (!draftValid) return;
    setBusy(true);
    setError(null);
    const result = await onUpdate(craft.id, { dryMassKg: parsed.dryMassKg!, propellantKg: parsed.propellantKg!, thrustN: parsed.thrustN!, ispS: parsed.ispS! });
    setBusy(false);
    if (result.ok) setEditing(false);
    else setError(result.error);
  };
  const remove = async () => {
    setBusy(true);
    const result = await onDelete(craft.id);
    setBusy(false);
    if (!result.ok) setError(result.error);
  };
  const fill = sc.propellantCapacityKg > 0 ? Math.min(1, Math.max(0, sc.propellantKg / sc.propellantCapacityKg)) : 0;

  return (
    <>
      <div className="pg-panel-head" style={{ alignItems: 'flex-start', paddingTop: 16, paddingBottom: 14 }}>
        <h2 className="sr-only">Spacecraft Inspector</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span aria-hidden="true" style={{ width: 46, height: 46, flex: '0 0 46px', borderRadius: 12, display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 35% 30%, #1b2536, #05070c 80%)', boxShadow: '0 0 0 1px var(--line)' }}>
            <CraftGlyph color={craft.colorHex} size={22} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div data-testid="inspector-name" style={{ fontFamily: theme.serif, fontSize: 25, fontWeight: 600, lineHeight: 1.05, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={craft.name}>{craft.name}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12, color: theme.textMuted }}>
              <span data-testid="spacecraft-kind">Spacecraft{orbit ? ` · ${orbit.regime === 'escape' ? 'leaving' : 'orbiting'} ${orbit.referenceBodyName}` : ''}{sc.thrusting ? ' · burning' : ''}</span>
              {focused && <span data-testid="focused-badge" style={{ fontSize: 10.5, color: theme.accent, border: `1px solid ${theme.accent}`, borderRadius: 999, padding: '0 7px', lineHeight: '16px' }}>Focused</span>}
            </div>
          </div>
        </div>
        <button type="button" className="pg-icon-btn pg-icon-btn--sm" aria-label="Close spacecraft inspector" title="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="pg-panel-body" style={{ gap: 14 }}>
        {orbit ? (
          <section aria-label="Orbit">
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', margin: 0 }}>
              <Readout label="Altitude" value={formatLength(orbit.altitudeM)} testId="readout-altitude" />
              <Readout label={`Speed (rel. ${orbit.referenceBodyName})`} value={formatSpeed(orbit.speedMPerS)} testId="readout-orbital-speed" />
              <Readout label="Periapsis altitude" value={formatLength(orbit.periapsisAltitudeM)} testId="readout-periapsis" />
              <Readout label="Apoapsis altitude" value={orbit.regime === 'escape' ? 'none (escape)' : formatLength(orbit.apoapsisAltitudeM)} testId="readout-apoapsis" />
              <Readout label="Period" value={orbit.periodS === null ? '—' : formatSpan(orbit.periodS)} testId="readout-period" />
              <Readout label="Eccentricity" value={orbit.eccentricity === null ? '—' : orbit.eccentricity.toFixed(5)} testId="readout-eccentricity" />
            </dl>
            {REGIME_NOTE[orbit.regime] && <p role="status" data-testid="regime-note" style={{ ...noteTextStyle, color: theme.warn, marginTop: 8 }}>{REGIME_NOTE[orbit.regime]}</p>}
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: theme.textMuted }}>Orbital elements and local speeds</summary>
              <div style={{ marginTop: 6 }}>
                <Facts label="Orbital elements">
                  <Fact label="Semi-major axis" value={formatLength(orbit.semiMajorAxisM)} testId="element-sma" />
                  <Fact label="Inclination" value={formatAngle(orbit.inclinationDeg)} testId="element-inclination" />
                  <Fact label="Ascending node" value={formatAngle(orbit.raanDeg)} />
                  <Fact label="Argument of periapsis" value={formatAngle(orbit.argPeriapsisDeg)} />
                  <Fact label="True anomaly" value={formatAngle(orbit.trueAnomalyDeg)} />
                  <Fact label="Time to periapsis" value={formatSpan(orbit.timeToPeriapsisS)} />
                  <Fact label="Time to apoapsis" value={formatSpan(orbit.timeToApoapsisS)} />
                  <Fact label="Circular speed here" value={formatSpeed(orbit.circularSpeedMPerS)} />
                  <Fact label="Escape speed here" value={formatSpeed(orbit.escapeSpeedMPerS)} />
                  <Fact label={`Sphere of influence of ${orbit.referenceBodyName}`} value={orbit.sphereOfInfluenceM === null ? 'unbounded here' : formatLength(orbit.sphereOfInfluenceM)} />
                </Facts>
              </div>
            </details>
            <p style={{ ...noteTextStyle, marginTop: 8, fontSize: 11 }}>
              The osculating two-body orbit of the present state about {orbit.referenceBodyName}, computed by the backend. Other bodies perturb it, so the
              elements drift; angles are measured from the simulation&apos;s x-y plane.
            </p>
          </section>
        ) : (
          <p style={noteTextStyle}>There is no body in this universe to describe an orbit about.</p>
        )}

        <section aria-label="Propulsion" style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 12 }}>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', margin: 0 }}>
            <Readout label="Delta-v remaining" value={formatSpeed(sc.deltaVRemainingMPerS)} testId="readout-delta-v" />
            <Readout label="Mass" value={formatMass(craft.massKg)} testId="readout-mass" />
          </dl>
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: theme.textMuted, marginBottom: 3 }}>
              <span>Propellant</span>
              <span data-testid="readout-propellant" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMass(sc.propellantKg)} of {formatMass(sc.propellantCapacityKg)}</span>
            </div>
            <div role="meter" aria-label="Propellant" aria-valuemin={0} aria-valuemax={sc.propellantCapacityKg} aria-valuenow={sc.propellantKg}
              style={{ height: 6, borderRadius: 3, background: 'var(--well)', overflow: 'hidden' }}>
              <div style={{ width: `${fill * 100}%`, height: '100%', background: fill < 0.1 ? theme.danger : theme.accent, transition: 'width 0.2s' }} />
            </div>
          </div>
          {!editing ? (
            <div style={{ marginTop: 10 }}>
              <Facts label="Engine">
                <Fact label="Dry mass" value={formatMass(sc.dryMassKg)} />
                <Fact label="Thrust" value={sc.thrustN > 0 ? `${sc.thrustN.toLocaleString('en-US')} N` : 'no engine'} />
                <Fact label="Specific impulse" value={sc.ispS > 0 ? `${sc.ispS} s` : '—'} />
                <Fact label="Mass flow at full thrust" value={sc.massFlowKgPerS > 0 ? `${Number(sc.massFlowKgPerS.toPrecision(4))} kg/s` : '—'} />
              </Facts>
            </div>
          ) : (
            <form aria-label="Edit propulsion" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={grid2}>
                <NumberField id="sc-dry" label="Dry mass" unit="kg" value={draft.dryMassKg} onChange={(x) => setDraft((d) => ({ ...d, dryMassKg: x }))} invalid={!(parsed.dryMassKg !== null && parsed.dryMassKg > 0)} />
                <NumberField id="sc-prop" label="Propellant" unit="kg" value={draft.propellantKg} onChange={(x) => setDraft((d) => ({ ...d, propellantKg: x }))} invalid={parsed.propellantKg === null} />
                <NumberField id="sc-thrust" label="Thrust" unit="N" value={draft.thrustN} onChange={(x) => setDraft((d) => ({ ...d, thrustN: x }))} invalid={parsed.thrustN === null} />
                <NumberField id="sc-isp" label="Specific impulse" unit="s" value={draft.ispS} onChange={(x) => setDraft((d) => ({ ...d, ispS: x }))} invalid={parsed.ispS === null} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="submit" style={primaryBtnStyle} disabled={busy || !draftValid}>Apply</button>
                <button type="button" style={btnStyle} onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
              </div>
            </form>
          )}
        </section>

        {mission && (
          <section aria-label="Mission" style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 12.5 }}>{mission.name}</strong>
              <MissionStatusBadge status={mission.status} committed={mission.committed} />
            </div>
            <p style={{ ...noteTextStyle, marginTop: 4 }}>{mission.phase}</p>
          </section>
        )}

        <p style={{ ...noteTextStyle, margin: 0, fontFamily: theme.mono, fontSize: 10.5, color: theme.textFaint }}>{craft.id} · SI units · collision radius {craft.radiusM} m</p>
        {editBlockedReason && <p role="status" style={noteTextStyle}>{editBlockedReason}</p>}
        <ErrorText>{error}</ErrorText>
        {confirmDelete && (
          <div role="group" aria-label={`Delete ${craft.name}?`} style={{ border: `1px solid ${theme.danger}`, borderRadius: 8, padding: 10, background: theme.dangerSoft }}>
            <strong style={{ fontSize: 12.5 }}>Delete {craft.name}?</strong>
            <p style={{ ...noteTextStyle, margin: '5px 0 8px' }}>This removes the spacecraft and its pending manoeuvre nodes. A mission that uses it ends.</p>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" style={btnStyle} onClick={() => setConfirmDelete(false)} disabled={busy}>Keep</button>
              <button type="button" style={{ ...btnStyle, borderColor: theme.danger, color: theme.danger }} onClick={() => void remove()} disabled={busy}>{busy ? 'Deleting…' : 'Delete spacecraft'}</button>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" style={primaryBtnStyle} onClick={onOpenMissions}>Plan a manoeuvre</button>
          <button type="button" style={btnStyle} onClick={() => onFocus(craft.id)} title="Fly the camera to this spacecraft's orbit and follow it">Focus</button>
          {!editing && <button type="button" style={btnStyle} onClick={startEdit} disabled={!!editBlockedReason || sc.thrusting}>Edit propulsion</button>}
          <span style={{ flex: 1 }} />
          {!confirmDelete && <button type="button" style={{ ...btnStyle, color: theme.danger, borderColor: theme.dangerLine }} onClick={() => setConfirmDelete(true)} disabled={busy || !!editBlockedReason}>Delete</button>}
        </div>
      </div>
    </>
  );
};
