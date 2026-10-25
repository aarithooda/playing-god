import React from 'react';
import { btnStyle, panelStyle, primaryBtnStyle } from './styles';
import { theme } from './theme';

interface FirstUseProps {
  onAddFirstBody: () => void;
  /** Opens the universes drawer, where the presets are. */
  onBrowsePresets?: () => void;
  disabled?: boolean;
}

/** Shown in the middle of the free area while the universe has no bodies. */
export const FirstUse: React.FC<FirstUseProps> = ({ onAddFirstBody, onBrowsePresets, disabled }) => (
  <div role="status" style={{ ...panelStyle, background: theme.glass, backdropFilter: 'blur(14px)', textAlign: 'center', maxWidth: 340, padding: '22px 24px 20px', borderRadius: 14 }}>
    <p style={{ margin: '0 0 6px 0', fontFamily: theme.serif, fontSize: 26, fontWeight: 600, lineHeight: 1.1 }}>The universe is empty</p>
    <p style={{ margin: '0 0 16px 0', fontSize: 12.5, color: theme.textMuted, lineHeight: 1.5 }}>
      Create a body with a mass, a size, a position and a velocity, then watch gravity act on it. Or start from a real system.
    </p>
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
      <button type="button" onClick={onAddFirstBody} disabled={disabled} style={{ ...primaryBtnStyle, padding: '8px 16px', fontSize: 13 }}>
        Add your first body
      </button>
      {onBrowsePresets && (
        <button type="button" onClick={onBrowsePresets} disabled={disabled} style={{ ...btnStyle, padding: '8px 14px', fontSize: 13 }}>
          Browse presets
        </button>
      )}
    </div>
  </div>
);
