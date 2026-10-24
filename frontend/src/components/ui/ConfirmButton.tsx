import React, { useEffect, useState } from 'react';
import { btnStyle } from './styles';
import { theme } from './theme';

interface ConfirmButtonProps {
  label: string;
  /** Text of the second, confirming button. Defaults to "Confirm: <label>". */
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  title?: string;
  style?: React.CSSProperties;
}

/**
 * A destructive action needs two deliberate presses: the first arms it, the second runs it. An armed button disarms
 * itself after a few seconds, so a forgotten prompt cannot be confirmed by a stray later click.
 */
export const ConfirmButton: React.FC<ConfirmButtonProps> = ({ label, confirmLabel, onConfirm, disabled, title, style }) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => {
    if (disabled) setArmed(false);
  }, [disabled]);

  if (!armed) {
    return (
      <button type="button" style={{ ...btnStyle, ...style }} disabled={disabled} title={title} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <button
        type="button"
        style={{ ...btnStyle, ...style, borderColor: theme.danger, color: theme.danger }}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel ?? `Confirm: ${label}`}
      </button>
      <button type="button" style={{ ...btnStyle, ...style }} onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
};
