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
  /** Accessible name of the first button when its visible label is shorter (the visible label must be part of it). */
  ariaLabel?: string;
  /** Shown before the label in the first button. */
  icon?: React.ReactNode;
  style?: React.CSSProperties;
  /** Class of the first button, for layouts that restyle it (for example an icon-only form on a phone). */
  className?: string;
}

/**
 * A destructive action needs two deliberate presses: the first arms it, the second runs it. An armed button disarms
 * itself after a few seconds, so a forgotten prompt cannot be confirmed by a stray later click.
 */
export const ConfirmButton: React.FC<ConfirmButtonProps> = ({ label, confirmLabel, onConfirm, disabled, title, ariaLabel, icon, style, className }) => {
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
      <button
        type="button"
        className={className}
        style={{ ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 6, ...style }}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        onClick={() => setArmed(true)}
      >
        {icon}
        <span className="pg-confirm__label">{label}</span>
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <button
        type="button"
        style={{ ...btnStyle, ...style, borderColor: theme.danger, color: theme.danger, background: theme.dangerSoft }}
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
