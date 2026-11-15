import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { OrbitDto, OrbitSpecDto } from '../../api/types';
import { formatAngle, formatLength, formatSpan, formatSpeed, parseNumber } from '../../sim/spaceflight/format';
import type { SpaceflightApi } from '../../sim/spaceflight/useSpaceflight';
import type { BodyView } from '../../sim/viewModel';
import { CraftGlyph, ErrorText, Fact, Facts, NumberField, SelectField, grid2 } from './flightUi';
import { btnStyle, drawerSectionStyle, noteTextStyle, primaryBtnStyle, sectionTitleStyle } from './styles';
import { theme } from './theme';

interface SpacecraftPanelProps {
  api: SpaceflightApi;
  bodies: readonly BodyView[];
  selectedBodyId?: string;
  onSelect: (id: string) => void;
  /** A spacecraft was created: the workspace selects it and flies the camera to its orbit. */
  onCreated: (id: string) => void;
  disabled: boolean;
  /** Why spacecraft cannot be added now (history view, an immutable run); shown instead of the form. */
  blockedReason?: string;
}

const WARNINGS: Record<string, string> = {
  escape_trajectory: 'This is an escape trajectory: the spacecraft will leave the body.',
  apoapsis_outside_sphere_of_influence: "The apoapsis lies outside the central body's sphere of influence: other bodies will dominate there.",
};

const DEFAULTS = {
  name: 'Explorer 1', altitudeKm: '300', eccentricity: '0', inclinationDeg: '0', raanDeg: '0', argPeriapsisDeg: '0', trueAnomalyDeg: '0',
  dryMassKg: '3000', propellantKg: '12000', thrustN: '50000', ispS: '450',
};

/** One-line description of where a spacecraft is, from the backend's osculating orbit. */
export function orbitSummary(orbit: OrbitDto | null | undefined): string {
  if (!orbit) return 'no body to orbit';
  if (orbit.regime === 'escape') return `escaping ${orbit.referenceBodyName}`;
  if (orbit.regime === 'degenerate') return `near ${orbit.referenceBodyName}`;
  const apsides = `${formatLength(orbit.periapsisAltitudeM)} × ${formatLength(orbit.apoapsisAltitudeM)}`;
  return orbit.regime === 'suborbital' ? `${orbit.referenceBodyName} · impact trajectory` : `${orbit.referenceBodyName} · ${apsides}`;
}

