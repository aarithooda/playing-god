import React from 'react';
import type { BodyView } from '../../sim/viewModel';
import { btnStyle, panelStyle } from './styles';
import { theme } from './theme';

interface BodyListProps {
  bodies: readonly Pick<BodyView, 'id' | 'name' | 'colorHex' | 'primaryId'>[];
  selectedBodyId?: string;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
}

/** Bodies in listing order with each moon indented under its primary (from the backend's `primaryId`). */
export function groupByPrimary<T extends { id: string; primaryId?: string }>(bodies: readonly T[]): { body: T; depth: 0 | 1 }[] {
  const ids = new Set(bodies.map((b) => b.id));
  const isMoon = (b: T) => b.primaryId !== undefined && b.primaryId !== b.id && ids.has(b.primaryId);
  const out: { body: T; depth: 0 | 1 }[] = [];
  for (const b of bodies) {
    if (isMoon(b)) continue;
    out.push({ body: b, depth: 0 });
    for (const m of bodies) if (isMoon(m) && m.primaryId === b.id) out.push({ body: m, depth: 1 });
  }
  return out;
}

/**
 * Every body by name. Moons sit inside their planet's disc from far away, so a list is the dependable way to find and
 * select one; a click selects (and labels the planet system), the focus button flies the camera there.
 * Shown only for scenes that have moons; a plain planetary scene is unchanged.
 */
export const BodyList: React.FC<BodyListProps> = ({ bodies, selectedBodyId, onSelect, onFocus }) => {
  if (!bodies.some((b) => b.primaryId !== undefined)) return null;
  return (
    <section aria-label="Bodies" style={{ ...panelStyle, width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Bodies</h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto' }}>
        {groupByPrimary(bodies).map(({ body, depth }) => {
          const selected = body.id === selectedBodyId;
          return (
            <li key={body.id} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: depth * 14 }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: body.colorHex, flex: '0 0 auto' }} />
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(body.id)}
                style={{ ...btnStyle, flex: 1, textAlign: 'left', border: 'none', background: selected ? theme.surfaceRaised : 'transparent', padding: '3px 6px' }}
              >
                {body.name}
              </button>
              <button type="button" aria-label={`Focus ${body.name}`} title="Focus" onClick={() => onFocus(body.id)} style={{ ...btnStyle, padding: '2px 6px' }}>
                ◎
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
