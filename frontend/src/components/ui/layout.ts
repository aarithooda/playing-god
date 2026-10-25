// Single owner of the workspace geometry. The 3D canvas stays full-bleed under every panel; the camera view is
// shifted so the scene is centred in the free area between the left tool rail + drawer and the right inspector
// (see UniverseCanvas). The numbers mirror the CSS custom properties in index.css, breakpoint for breakpoint.

/** Below this window width the drawer and the inspector are never open together. */
export const NARROW_BREAKPOINT = 1100;

export interface ShellMetrics {
  rail: number;
  drawer: number;
  inspector: number;
  bar: number;
}

/** Widths of the shell surfaces at a window width (the same breakpoints as index.css). */
export function shellMetrics(windowWidth: number): ShellMetrics {
  if (windowWidth <= 760) {
    const rail = 56;
    return { rail, drawer: Math.max(0, windowWidth - rail), inspector: Math.max(0, windowWidth - rail), bar: 108 };
  }
  if (windowWidth <= 1000) return { rail: 64, drawer: 320, inspector: 320, bar: 64 };
  return { rail: 64, drawer: 344, inspector: 340, bar: 64 };
}

/** `left`: the tool drawer is open. `right`: the inspector may show (it does whenever a body is selected). */
export interface SidebarState {
  left: boolean;
  right: boolean;
}

/** Pixels covered on each side. `inspectorVisible` is whether the inspector is actually on screen. */
export function insets(state: SidebarState, windowWidth: number, inspectorVisible: boolean): { left: number; right: number } {
  const m = shellMetrics(windowWidth);
  // On a phone-sized window the panels cover the scene instead of sharing it; keep the scene centred on the window.
  if (windowWidth <= 760) return { left: m.rail, right: 0 };
  return { left: m.rail + (state.left ? m.drawer : 0), right: state.right && inspectorVisible ? m.inspector : 0 };
}

/** How far (px, positive = right) the scene centre moves to sit in the middle of the free area. */
export function sceneShiftPx(left: number, right: number): number {
  return (left - right) / 2;
}

/** On a narrow window the drawer and the inspector cannot both stay open: the inspector wins. */
export function enforceNarrow(state: SidebarState, windowWidth: number): SidebarState {
  return windowWidth < NARROW_BREAKPOINT && state.left && state.right ? { left: false, right: true } : state;
}

/** Opens or closes one side, closing the other when the window is narrow. */
export function toggleSidebar(state: SidebarState, side: keyof SidebarState, open: boolean, windowWidth: number): SidebarState {
  const next = { ...state, [side]: open };
  if (open && windowWidth < NARROW_BREAKPOINT) {
    const other: keyof SidebarState = side === 'left' ? 'right' : 'left';
    next[other] = false;
  }
  return next;
}
