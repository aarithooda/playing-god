import React from 'react';
import { btnStyle, panelStyle } from './styles';
import { theme } from './theme';

/** Shown in the middle of the free area while the universe has no bodies. */
export const FirstUse: React.FC<{ onAddFirstBody: () => void; disabled?: boolean }> = ({ onAddFirstBody, disabled }) => (
  <div role="status" style={{ ...panelStyle, textAlign: 'center', maxWidth: 300 }}>
    <p style={{ margin: '0 0 4px 0', fontSize: 15, fontWeight: 600 }}>The universe is empty</p>
    <p style={{ margin: '0 0 12px 0', fontSize: 12, color: theme.textMuted }}>
      Create a body with a mass, a size, a position and a velocity, then watch gravity act on it.
    </p>
    <button
      type="button"
      onClick={onAddFirstBody}
      disabled={disabled}
      style={{ ...btnStyle, padding: '7px 14px', fontSize: 13, background: theme.accent, borderColor: theme.accent, color: '#06101f', fontWeight: 600 }}
    >
      Add your first body
    </button>
  </div>
);
