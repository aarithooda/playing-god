import { describe, expect, it } from "vitest";
import {
  NARROW_BREAKPOINT,
  enforceNarrow,
  insets,
  sceneShiftPx,
  shellMetrics,
  toggleSidebar,
} from "./layout";

describe("workspace geometry", () => {
  const W = 1440;
  const m = shellMetrics(W);

  it("covers the rail, plus the drawer when it is open, and the inspector only while it is on screen", () => {
    expect(insets({ left: false, right: false }, W, false)).toEqual({ left: m.rail, right: 0 });
    expect(insets({ left: true, right: false }, W, false)).toEqual({ left: m.rail + m.drawer, right: 0 });
    expect(insets({ left: true, right: true }, W, true)).toEqual({ left: m.rail + m.drawer, right: m.inspector });
    // the inspector may be allowed but have nothing to show (no selection): it then takes no space
    expect(insets({ left: false, right: true }, W, false)).toEqual({ left: m.rail, right: 0 });
  });

  it("uses the same breakpoints as the stylesheet", () => {
    expect(shellMetrics(1440)).toEqual({ rail: 64, drawer: 344, inspector: 340, bar: 64 });
    expect(shellMetrics(900)).toEqual({ rail: 64, drawer: 320, inspector: 320, bar: 64 });
    expect(shellMetrics(400)).toEqual({ rail: 56, drawer: 344, inspector: 344, bar: 108 });
  });

  it("on a phone-sized window the panels cover the scene instead of shifting it", () => {
    expect(insets({ left: true, right: true }, 400, true)).toEqual({ left: 56, right: 0 });
  });

  it("shifts the scene centre to the middle of the free area", () => {
    expect(sceneShiftPx(64, 340)).toBe(-138); // inspector open: scene moves left
    expect(sceneShiftPx(408, 0)).toBe(204);
    expect(sceneShiftPx(320, 320)).toBe(0);
    // the free area is [left, W - right]; its centre is W/2 + (left - right)/2
    expect((64 + (W - 340)) / 2).toBe(W / 2 + sceneShiftPx(64, 340));
  });
});

describe("enforceNarrow", () => {
  it("closes the drawer when it and the inspector are open on a narrow window, and otherwise changes nothing", () => {
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

  it("lets the drawer and the inspector be open together on a wide window", () => {
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
