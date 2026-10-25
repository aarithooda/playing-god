import React from 'react';

// One icon family for the whole app: 20 px grid, 1.6 px round strokes, no fills except where a glyph needs mass
// (play, the light mark). Icons are always decorative here: the button that carries one also carries a name.
export type IconName =
  | 'play' | 'pause' | 'step' | 'reset' | 'axes' | 'grid' | 'paths' | 'fit' | 'focus' | 'create' | 'universes'
  | 'orbitlab' | 'events' | 'history' | 'diagnostics' | 'close' | 'sound' | 'soundOff' | 'light' | 'chevron' | 'trash'
  | 'guides' | 'belt' | 'sun' | 'moon';

const PATHS: Record<IconName, React.ReactNode> = {
  play: <path d="M7 4.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L7.9 4.3a.6.6 0 0 0-.9.5Z" fill="currentColor" stroke="none" />,
  pause: <><rect x="5.5" y="4.5" width="3" height="11" rx="1" fill="currentColor" stroke="none" /><rect x="11.5" y="4.5" width="3" height="11" rx="1" fill="currentColor" stroke="none" /></>,
  step: <><path d="M5 5.2v9.6a.5.5 0 0 0 .8.4l6.6-4.8a.5.5 0 0 0 0-.8L5.8 4.8a.5.5 0 0 0-.8.4Z" fill="currentColor" stroke="none" /><path d="M15 4.5v11" /></>,
  reset: <><path d="M4.5 10a5.5 5.5 0 1 0 1.7-4" /><path d="M4.2 3.6v3h3" /></>,
  axes: <><path d="M10 10V3.5" /><path d="M10 10l5.6 3.2" /><path d="M10 10l-5.6 3.2" /><circle cx="10" cy="10" r="1" fill="currentColor" /></>,
  grid: <><path d="M3.5 7.2h13M3.5 12.8h13M7.2 3.5v13M12.8 3.5v13" /></>,
  paths: <><ellipse cx="10" cy="10" rx="7" ry="4" transform="rotate(-18 10 10)" strokeDasharray="2.2 2" /><circle cx="15.6" cy="7.2" r="1.6" fill="currentColor" stroke="none" /></>,
  fit: <><path d="M3.5 7V4.5a1 1 0 0 1 1-1H7M13 3.5h2.5a1 1 0 0 1 1 1V7M16.5 13v2.5a1 1 0 0 1-1 1H13M7 16.5H4.5a1 1 0 0 1-1-1V13" /><circle cx="10" cy="10" r="2.2" /></>,
  focus: <><circle cx="10" cy="10" r="5.5" /><circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2" /></>,
  create: <><circle cx="10" cy="10" r="6.5" /><path d="M10 7v6M7 10h6" /></>,
  universes: <><circle cx="10" cy="10" r="2" /><ellipse cx="10" cy="10" rx="7.5" ry="3" /><ellipse cx="10" cy="10" rx="7.5" ry="3" transform="rotate(60 10 10)" /></>,
  orbitlab: <><circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" /><circle cx="10" cy="10" r="4.5" /><circle cx="10" cy="10" r="7" strokeDasharray="2 2.2" /></>,
  events: <><circle cx="8" cy="11" r="3.2" /><circle cx="13.6" cy="7.4" r="2" /><path d="M11.2 9.2l.9-.6M15.5 12.5l1.5.8M14 14.6l.6 1.6M4 5.5l1.2 1" /></>,
  history: <><path d="M3.8 10a6.2 6.2 0 1 0 1.9-4.5" /><path d="M3.4 3.6v2.9h2.9" /><path d="M10 6.6V10l2.4 1.6" /></>,
  diagnostics: <><path d="M2.5 10.5h3l2-5 3 9 2-6 1.5 2h3.5" /></>,
  close: <><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></>,
  sound: <><path d="M4 8h2.6L10 5v10l-3.4-3H4z" /><path d="M13 7.5a3.5 3.5 0 0 1 0 5M15 5.5a6.4 6.4 0 0 1 0 9" /></>,
  soundOff: <><path d="M4 8h2.6L10 5v10l-3.4-3H4z" /><path d="M13.2 8l3.6 4M16.8 8l-3.6 4" /></>,
  light: <><circle cx="10" cy="10" r="2.6" fill="currentColor" stroke="none" /><path d="M10 2v3.2M10 14.8V18M2 10h3.2M14.8 10H18M4.4 4.4l2 2M13.6 13.6l2 2M4.4 15.6l2-2M13.6 6.4l2-2" opacity=".75" /></>,
  chevron: <path d="M7.5 5l5 5-5 5" />,
  guides: <><circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" /><ellipse cx="10" cy="10" rx="4.2" ry="2.6" /><ellipse cx="10" cy="10" rx="7.5" ry="4.8" /></>,
  belt: <><circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" />{[0, 40, 80, 120, 160, 200, 240, 280, 320].map((a) => <circle key={a} cx={10 + 6.6 * Math.cos((a * Math.PI) / 180)} cy={10 + 4.2 * Math.sin((a * Math.PI) / 180)} r="0.75" fill="currentColor" stroke="none" />)}</>,
  sun: <><circle cx="10" cy="10" r="3.4" /><path d="M10 2.6v2M10 15.4v2M2.6 10h2M15.4 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M4.8 15.2l1.4-1.4M13.8 6.2l1.4-1.4" /></>,
  moon: <path d="M15.8 11.6A6.4 6.4 0 0 1 8.4 4.2a6.4 6.4 0 1 0 7.4 7.4Z" />,
  trash: <><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" /></>,
};

export const Icon: React.FC<{ name: IconName; size?: number; style?: React.CSSProperties }> = ({ name, size = 20, style }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: 'block', flex: '0 0 auto', ...style }}
  >
    {PATHS[name]}
  </svg>
);
