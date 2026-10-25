import React from 'react';
import { Icon } from './Icon';
import { TOOLS, type ToolId } from './ToolRail';

interface ToolDrawerProps {
  open: boolean;
  tool: ToolId;
  onClose: () => void;
  /** The content of every tool. All of it stays mounted (drafts, placement and form state survive a switch); only the
   *  active tool is shown, and nothing is shown while the drawer is closed. */
  sections: Record<ToolId, React.ReactNode>;
}

/** The single left drawer beside the tool rail. */
export const ToolDrawer: React.FC<ToolDrawerProps> = ({ open, tool, onClose, sections }) => {
  const def = TOOLS.find((t) => t.id === tool) ?? TOOLS[0]!;
  return (
    <aside
      id="tool-drawer"
      className="pg-drawer"
      aria-label={def.title}
      data-testid="sidebar-left"
      data-open={open}
      data-tool={tool}
    >
      <div className="pg-panel-head">
        <div>
          <h2>{def.title}</h2>
          <p>{def.description}</p>
        </div>
        <button type="button" className="pg-icon-btn pg-icon-btn--sm" aria-label={`Close ${def.title}`} title="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {TOOLS.map((t) => (
        <div
          key={t.id}
          className="pg-panel-body"
          data-testid={`drawer-${t.id}`}
          style={{ display: open && t.id === tool ? 'flex' : 'none' }}
        >
          {sections[t.id]}
        </div>
      ))}
    </aside>
  );
};