/** The spacecraft of the universe and the form that places a new one into an orbit about a body. */
export const SpacecraftPanel: React.FC<SpacecraftPanelProps> = ({ api, bodies, selectedBodyId, onSelect, onCreated, disabled, blockedReason }) => {
  const centralOptions = useMemo(() => bodies.filter((b) => b.kind !== 'spacecraft'), [bodies]);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(DEFAULTS);
  const [centralId, setCentralId] = useState('');
  const [planeOf, setPlaneOf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ orbit: OrbitDto; warnings: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // A sensible default body to orbit: the heaviest planet (a star makes a poor parking orbit), else the heaviest body.
  const defaultCentral = useMemo(() => {
    const planets = centralOptions.filter((b) => b.kind === 'planet');
    return [...(planets.length ? planets : centralOptions)].sort((a, b) => b.massKg - a.massKg)[0]?.id ?? '';
  }, [centralOptions]);
  const central = centralOptions.some((b) => b.id === centralId) ? centralId : defaultCentral;
  const planeOptions = centralOptions.filter((b) => b.id !== central);
  const plane = planeOptions.some((b) => b.id === planeOf) ? planeOf : '';

  const set = (key: keyof typeof DEFAULTS) => (value: string) => setV((old) => ({ ...old, [key]: value }));
  const numbers = {
    altitudeKm: parseNumber(v.altitudeKm), eccentricity: parseNumber(v.eccentricity), inclinationDeg: parseNumber(v.inclinationDeg),
    raanDeg: parseNumber(v.raanDeg), argPeriapsisDeg: parseNumber(v.argPeriapsisDeg), trueAnomalyDeg: parseNumber(v.trueAnomalyDeg),
    dryMassKg: parseNumber(v.dryMassKg), propellantKg: parseNumber(v.propellantKg), thrustN: parseNumber(v.thrustN), ispS: parseNumber(v.ispS),
  };
  const complete = central !== '' && v.name.trim() !== '' && Object.values(numbers).every((n) => n !== null);
  const orbitSpec: OrbitSpecDto | null = complete ? {
    centralBodyId: central, periapsisAltitudeM: numbers.altitudeKm! * 1000, eccentricity: numbers.eccentricity!,
    argPeriapsisDeg: numbers.argPeriapsisDeg!, trueAnomalyDeg: numbers.trueAnomalyDeg!,
    ...(plane ? { matchPlaneOfBodyId: plane } : { inclinationDeg: numbers.inclinationDeg!, raanDeg: numbers.raanDeg! }),
  } : null;
  const specKey = orbitSpec ? JSON.stringify(orbitSpec) + `|${numbers.dryMassKg! + numbers.propellantKg!}` : '';

  // The preview is the backend's answer for exactly this request (debounced); nothing is created by it.
  const latest = useRef(0);
  useEffect(() => {
    if (!open || !orbitSpec) {
      setPreview(null);
      setPreviewError(null);
      return undefined;
    }
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      const result = await api.previewOrbit(orbitSpec, numbers.dryMassKg! + numbers.propellantKg!);
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
  }, [open, specKey, api.previewOrbit]);

  const create = async () => {
    if (!orbitSpec || busy) return;
    setBusy(true);
    setError(null);
    const result = await api.createSpacecraft({
      name: v.name.trim(), dryMassKg: numbers.dryMassKg!, propellantKg: numbers.propellantKg!, thrustN: numbers.thrustN!, ispS: numbers.ispS!,
      orbit: orbitSpec,
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setV((old) => ({ ...DEFAULTS, name: nextName(old.name) }));
      onCreated(result.value.body.id);
    } else setError(result.error);
  };

  return (
    <section aria-labelledby="spacecraft-heading" style={{ ...drawerSectionStyle, borderTop: 'none', paddingTop: 0 }}>
      <h3 id="spacecraft-heading" style={sectionTitleStyle}>Spacecraft</h3>
      {api.spacecraft.length === 0 ? (
        <p style={noteTextStyle}>No spacecraft yet. A spacecraft is a body of this universe with propulsion: it is pulled by every other body and moves only by gravity and its own burns.</p>
      ) : (
        <ul aria-label="Spacecraft" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {api.spacecraft.map((craft) => (
            <li key={craft.id}>
              <button type="button" data-testid="spacecraft-row" aria-pressed={craft.id === selectedBodyId} onClick={() => onSelect(craft.id)}
                style={{
                  ...btnStyle, width: '100%', display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', padding: '8px 10px',
                  borderColor: craft.id === selectedBodyId ? theme.accentLine : theme.border, background: craft.id === selectedBodyId ? theme.accentSoft : theme.tint,
                }}>
                <CraftGlyph color={craft.colorHex} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{craft.name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: theme.textMuted, fontWeight: 400 }}>{orbitSummary(craft.spacecraft?.orbit)}</span>
                </span>
                <span style={{ fontSize: 11, color: theme.textMuted, fontWeight: 400, fontVariantNumeric: 'tabular-nums' }} title="Delta-v left in the tanks (rocket equation)">
                  Δv {formatSpeed(craft.spacecraft?.deltaVRemainingMPerS)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {blockedReason ? (
        <p role="status" style={noteTextStyle}>{blockedReason}</p>
      ) : !open ? (
        <button type="button" style={api.spacecraft.length === 0 ? primaryBtnStyle : btnStyle} disabled={disabled || centralOptions.length === 0}
          onClick={() => { setOpen(true); setError(null); }}>
          New spacecraft…
        </button>
      ) : (
        <form aria-label="New spacecraft" noValidate onSubmit={(e) => { e.preventDefault(); void create(); }}
          style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, borderRadius: 8, background: theme.tint, border: `1px solid ${theme.border}` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label htmlFor="craft-name" style={{ fontSize: 12, color: theme.textMuted }}>Name</label>
            <input id="craft-name" value={v.name} maxLength={64} onChange={(e) => set('name')(e.target.value)}
              style={{ background: 'var(--well)', border: `1px solid ${theme.borderStrong}`, color: theme.text, padding: '5px 7px', borderRadius: 7, fontSize: 12.5 }} />
          </div>
          <div style={grid2}>
            <SelectField id="craft-central" label="Orbit about" value={central} onChange={setCentralId}
              options={centralOptions.map((b) => ({ value: b.id, label: b.name }))} />
            <NumberField id="craft-altitude" label="Periapsis altitude" unit="km" value={v.altitudeKm} onChange={set('altitudeKm')} invalid={numbers.altitudeKm === null} />
            <NumberField id="craft-ecc" label="Eccentricity" value={v.eccentricity} onChange={set('eccentricity')} invalid={numbers.eccentricity === null} hint="0 = circular" />
            <NumberField id="craft-nu" label="True anomaly" unit="deg" value={v.trueAnomalyDeg} onChange={set('trueAnomalyDeg')} invalid={numbers.trueAnomalyDeg === null} hint="position on the orbit" />
          </div>
          <SelectField id="craft-plane" label="Orbit plane" value={plane} onChange={setPlaneOf}
            options={[{ value: '', label: 'From inclination and node (below)' }, ...planeOptions.map((b) => ({ value: b.id, label: `Match the plane of ${b.name}'s orbit` }))]} />
          <div style={grid2}>
            <NumberField id="craft-inc" label="Inclination" unit="deg" value={v.inclinationDeg} onChange={set('inclinationDeg')} disabled={plane !== ''} invalid={numbers.inclinationDeg === null} />
            <NumberField id="craft-raan" label="Ascending node" unit="deg" value={v.raanDeg} onChange={set('raanDeg')} disabled={plane !== ''} invalid={numbers.raanDeg === null} />
            <NumberField id="craft-argp" label="Arg. of periapsis" unit="deg" value={v.argPeriapsisDeg} onChange={set('argPeriapsisDeg')} invalid={numbers.argPeriapsisDeg === null} />
          </div>
          <p style={{ ...noteTextStyle, fontSize: 10.5 }}>
            Angles are measured from the simulation&apos;s x-y plane and +x axis (the ecliptic of J2000.0 in the Solar System presets, not a planet&apos;s equator).
          </p>
          <div style={grid2}>
            <NumberField id="craft-dry" label="Dry mass" unit="kg" value={v.dryMassKg} onChange={set('dryMassKg')} invalid={numbers.dryMassKg === null} />
            <NumberField id="craft-prop" label="Propellant" unit="kg" value={v.propellantKg} onChange={set('propellantKg')} invalid={numbers.propellantKg === null} />
            <NumberField id="craft-thrust" label="Thrust" unit="N" value={v.thrustN} onChange={set('thrustN')} invalid={numbers.thrustN === null} hint="0 = no engine" />
            <NumberField id="craft-isp" label="Specific impulse" unit="s" value={v.ispS} onChange={set('ispS')} invalid={numbers.ispS === null} />
          </div>

          {preview && (
            <div data-testid="orbit-preview" style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 8 }}>
              <Facts label="Orbit preview">
                <Fact label="Period" value={preview.orbit.periodS === null ? 'not a closed orbit' : formatSpan(preview.orbit.periodS)} testId="preview-period" />
                <Fact label="Speed at start" value={formatSpeed(preview.orbit.speedMPerS)} testId="preview-speed" />
                <Fact label="Apoapsis altitude" value={formatLength(preview.orbit.apoapsisAltitudeM)} />
                <Fact label="Inclination" value={formatAngle(preview.orbit.inclinationDeg)} />
              </Facts>
              {preview.warnings.map((w) => <p key={w} role="status" style={{ ...noteTextStyle, color: theme.warn, marginTop: 4 }}>{WARNINGS[w] ?? w}</p>)}
            </div>
          )}
          {previewError && <p role="status" data-testid="orbit-preview-error" style={{ ...noteTextStyle, color: theme.danger }}>{previewError}</p>}
          <ErrorText>{error}</ErrorText>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="submit" style={primaryBtnStyle} disabled={disabled || busy || !complete || previewError !== null}>{busy ? 'Creating…' : 'Create spacecraft'}</button>
            <button type="button" style={btnStyle} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
};

/** "Explorer 1" -> "Explorer 2": the next default name after a spacecraft was created. */
function nextName(name: string): string {
  const m = name.match(/^(.*?)(\d+)$/);
  return m ? `${m[1]}${Number(m[2]) + 1}` : DEFAULTS.name;
}
