import { describe, expect, it } from "vitest";
import {
  NARROW_BREAKPOINT,
  SIDEBAR_OPEN_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  enforceNarrow,
  insets,
  sceneShiftPx,
  toggleSidebar,
} from "./layout";

describe("sidebar geometry", () => {
  it("covers the open width or the rail width", () => {
    expect(insets({ left: true, right: false })).toEqual({ left: SIDEBAR_OPEN_WIDTH, right: SIDEBAR_RAIL_WIDTH });
    expect(insets({ left: false, right: true })).toEqual({ left: SIDEBAR_RAIL_WIDTH, right: SIDEBAR_OPEN_WIDTH });
  });

  it("shifts the scene centre to the middle of the free area", () => {
    expect(sceneShiftPx(40, 320)).toBe(-140); // right sidebar open: scene moves left
    expect(sceneShiftPx(320, 40)).toBe(140);
    expect(sceneShiftPx(320, 320)).toBe(0);
    // the free area is [left, W - right]; its centre is W/2 + (left - right)/2
    const W = 1280;
    expect((40 + (W - 320)) / 2).toBe(W / 2 + sceneShiftPx(40, 320));
  });
});

describe("enforceNarrow", () => {
  it("closes the left sidebar when both are open on a narrow window, and otherwise changes nothing", () => {
    expect(enforceNarrow({ left: true, right: true }, NARROW_BREAKPOINT - 1)).toEqual({ left: false, right: true });
    const wide = { left: true, right: true };
    expect(enforceNarrow(wide, NARROW_BREAKPOINT)).toBe(wide);
    const one = { left: true, right: false };
    expect(enforceNarrow(one, 600)).toBe(one);
  });
});

describe("toggleSidebar", () => {
  const wide = NARROW_BREAKPOINT + 1;
  const narrow = NARROW_BREAKPOINT - 1;

  it("lets both sidebars be open on a wide window", () => {
    expect(toggleSidebar({ left: false, right: true }, "left", true, wide)).toEqual({ left: true, right: true });
  });

  it("opening one closes the other on a narrow window", () => {
    expect(toggleSidebar({ left: false, right: true }, "left", true, narrow)).toEqual({ left: true, right: false });
    expect(toggleSidebar({ left: true, right: false }, "right", true, narrow)).toEqual({ left: false, right: true });
  });

  it("closing never opens the other one", () => {
    expect(toggleSidebar({ left: true, right: true }, "left", false, narrow)).toEqual({ left: false, right: true });
  });
});
