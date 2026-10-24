import React, { useState } from 'react';
import type { CatalogueEntryDto, CataloguePropertyDto } from '../../api/types';
import { btnStyle, panelStyle } from './styles';
import { theme } from './theme';

interface CataloguePanelProps {
  entries: readonly CatalogueEntryDto[];
  notes: readonly string[];
  /** Hands the entry over as a starting point for the create form. The catalogue itself is never changed. */
  onAdd: (entry: CatalogueEntryDto) => void;
  disabled: boolean;
}

function fmt(x: number): string {
  return x.toExponential(4).replace(/\.?0+e/, 'e').replace('e+', 'e');
}

/** The value as published (with its unit), plus the SI value and its uncertainty where the source gave one. */
function describe(p: CataloguePropertyDto, unit: string): string {
  const u = p.uncertainty;
  let spread = '';
  if (u && 'range' in u) spread = ` (published range ${fmt(u.range[0])}–${fmt(u.range[1])} ${unit})`;
  else if (u) spread = u.minus === u.plus ? ` ± ${fmt(u.plus)} ${unit}` : ` (−${fmt(u.minus)} / +${fmt(u.plus)} ${unit})`;
  return `${fmt(p.value)} ${unit}${spread}`;
}

const BADGE: React.CSSProperties = {
  fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: theme.warn, border: `1px solid ${theme.warn}`,
  borderRadius: 3, padding: '1px 5px', marginLeft: 6,
};

/** A discoverable list of sourced single bodies. Estimated and illustrative values are disclosed wherever shown. */
export const CataloguePanel: React.FC<CataloguePanelProps> = ({ entries, notes, onAdd, disabled }) => {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  return (
    <section aria-label="Body catalogue" style={{ ...panelStyle, width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Body catalogue</h3>
        <button type="button" style={btnStyle} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <>
          {entries.map((e) => {
            const estimated = e.properties.massKg.basis === 'estimated' || e.properties.radiusM.basis === 'estimated';
            const illustrative = e.properties.massKg.basis === 'illustrative' || e.properties.radiusM.basis === 'illustrative';
            return (
              <div key={e.id} data-testid={`catalogue-entry-${e.id}`} style={{ background: theme.surfaceRaised, borderRadius: 4, padding: 8, fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    title="Colour: display only, not a physical property"
                    style={{ width: 10, height: 10, borderRadius: '50%', background: e.visual.colorHex, display: 'inline-block' }}
                  />
                  <strong>{e.name}</strong>
                  <span style={{ color: theme.textMuted }}>{e.kind}</span>
                  {estimated && <span style={BADGE}>Estimated</span>}
                  {illustrative && <span style={BADGE}>Illustrative</span>}
                </div>
                <div>Mass: {describe(e.properties.massKg, 'kg')}</div>
                <div style={{ color: theme.textMuted, fontSize: 11 }}>as published: {e.properties.massKg.sourceValue}</div>
                <div>Radius: {describe(e.properties.radiusM, 'm')}</div>
                <div style={{ color: theme.textMuted, fontSize: 11 }}>as published: {e.properties.radiusM.sourceValue}</div>
                {[e.properties.massKg, e.properties.radiusM].map((p, i) => p.note && (
                  <div key={i} style={{ color: theme.warn, fontSize: 11 }}>{i === 0 ? 'Mass' : 'Radius'}: {p.note}</div>
                ))}
                <div style={{ color: theme.textMuted, fontSize: 11 }}>
                  Source: {e.properties.massKg.sources[0]?.citation}
                  {e.properties.radiusM.sources[0]?.citation !== e.properties.massKg.sources[0]?.citation
                    ? `; radius: ${e.properties.radiusM.sources[0]?.citation}` : ''}
                </div>
                {e.notes && <div style={{ color: theme.textMuted, fontSize: 11 }}>{e.notes}</div>}
                <button
                  type="button"
                  style={{ ...btnStyle, marginTop: 6 }}
                  disabled={disabled}
                  aria-label={`Add ${e.name} to this universe…`}
                  onClick={() => onAdd(e)}
                >
                  Add to this universe…
                </button>
              </div>
            );
          })}
          {notes.map((n) => (
            <p key={n} style={{ margin: 0, fontSize: 11, color: theme.textMuted }}>{n}</p>
          ))}
        </>
      )}
    </section>
  );
};
