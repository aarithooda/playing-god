import React from 'react';
import type { PresetSummaryDto } from '../../api/types';
import { btnStyle, noteTextStyle, sectionTitleStyle } from './styles';
import { theme } from './theme';

interface PresetPickerProps {
  presets: readonly PresetSummaryDto[];
  disabled: boolean;
  onLoad: (presetId: string) => void;
}

/**
 * Scenarios that are designed but have no preset data yet. They are listed as plans, never as loadable cards: the
 * backend offers no such preset, so there is nothing real to load.
 */
export const PLANNED_SCENARIOS: readonly { name: string; note: string }[] = [
  { name: 'Saturn and its rings', note: 'needs sourced ring and moon data' },
  { name: 'Collision playground', note: 'needs a curated set of impact scenarios' },
];

/** A small orrery drawn from the preset's own facts (it has moons or not); decorative, not a map of positions. */
const PresetArt: React.FC<{ withMoons: boolean; dimmed: boolean }> = ({ withMoons, dimmed }) => (
  <svg viewBox="0 0 96 72" width="96" height="72" aria-hidden="true" style={{ flex: '0 0 96px', borderRadius: 8, background: '#020306', opacity: dimmed ? 0.45 : 1 }}>
    <defs>
      <radialGradient id={`sun-${withMoons}`} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fff7e0" />
        <stop offset="45%" stopColor="#f4d58e" />
        <stop offset="100%" stopColor="#f4d58e" stopOpacity="0" />
      </radialGradient>
    </defs>
    {[14, 22, 31, 41].map((rx, i) => (
      <ellipse key={rx} cx="48" cy="36" rx={rx} ry={rx * 0.42} fill="none" stroke="rgba(214,222,235,0.2)" strokeWidth={i === 2 ? 0.9 : 0.6} />
    ))}
    <circle cx="48" cy="36" r="9" fill={`url(#sun-${withMoons})`} />
    <circle cx="48" cy="36" r="3" fill="#fff8e6" />
    <circle cx="61" cy="39.5" r="1.5" fill="#8fb3f0" />
    <circle cx="28" cy="31" r="2.6" fill="#d9b48a" />
    <circle cx="86" cy="40" r="2" fill="#c9b27c" />
    {withMoons && (
      <>
        <ellipse cx="28" cy="31" rx="6" ry="2.6" fill="none" stroke="rgba(214,222,235,0.35)" strokeWidth={0.5} />
        <circle cx="33.6" cy="31.8" r="0.8" fill="#eeeae0" />
        <circle cx="23" cy="30" r="0.7" fill="#eeeae0" />
        <circle cx="61" cy="39.5" r="3.2" fill="none" stroke="rgba(214,222,235,0.35)" strokeWidth={0.5} />
      </>
    )}
  </svg>
);

/** Loading a preset always creates a new universe: nothing that exists is replaced or deleted. */
export const PresetPicker: React.FC<PresetPickerProps> = ({ presets, disabled, onLoad }) => {
  if (presets.length === 0) return null;
  return (
    <section aria-label="Presets" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <h3 style={sectionTitleStyle}>Start from a real system</h3>
        <p style={noteTextStyle}>Creates a new universe; nothing existing is replaced.</p>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {presets.map((p) => {
          const titleId = `preset-${p.id}-title`;
          return (
            <li key={p.id}>
              <article
                aria-labelledby={titleId}
                data-testid={`preset-${p.id}`}
                style={{
                  display: 'flex', gap: 12, padding: 10, borderRadius: 10, background: 'rgba(255,255,255,0.025)',
                  border: `1px solid ${theme.border}`,
                }}
              >
                <PresetArt withMoons={p.id.includes('moons')} dimmed={!p.available} />
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <h4 id={titleId} style={{ margin: 0, fontFamily: theme.serif, fontSize: 17, fontWeight: 600, lineHeight: 1.15 }}>{p.name}</h4>
                  {p.available ? (
                    <>
                      <p style={{ ...noteTextStyle, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={p.description}>
                        {p.description}
                      </p>
                      <p style={{ ...noteTextStyle, color: theme.textFaint, fontVariantNumeric: 'tabular-nums' }}>
                        {p.bodyCount} bodies{p.epochLabel ? `, epoch ${p.epochLabel}` : ''}
                      </p>
                    </>
                  ) : (
                    <p style={{ ...noteTextStyle, color: theme.warn }}>Not available: {p.unavailableReason ?? 'unknown reason'}</p>
                  )}
                  <button
                    type="button"
                    aria-label={`Load ${p.name} as new universe`}
                    style={{ ...btnStyle, alignSelf: 'flex-start', marginTop: 2 }}
                    disabled={disabled || !p.available}
                    onClick={() => onLoad(p.id)}
                  >
                    Load as new universe
                  </button>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
      <div data-testid="planned-scenarios" style={{ paddingTop: 2 }}>
        <p style={{ ...noteTextStyle, color: theme.textFaint }}>
          Planned, not built yet:{' '}
          {PLANNED_SCENARIOS.map((s, i) => (
            <span key={s.name}>{s.name} ({s.note}){i < PLANNED_SCENARIOS.length - 1 ? '; ' : '.'}</span>
          ))}
        </p>
      </div>
    </section>
  );
};
