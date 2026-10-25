import React from 'react';
import { Icon, type IconName } from './Icon';
import { useTheme } from '../../sim/useTheme';

export type ToolId = 'create' | 'universes' | 'orbitlab' | 'events' | 'history' | 'diagnostics';

export interface ToolDef {
  id: ToolId;
  /** Short label under the icon; also the button's accessible name. */
  label: string;
  icon: IconName;
  /** What the drawer is about, shown as its title. */
  title: string;
  description: string;
}

/** Ordered from making things to examining them; diagnostics sit last because they are for checking, not playing. */
export const TOOLS: readonly ToolDef[] = [
  { id: 'create', label: 'Add', icon: 'create', title: 'Add bodies', description: 'Pick a catalogue body or define your own, then place it.' },
  { id: 'universes', label: 'Universes', icon: 'universes', title: 'Universes', description: 'Switch universes, load a preset, save snapshots.' },
  { id: 'orbitlab', label: 'Orbit Lab', icon: 'orbitlab', title: 'Orbit Lab', description: 'Compare a baseline orbit with a modified run.' },
  { id: 'events', label: 'Events', icon: 'events', title: 'Events', description: 'Collisions and mergers, newest first.' },
  { id: 'history', label: 'History', icon: 'history', title: 'History', description: 'Scrub and replay what the backend recorded.' },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'diagnostics', title: 'Diagnostics', description: 'Whole-system totals computed by the backend.' },
];

/** Light/dark switch at the foot of the rail (dark is the default; the choice is remembered in this browser). */
export const ThemeToggle: React.FC = () => {
  const { theme, toggle } = useTheme();
  const light = theme === 'light';
  return (
    <button
      type="button"
      className="pg-rail__btn"
      data-testid="theme-toggle"
      aria-pressed={light}
      aria-label="Light theme"
      title={light ? 'Light theme is on: switch back to dark' : 'Switch to the light theme'}
      onClick={toggle}
    >
      <Icon name={light ? 'sun' : 'moon'} size={21} />
      <span aria-hidden="true">{light ? 'Light' : 'Dark'}</span>
    </button>
  );
};

interface ToolRailProps {
  activeTool: ToolId;
  drawerOpen: boolean;
  onSelect: (tool: ToolId) => void;
  /** Small counts shown on a tool (for example the number of events). */
  badges?: Partial<Record<ToolId, number>>;
}

/** The left edge of the workspace: one button per tool. Pressing the open tool closes the drawer. */
export const ToolRail: React.FC<ToolRailProps> = ({ activeTool, drawerOpen, onSelect, badges = {} }) => (
  <nav className="pg-rail" aria-label="Tools">
    <div className="pg-rail__mark" aria-hidden="true" title="Playing God">
      <Icon name="light" size={24} />
    </div>
    {TOOLS.map((tool, index) => {
      const pressed = drawerOpen && activeTool === tool.id;
      const badge = badges[tool.id];
      return (
        <React.Fragment key={tool.id}>
          {index === TOOLS.length - 1 && <span className="pg-rail__spacer" aria-hidden="true" />}
          <button
            type="button"
            className="pg-rail__btn"
            aria-pressed={pressed}
            aria-controls="tool-drawer"
            aria-label={badge ? `${tool.label} (${badge})` : tool.label}
            title={tool.description}
            onClick={() => onSelect(tool.id)}
          >
            <Icon name={tool.icon} size={21} />
            <span aria-hidden="true">{tool.label}</span>
            {badge ? <span className="pg-rail__badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</span> : null}
          </button>
        </React.Fragment>
      );
    })}
    <ThemeToggle />
  </nav>
);
