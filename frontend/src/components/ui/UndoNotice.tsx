import React from 'react';
import { btnStyle, panelStyle } from './styles';

interface UndoNoticeProps {
  /** Name of the body that was just created. */
  bodyName: string;
  onUndo: () => void;
  onDismiss: () => void;
}

/** Brief confirmation after a body is created, with a one-click undo (deletes that body). */
export const UndoNotice: React.FC<UndoNoticeProps> = ({ bodyName, onUndo, onDismiss }) => (
  <div role="status" style={{
    ...panelStyle,
    position: 'absolute',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    fontSize: '13px',
    width: 'max-content',
    maxWidth: 'calc(100% - 32px)',
  }}>
    <span>Created {bodyName}</span>
    <button type="button" style={btnStyle} onClick={onUndo}>Undo</button>
    <button type="button" aria-label="Dismiss" title="Dismiss" style={{ ...btnStyle, padding: '2px 7px' }} onClick={onDismiss}>×</button>
  </div>
);
