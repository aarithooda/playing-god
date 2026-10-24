// Single owner of the sidebar geometry. The 3D canvas stays full-bleed under the sidebars; the camera
// view is shifted so the scene is centred in the free area between them (see UniverseCanvas).

export const SIDEBAR_OPEN_WIDTH = 320;
export const SIDEBAR_RAIL_WIDTH = 40;
/** Below this window width only one sidebar may be open at a time (laptop-and-up is the target). */
export const NARROW_BREAKPOINT = 1100;

export interface SidebarState {
  left: boolean;
  right: boolean;
}

export const sidebarWidth = (open: boolean) => (open ? SIDEBAR_OPEN_WIDTH : SIDEBAR_RAIL_WIDTH);

/** Pixels covered by each sidebar (the free area is what remains between them). */
export function insets(state: SidebarState): { left: number; right: number } {
  return { left: sidebarWidth(state.left), right: sidebarWidth(state.right) };
}

/** How far (px, positive = right) the scene centre moves to sit in the middle of the free area. */
export function sceneShiftPx(left: number, right: number): number {
  return (left - right) / 2;
}

/** On a narrow window both sidebars cannot stay open: the controls win and the left one closes. */
export function enforceNarrow(state: SidebarState, windowWidth: number): SidebarState {
  return windowWidth < NARROW_BREAKPOINT && state.left && state.right ? { left: false, right: true } : state;
}

/** Opens or closes one sidebar, closing the other when the window is narrow. */
export function toggleSidebar(state: SidebarState, side: keyof SidebarState, open: boolean, windowWidth: number): SidebarState {
  const next = { ...state, [side]: open };
  if (open && windowWidth < NARROW_BREAKPOINT) {
    const other: keyof SidebarState = side === 'left' ? 'right' : 'left';
    next[other] = false;
  }
  return next;
}
