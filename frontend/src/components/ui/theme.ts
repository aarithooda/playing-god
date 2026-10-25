// Visual tokens for the instruments around the 3D scene. One place, so every surface reads as one application:
// ink panels over the void, starlight text, and a single sunlight accent kept for selection and primary actions.
// The same values are mirrored as CSS custom properties in index.css (for hover, focus and media-query states).
export const theme = {
  /** The void behind the scene and under every panel. */
  bg: '#04060a',
  /** Panel surface (solid fallback of the translucent ink used by drawers and the bar). */
  surface: '#0c0f15',
  /** Translucent ink for floating surfaces over the scene. */
  glass: 'rgba(12, 15, 21, 0.86)',
  surfaceRaised: '#151a23',
  surfaceHover: '#1b212c',
  border: 'rgba(214, 222, 235, 0.09)',
  borderStrong: 'rgba(214, 222, 235, 0.18)',
  text: '#eeeae0',
  textMuted: '#a7aab2',
  textFaint: '#6e737e',
  /** Sunlight: selection, the active tool, primary actions. Never decoration. */
  accent: '#ebc77f',
  accentInk: '#1b1405',
  accentSoft: 'rgba(235, 199, 127, 0.14)',
  /** Recorded history and other informational states that are not warnings. */
  info: '#8fb3f0',
  danger: '#ee7a78',
  ok: '#7fc79f',
  warn: '#efa25a',
  font: '"Geist", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
  serif: '"Cormorant Garamond", "Iowan Old Style", "Palatino Linotype", Georgia, serif',
  mono: '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  radius: 10,
  gap: 12,
  pad: 14,
} as const;
