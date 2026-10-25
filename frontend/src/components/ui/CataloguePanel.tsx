import React, { useState } from 'react';
import type { CatalogueEntryDto } from '../../api/types';
import { resolveCelestialAssets } from '../../assets/registry';
import { btnStyle, drawerSectionStyle } from './styles';
import { theme } from './theme';

interface CataloguePanelProps {
  entries: readonly CatalogueEntryDto[];
  onPlace: (entry: CatalogueEntryDto) => void;
  disabled: boolean;
}

/** A compact picker: choose a body, then click in the scene to place it. */
export const CataloguePanel: React.FC<CataloguePanelProps> = ({ entries, onPlace, disabled }) => {
  // One set is always shown: the catalogue lives in a persistent drawer, so a click elsewhere must not empty it.
  const [activeGroupId, setActiveGroupId] = useState('stars');
  if (entries.length === 0) return null;
  const groups = [
    { id: 'stars', name: 'Stars', entries: entries.filter((entry) => entry.kind === 'star') },
    { id: 'planets', name: 'Planets', entries: entries.filter((entry) => entry.kind !== 'star' && entry.bodyType !== 'moon') },
    { id: 'moons', name: 'Moons', entries: entries.filter((entry) => entry.bodyType === 'moon') },
  ];
  const activeGroup = groups.find((group) => group.id === activeGroupId);
  return (
    <section aria-label="Body catalogue" style={{ ...drawerSectionStyle, width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Body catalogue</h3>
      <div role="tablist" aria-label="Body sets" style={{ display: 'flex', gap: 5 }}>
        {groups.map((group) => {
          const selected = group.id === activeGroupId;
          return (
            <button
              key={group.id}
              type="button"
              role="tab"
              id={`catalogue-tab-${group.id}`}
              aria-selected={selected}
              aria-controls={`catalogue-grid-${group.id}`}
              onClick={() => setActiveGroupId(group.id)}
              style={{
                ...btnStyle,
                flex: 1,
                padding: '6px 3px',
                borderColor: selected ? 'rgba(235,199,127,0.45)' : theme.border,
                background: selected ? theme.accentSoft : 'transparent',
                color: selected ? theme.text : theme.textMuted,
                fontWeight: selected ? 700 : 500,
              }}
            >
              {group.name}
            </button>
          );
        })}
      </div>
      {activeGroup && (
        <div
          role="tabpanel"
          id={`catalogue-grid-${activeGroup.id}`}
          aria-labelledby={`catalogue-tab-${activeGroup.id}`}
          data-testid={`catalogue-group-${activeGroup.id}`}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}
        >
          {activeGroup.entries.map((entry) => {
            const bodyType = entry.bodyType ?? (entry.kind === 'star' ? 'star' : 'default');
            const image = resolveCelestialAssets(entry.assetKey, bodyType)?.diffuse;
            return (
              <button
                key={entry.id}
                type="button"
                data-testid={`catalogue-entry-${entry.id}`}
                aria-label={`Place ${entry.name}`}
                title={disabled ? `${entry.name} cannot be placed in the current view.` : `Place ${entry.name}: click here, then click a position in the scene.`}
                disabled={disabled}
                onClick={() => onPlace(entry)}
                style={{
                  ...btnStyle,
                  minWidth: 0,
                  minHeight: 84,
                  padding: '7px 4px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  borderColor: theme.border,
                }}
              >
                {image ? (
                  <img
                    src={image}
                    alt={`${entry.name} preview`}
                    draggable={false}
                    style={{
                      width: 44,
                      height: 44,
                      flex: '0 0 44px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      backgroundColor: entry.visual.colorHex,
                      boxShadow: '0 1px 7px #0009',
                    }}
                  />
                ) : (
                  <span aria-hidden="true" style={{ width: 44, height: 44, borderRadius: '50%', background: entry.visual.colorHex }} />
                )}
                <span style={{ width: '100%', fontSize: 11, lineHeight: 1.2, textAlign: 'center', overflowWrap: 'anywhere' }}>
                  {entry.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
