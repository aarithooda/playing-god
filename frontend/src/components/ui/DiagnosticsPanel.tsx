import React, { useState } from 'react';
import type { DiagnosticsDto } from '../../api/types';
import {
  formatScalar,
  formatVector,
  kineticPlusPotential,
  orbitalPlusBookedSpin,
} from '../../sim/diagnosticsFormat';
import type { LoadStatus } from '../../sim/useSimulation';
import { labelStyle, panelStyle } from './styles';

interface DiagnosticsPanelProps {
  loadStatus: LoadStatus;
  /** Backend diagnostics; null when missing or untrusted (then `issue` says why). */
  diagnostics: DiagnosticsDto | null;
  issue: string | null;
}

const noteStyle: React.CSSProperties = { fontSize: '10px', opacity: 0.55, marginTop: '2px' };

interface RowProps {
  id: string;
  label: string;
  value: string;
  note?: string;
}

const Row: React.FC<RowProps> = ({ id, label, value, note }) => (
  <div data-testid={`diag-${id}`} style={{ marginBottom: '8px' }}>
    <div style={labelStyle}>{label}</div>
    <div data-testid={`diag-${id}-value`} style={{ fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </div>
    {note && <div style={noteStyle}>{note}</div>}
  </div>
);

/** System-level (all bodies) diagnostics, exactly as computed by the backend; collapsed by default. */
export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({ loadStatus, diagnostics, issue }) => {
  const [open, setOpen] = useState(false);

  let body: React.ReactNode;
  if (loadStatus !== 'ready') {
    body = (
      <p role="status" style={{ fontSize: '12px', opacity: 0.6, margin: 0 }}>
        {loadStatus === 'loading'
          ? 'Waiting for the simulation…'
          : 'Diagnostics unavailable: the simulation could not be loaded.'}
      </p>
    );
  } else if (diagnostics === null) {
    body = (
      <p role="status" data-testid="diag-unavailable" style={{ fontSize: '12px', color: '#ffb366', margin: 0 }}>
        Diagnostics unavailable: {issue ?? 'no diagnostics were provided'}.
      </p>
    );
  } else {
    const kPlusU = kineticPlusPotential(diagnostics);
    const lPlusS = orbitalPlusBookedSpin(diagnostics);
    body = (
      <>
        <p style={{ ...noteStyle, marginTop: 0, marginBottom: '10px' }}>
          Whole system (all bodies), not the selected body. Values come from the backend.
        </p>
        <Row id="mass" label="Total mass (totalMassKg)" value={formatScalar(diagnostics.totalMassKg, 'kg')} />
        <Row
          id="momentum"
          label="Total momentum (totalMomentumKgMPerS)"
          value={formatVector(diagnostics.totalMomentumKgMPerS, 'kg·m/s')}
        />
        <Row
          id="kinetic"
          label="Kinetic energy (kineticEnergyJ)"
          value={formatScalar(diagnostics.kineticEnergyJ, 'J')}
        />
        <Row
          id="potential"
          label="Gravitational potential energy (potentialEnergyJ)"
          value={formatScalar(diagnostics.potentialEnergyJ, 'J')}
          note="Point-mass approximation: −G Σ m₁m₂/r over body pairs, zero at infinite separation."
        />
        <Row
          id="angular"
          label="Angular momentum about the origin (angularMomentumAboutOriginKgM2PerS)"
          value={formatVector(diagnostics.angularMomentumAboutOriginKgM2PerS, 'kg·m²/s')}
          note="Measured about the fixed simulation origin (0, 0, 0), not the centre of mass."
        />
        <Row
          id="spin"
          label="Booked spin, bookkeeping only (bookedSpinKgM2PerS)"
          value={formatVector(diagnostics.bookedSpinKgM2PerS, 'kg·m²/s')}
          note="Orbital angular momentum booked by mergers. No rotation is simulated and it carries no energy."
        />
        <div style={{ borderTop: '1px solid #444', paddingTop: '8px', marginTop: '4px' }}>
          <div style={{ ...labelStyle, marginBottom: '6px' }}>
            Derived here by adding backend values (not backend diagnostics)
          </div>
          <Row
            id="k-plus-u"
            label="Kinetic + potential energy"
            value={formatScalar(kPlusU, 'J')}
            note="Not conserved across mergers: a merger removes translational kinetic energy."
          />
          <Row
            id="l-plus-spin"
            label="Angular momentum about origin + booked spin"
            value={formatVector(lPlusS, 'kg·m²/s')}
            note="Accounting sum. Adding, editing or deleting bodies, or a reset, changes it."
          />
        </div>
      </>
    );
  }

  return (
    <div
      style={{
        ...panelStyle,
        position: 'absolute',
        bottom: '20px',
        left: '20px',
        width: '320px',
        maxHeight: '60vh',
        overflowY: 'auto',
        boxSizing: 'border-box',
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="diagnostics-body"
        onClick={() => setOpen((o) => !o)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          width: '100%',
          opacity: 0.85,
        }}
      >
        <h3 style={{ margin: 0, fontSize: '14px' }}>System diagnostics</h3>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div id="diagnostics-body" style={{ marginTop: '12px' }}>
          {body}
        </div>
      )}
    </div>
  );
};
