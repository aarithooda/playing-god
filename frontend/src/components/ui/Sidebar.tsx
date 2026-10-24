import React from 'react';
import { SIDEBAR_OPEN_WIDTH, SIDEBAR_RAIL_WIDTH } from './layout';
import { theme } from './theme';

interface SidebarProps {
  side: 'left' | 'right';
  /** Shown beside the toggle when open and rotated along the rail when closed. */
  title: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: React.ReactNode;
}

/**
 * A solid, full-height side panel. Its content stays mounted while collapsed (so drafts and form
 * state survive) but is hidden from sight, pointer and keyboard.
 */
export const Sidebar: React.FC<SidebarProps> = ({ side, title, open, onToggle, children }) => {
  const left = side === 'left';
  const arrow = left ? (open ? '‹' : '›') : open ? '›' : '‹';
  return (
    <aside
      aria-label={title}
      data-testid={`sidebar-${side}`}
      data-open={open}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [left ? 'left' : 'right']: 0,
        width: open ? SIDEBAR_OPEN_WIDTH : SIDEBAR_RAIL_WIDTH,
        background: theme.bg,
        [left ? 'borderRight' : 'borderLeft']: `1px solid ${theme.border}`,
        boxSizing: 'border-box',
        overflow: 'hidden',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        color: theme.text,
        fontFamily: theme.font,
        transition: 'width 0.25s ease-in-out',
        pointerEvents: 'auto',
      }}
    >
      <div style={{
        display: 'flex',
        flexDirection: left ? 'row' : 'row-reverse',
        alignItems: 'center',
        justifyContent: open ? 'space-between' : 'center',
        height: 40,
        flex: '0 0 40px',
        padding: open ? '0 8px 0 12px' : 0,
        borderBottom: `1px solid ${theme.border}`,
      }}>
        {open && <span style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: theme.textMuted }}>{title}</span>}
        <button
          type="button"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
          aria-expanded={open}
          onClick={() => onToggle(!open)}
          style={{
            width: 28, height: 28, cursor: 'pointer', background: 'transparent', color: theme.text,
            border: `1px solid ${theme.border}`, borderRadius: 4, fontSize: 16, lineHeight: 1,
          }}
        >
          {arrow}
        </button>
      </div>
      {!open && (
        <div aria-hidden="true" style={{
          writingMode: 'vertical-rl', margin: '16px auto 0', fontSize: 12, letterSpacing: 1,
          textTransform: 'uppercase', color: theme.textMuted, userSelect: 'none',
          transform: left ? 'none' : 'rotate(180deg)',
        }}>
          {title}
        </div>
      )}
      <div
        // Fixed width so contents do not reflow while the sidebar animates.
        style={{
          width: SIDEBAR_OPEN_WIDTH - 1,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: theme.pad,
          boxSizing: 'border-box',
          display: open ? 'flex' : 'none',
          flexDirection: 'column',
          gap: theme.gap,
        }}
      >
        {children}
      </div>
    </aside>
  );
};

