// Visual tokens for the instruments around the 3D scene. One place, so every surface reads as one application:
// ink panels over the void, starlight text, and a single sunlight accent kept for selection and primary actions.
// Colours are CSS custom properties (defined for both themes in index.css, `:root` = dark, `:root[data-theme="light"]` =
// light), so every inline style that reads `theme.*` follows the active theme without re-rendering. The 3D scene itself is
// space and stays dark in both themes; `onSpace*` tokens are for text drawn directly on it (never on a panel).
export const theme = {
  /** The void behind the scene and under every panel. */
  bg: 'var(--void)',
  /** Panel surface (solid fallback of the translucent ink used by drawers and the bar). */
  surface: 'var(--ink-solid)',
  /** Translucent ink for floating surfaces over the scene. */
  glass: 'var(--ink)',
  surfaceRaised: 'var(--raised)',
  surfaceHover: 'var(--hover)',
  border: 'var(--line)',
  borderStrong: 'var(--line-strong)',
  text: 'var(--text)',
  textMuted: 'var(--text-muted)',
  textFaint: 'var(--text-faint)',
  /** Sunlight: selection, the active tool, primary actions. Never decoration. */
  accent: 'var(--accent)',
  accentInk: 'var(--accent-ink)',
  accentSoft: 'var(--accent-soft)',
  /** Selected-item outline (accent at partial strength). */
  accentLine: 'var(--accent-line)',
  /** Recorded history and other informational states that are not warnings. */
  info: 'var(--info)',
  danger: 'var(--danger)',
  /** Faint fill for danger surfaces and the border of a danger button. */
  dangerSoft: 'var(--danger-soft)',
  dangerLine: 'var(--danger-line)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  /** Barely-there fills that lift a surface off its parent (cards, list rows). */
  tint: 'var(--tint)',
  tintStrong: 'var(--tint-strong)',
  /** Drop shadows of floating surfaces. */
  shadow: 'var(--shadow)',
  shadowSmall: 'var(--shadow-small)',
  /** Text drawn straight on the (always dark) 3D scene. */
  onSpace: 'var(--on-space)',
  onSpaceShadow: 'var(--on-space-shadow)',
  font: '"Geist", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
  serif: '"Cormorant Garamond", "Iowan Old Style", "Palatino Linotype", Georgia, serif',
  mono: '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  radius: 10,
  gap: 12,
  pad: 14,
} as const;
