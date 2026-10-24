import React, { useState } from 'react';
import type { PresetSummaryDto } from '../../api/types';
import { btnStyle, inputStyle, panelStyle } from './styles';
import { theme } from './theme';

interface PresetPickerProps {
  presets: readonly PresetSummaryDto[];
  disabled: boolean;
  onLoad: (presetId: string) => void;
}

/** Loading a preset always creates a new universe: nothing that exists is replaced or deleted. */
export const PresetPicker: React.FC<PresetPickerProps> = ({ presets, disabled, onLoad }) => {
  const [choice, setChoice] = useState('');
  const selected = presets.find((p) => p.id === choice) ?? presets.find((p) => p.available) ?? presets[0];
  if (presets.length === 0) return null;
  return (
    <section aria-label="Presets" style={{ ...panelStyle, width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Presets</h3>
      <label htmlFor="preset-select" style={{ fontSize: 12, color: theme.textMuted }}>Real system</label>
      <select
        id="preset-select"
        value={selected?.id ?? ''}
        onChange={(e) => setChoice(e.target.value)}
        style={inputStyle}
      >
        {presets.map((p) => (
          <option key={p.id} value={p.id} disabled={!p.available}>
            {p.name}{p.available ? '' : ' (unavailable)'}
          </option>
        ))}
      </select>
      {selected && (
        <p style={{ margin: 0, fontSize: 11, color: theme.textMuted }}>
          {selected.available
            ? `${selected.description} ${selected.bodyCount} bodies${selected.epochLabel ? `, epoch ${selected.epochLabel}` : ''}.`
            : `Not available: ${selected.unavailableReason ?? 'unknown reason'}`}
        </p>
      )}
      <button
        type="button"
        style={btnStyle}
        disabled={disabled || !selected || !selected.available}
        onClick={() => selected && onLoad(selected.id)}
      >
        Load as new universe
      </button>
      <p style={{ margin: 0, fontSize: 11, color: theme.textMuted }}>Creates a new universe; nothing existing is replaced.</p>
    </section>
  );
};
