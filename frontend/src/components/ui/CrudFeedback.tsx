import React, { useEffect, useState } from 'react';
import { panelStyle } from './styles';
import { theme } from './theme';

export type CrudFeedbackTone = 'success' | 'error';

interface CrudFeedbackProps {
  message: string;
  tone: CrudFeedbackTone;
  durationMs?: number;
  onDismiss: () => void;
  onUndo?: () => Promise<unknown> | unknown;
}

/** Bottom-of-screen confirmation or error for a body add, edit, or delete. */
export const CrudFeedback: React.FC<CrudFeedbackProps> = ({
  message,
  tone,
  durationMs = 5000,
  onDismiss,
  onUndo,
}) => {
  const [filled, setFilled] = useState(false);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    const start = window.setTimeout(() => setFilled(true), 0);
    const dismiss = window.setTimeout(onDismiss, durationMs);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(dismiss);
    };
  }, [durationMs, onDismiss]);

  const color = tone === 'error' ? theme.danger : theme.accent;

  const undo = async () => {
    if (!onUndo || undoing) return;
    setUndoing(true);
    await onUndo();
  };

  return (
    <div
      data-testid="crud-feedback"
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      style={{
        ...panelStyle,
        position: 'fixed',
        left: '50%',
        bottom: 18,
        transform: 'translateX(-50%)',
        zIndex: 2000,
        width: 'min(420px, calc(100vw - 32px))',
        padding: '10px 12px 7px',
        borderColor: tone === 'error' ? theme.danger : theme.borderStrong,
        boxShadow: '0 8px 28px rgba(0, 0, 0, 0.45)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 13 }}>{message}</div>
        {onUndo && (
          <button
            type="button"
            onClick={() => void undo()}
            disabled={undoing}
            style={{
              flex: 'none', padding: '4px 10px', cursor: undoing ? 'wait' : 'pointer',
              background: theme.surfaceRaised, color: theme.text,
              border: `1px solid ${theme.borderStrong}`, borderRadius: 4,
              fontSize: 12, fontFamily: theme.font,
            }}
          >
            {undoing ? 'Undoing…' : 'Undo'}
          </button>
        )}
      </div>
      <div
        aria-hidden="true"
        style={{ height: 3, marginTop: 9, borderRadius: 2, overflow: 'hidden', background: theme.border }}
      >
        <div
          data-testid="crud-feedback-progress"
          style={{
            width: filled ? '100%' : '0%',
            height: '100%',
            background: color,
            transition: `width ${durationMs}ms linear`,
          }}
        />
      </div>
    </div>
  );
};