// Regression tests for the Solar System rendering failures: Earth drawn as large as the Sun, Earth changing size when its
// Moon is present (it was capped to 1 px by the planet-moon separation), and planetary paths disappearing. They exercise
// the real calculation path (preset body -> scene body -> on-screen radius) with the real preset bodies, generated from
// the backend presets (tests/validation/test_preset_moons.py checks the fixture is current).
import { describe, expect, it } from "vitest";
import presets from "../test/presetBodies.json";
import { bodyDisplayScale, OVERVIEW_DISTANCE, projectedRadiusPx, zoomGrowth } from "./bodyVisibility";
import { pathsNote, pathTargets } from "./history/pathSelection";
import { DEFAULT_SIZE_MODE, fitTransform, minimumRadiusPx, SIZE_LAWS, SUN_RADIUS_M, type SizeMode } from "./renderTransform";
import { buildSceneBodies } from "./sceneBodies";
import { toSceneBody, type DisplayBody, type SceneBody } from "./viewModel";

type Raw = { id: string; name: string; kind: string; radiusM: number; positionM: { x: number; y: number; z: number }; colorHex: string; bodyType: string | null; assetKey: string | null; primaryId: string | null };
const load = (id: "solar-system-j2000" | "solar-system-moons-j2000"): DisplayBody[] =>
  (presets[id] as Raw[]).map((b) => ({
    id: b.id, name: b.name, kind: b.kind === "star" ? "star" : "planet", colorHex: b.colorHex, positionM: b.positionM, radiusM: b.radiusM,
    ...(b.bodyType ? { bodyType: b.bodyType as DisplayBody["bodyType"] } : {}),
    ...(b.assetKey ? { assetKey: b.assetKey } : {}),
    ...(b.primaryId ? { primaryId: b.primaryId } : {}),
  }));
const plain = load("solar-system-j2000");
const moons = load("solar-system-moons-j2000");
const noMoon = moons.filter((b) => b.id !== "body-moon");
const transform = fitTransform(moons.map((b) => b.positionM)); // the same scale for every scene below: Neptune sets it
const FOV = 50;
const H = 900;
const MODES: SizeMode[] = ["universe", "exploration"];

const by = (bodies: SceneBody[]) => Object.fromEntries(bodies.map((b) => [b.id, b]));
/** On-screen radius in CSS px, computed exactly as CelestialBody does. */
function px(b: SceneBody, distance: number): number {
  const s = bodyDisplayScale(b.radius, distance, FOV, H, { minPx: b.visiblePx, maxGrowth: b.maxGrowth, clearance: b.clearance, systemPx: b.systemPx });
  return projectedRadiusPx(b.radius, distance, FOV, H) * s;
}
const earthOf = (bodies: DisplayBody[], mode: SizeMode) => by(buildSceneBodies(bodies, transform, mode))["body-earth"];
const pxPerUnitAt = (d: number) => H / 2 / Math.tan((FOV * Math.PI) / 360) / d;

describe("the two views", () => {
  it("Universe View is the default and both views are explicit, distinct laws", () => {
    expect(DEFAULT_SIZE_MODE).toBe("universe");
    expect(SIZE_LAWS.exploration.sunPx).toBeGreaterThan(SIZE_LAWS.universe.sunPx);
    expect(minimumRadiusPx(6.371e6, "exploration")).toBeGreaterThan(minimumRadiusPx(6.371e6, "universe"));
  });

  it("geometry is the true radius in both views: radiusM / metersPerUnit", () => {
    for (const mode of MODES) {
      const earth = moons.find((b) => b.id === "body-earth")!;
      expect(toSceneBody(earth, { metersPerUnit: 1e9 }, mode).radius).toBeCloseTo(6371008.4 / 1e9, 12);
      expect(toSceneBody(earth, { metersPerUnit: 2e9 }, mode).radius).toBeCloseTo(6371008.4 / 2e9, 12);
    }
  });

  it("each minimum depends on the body's own radius only, grows with it and stays within the law's bounds", () => {
    for (const mode of MODES) {
      const law = SIZE_LAWS[mode];
      const v = [1e3, 1.7374e6, 6.371e6, 7e7, SUN_RADIUS_M, 7.6e11].map((r) => minimumRadiusPx(r, mode));
      for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1]);
      expect(v[0]).toBe(law.minPx);
      expect(v[v.length - 1]).toBe(law.maxPx);
      expect(minimumRadiusPx(SUN_RADIUS_M, mode)).toBe(law.sunPx);
      expect(minimumRadiusPx(NaN, mode)).toBe(law.minPx);
    }
  });
});

describe("the Earth-with-Moon regression", () => {
  it("ROOT CAUSE: Earth's on-screen size at the overview is the same with and without its Moon, in both views", () => {
    for (const mode of MODES) {
      const withMoon = earthOf(moons, mode);
      const without = earthOf(noMoon, mode);
      expect(withMoon.clearance).toBeGreaterThan(0); // the Moon's separation is known to the renderer...
      expect(px(withMoon, OVERVIEW_DISTANCE)).toBe(px(without, OVERVIEW_DISTANCE)); // ...and must not change the size
      expect(px(withMoon, OVERVIEW_DISTANCE)).toBeCloseTo(minimumRadiusPx(6371008.4, mode), 6);
    }
  });

  it("Earth never falls below its own minimum at any camera distance, with the Moon present", () => {
    for (const mode of MODES) {
      const floor = minimumRadiusPx(6371008.4, mode);
      for (const d of [1000, 200, OVERVIEW_DISTANCE, 40, 10, 1, 0.1, 0.02, 0.005]) {
        expect(px(earthOf(moons, mode), d), `${mode} d=${d}`).toBeGreaterThanOrEqual(floor - 1e-9);
      }
    }
  });

  it("Earth stays visible and distinguishable in Universe View (Sun > Earth > Moon, Earth well above a pixel)", () => {
    const s = by(buildSceneBodies(moons, transform, "universe"));
    const [sun, earth, moon] = [s["body-sun"], s["body-earth"], s["body-moon"]].map((b) => px(b, OVERVIEW_DISTANCE));
    expect(earth).toBeGreaterThan(1.5);
    expect(sun / earth).toBeGreaterThan(4);
    expect(earth).toBeGreaterThan(moon);
    // The geometry itself is true scale: ~109x and ~3.7x.
    expect(s["body-sun"].radius / s["body-earth"].radius).toBeCloseTo(6.957e8 / 6371008.4, 6);
    expect(s["body-earth"].radius / s["body-moon"].radius).toBeCloseTo(6371008.4 / 1737400, 6);
  });

  it("Earth and Moon are both distinguishable in Exploration View: at the overview and when framing the system", () => {
    const s = by(buildSceneBodies(moons, transform, "exploration"));
    expect(px(s["body-earth"], OVERVIEW_DISTANCE)).toBeGreaterThan(px(s["body-moon"], OVERVIEW_DISTANCE));
    expect(px(s["body-moon"], OVERVIEW_DISTANCE)).toBeGreaterThanOrEqual(SIZE_LAWS.exploration.minPx);
    const d = 0.02; // a camera that frames the Earth-Moon system
    const earth = px(s["body-earth"], d);
    const moon = px(s["body-moon"], d);
    const separationPx = s["body-earth"].clearance! * pxPerUnitAt(d);
    expect(earth).toBeGreaterThan(px(s["body-earth"], OVERVIEW_DISTANCE)); // grew while zooming in
    expect(earth).toBeGreaterThan(moon);
    expect(moon).toBeGreaterThan(SIZE_LAWS.exploration.minPx);
    expect(earth).toBeLessThanOrEqual(0.35 * separationPx + 1e-9); // the planet does not swallow its Moon
    expect(earth / moon).toBeGreaterThan(1.2); // the ratio is kept (both share one growth factor)
  });

  it("the Sun/Earth hierarchy matches the view: Universe View makes the Sun the more dominant", () => {
    const ratio = (mode: SizeMode) => {
      const s = by(buildSceneBodies(moons, transform, mode));
      return px(s["body-sun"], OVERVIEW_DISTANCE) / px(s["body-earth"], OVERVIEW_DISTANCE);
    };
    expect(ratio("universe")).toBeGreaterThan(4);
    expect(ratio("exploration")).toBeGreaterThan(2.5);
    expect(ratio("universe")).toBeGreaterThan(ratio("exploration"));
  });

  it("Jupiter's moons do not collapse Jupiter, and Jupiter does not swallow them when zoomed in (Exploration)", () => {
    const s = by(buildSceneBodies(moons, transform, "exploration"));
    const withoutIo = by(buildSceneBodies(moons.filter((b) => b.id !== "body-io"), transform, "exploration"));
    expect(px(s["body-jupiter"], OVERVIEW_DISTANCE)).toBe(px(withoutIo["body-jupiter"], OVERVIEW_DISTANCE));
    const d = 0.2;
    const sep = s["body-jupiter"].clearance! * pxPerUnitAt(d);
    expect(px(s["body-jupiter"], d)).toBeLessThanOrEqual(Math.max(0.35 * sep, minimumRadiusPx(6.9911e7, "exploration")) + 1e-9);
    expect(px(s["body-io"], d)).toBeGreaterThan(SIZE_LAWS.exploration.minPx);
  });
});

describe("stable scale and deterministic mode switching", () => {
  const key = (b: SceneBody) => [b.radius, b.visiblePx, b.maxGrowth];

  it("every shared body has identical size data in the original and the moons preset, per view", () => {
    for (const mode of MODES) {
      const a = by(buildSceneBodies(plain, transform, mode));
      const b = by(buildSceneBodies(moons, transform, mode));
      for (const id of Object.keys(a)) expect(key(b[id]), `${mode} ${id}`).toEqual(key(a[id]));
    }
  });

  it("adding an unrelated body leaves every other body's rendered size unchanged at any camera distance", () => {
    const extra: DisplayBody = { id: "x", name: "x", kind: "planet", colorHex: "#fff", positionM: { x: 1.5e11, y: 1e9, z: 0 }, radiusM: 1e6 };
    for (const mode of MODES) {
      const before = by(buildSceneBodies(moons, transform, mode));
      const after = by(buildSceneBodies([...moons, extra], transform, mode));
      for (const id of Object.keys(before)) for (const d of [OVERVIEW_DISTANCE, 5, 0.02]) expect(px(after[id], d), `${mode} ${id} ${d}`).toBe(px(before[id], d));
    }
  });

  it("switching views and back returns exactly the original sizes; the views differ intentionally", () => {
    const first = buildSceneBodies(moons, transform, "universe");
    buildSceneBodies(moons, transform, "exploration");
    const again = buildSceneBodies(moons, transform, "universe");
    expect(again).toEqual(first);
    const u = by(first);
    const e = by(buildSceneBodies(moons, transform, "exploration"));
    for (const id of Object.keys(u)) {
      expect(e[id].radius).toBe(u[id].radius); // same geometry
      expect(e[id].visiblePx!).toBeGreaterThanOrEqual(u[id].visiblePx!); // Exploration is never smaller at the overview
    }
    expect(e["body-earth"].visiblePx).toBeGreaterThan(u["body-earth"].visiblePx!);
  });

  it("scene bodies are a pure function of bodies, scale and view (camera framing never enters)", () => {
    for (const mode of MODES) expect(buildSceneBodies(moons, transform, mode)).toEqual(buildSceneBodies(moons, transform, mode));
  });

  it("zoom growth is 1 at the overview, none in Universe View, and capped in Exploration View", () => {
    expect(zoomGrowth(OVERVIEW_DISTANCE, 8)).toBe(1);
    expect(zoomGrowth(1000, 8)).toBe(1);
    expect(zoomGrowth(OVERVIEW_DISTANCE / 4, 8)).toBeCloseTo(2);
    expect(zoomGrowth(1e-9, 8)).toBe(8);
    expect(zoomGrowth(0.01, 1)).toBe(1);
    expect(zoomGrowth(NaN, 8)).toBe(1);
  });
});

describe("parent-moon relationships", () => {
  it("systems share one clearance and growth factor; unrelated bodies and missing primaries have none", () => {
    const s = by(buildSceneBodies(moons, transform, "exploration"));
    expect(s["body-earth"].clearance).toBe(s["body-moon"].clearance);
    expect(s["body-earth"].systemPx).toBe(s["body-moon"].systemPx);
    expect(s["body-io"].clearance).toBe(s["body-jupiter"].clearance);
    expect(s["body-sun"].clearance).toBeUndefined();
    expect(s["body-mars"].clearance).toBeUndefined();
    const orphan = by(buildSceneBodies(moons.filter((b) => b.id !== "body-earth"), transform, "exploration"));
    expect(orphan["body-moon"].clearance).toBeUndefined(); // the primary is not in the scene
  });

  it("the system limit applies only to growth: it never lowers a body below its minimum", () => {
    for (const d of [10, 200]) {
      const o = { minPx: 4, maxGrowth: 8, clearance: 1e-6, systemPx: 4 };
      expect(bodyDisplayScale(1e-5, d, FOV, H, o) * projectedRadiusPx(1e-5, d, FOV, H)).toBeCloseTo(4, 9);
    }
  });
});

describe("orbit paths", () => {
  const ids = (list: DisplayBody[]) => list.map((b) => b.id);
  const moonIds = new Set(moons.filter((b) => b.primaryId).map((b) => b.id));
  const planets = moons.filter((b) => !b.primaryId).map((b) => b.id);

  it("the original preset: every body's path, or the selected body's (unchanged)", () => {
    expect(pathTargets(ids(plain), undefined)).toEqual(ids(plain));
    expect(pathTargets(ids(plain), "body-earth")).toEqual(["body-earth"]);
  });

  it("the moons preset: every planet's path stays visible, selected or not (the rule is independent of the view)", () => {
    expect(pathTargets(ids(moons), undefined, moonIds)).toEqual(planets);
    expect(pathTargets(ids(moons), "body-earth", moonIds)).toEqual(planets);
    expect(pathTargets(ids(moons), "body-saturn", moonIds)).toEqual(planets);
    expect(planets).toHaveLength(9);
    expect(planets).toContain("body-neptune");
  });

  it("a selected moon adds its own path and removes no planet's", () => {
    expect(pathTargets(ids(moons), "body-moon", moonIds)).toEqual([...planets, "body-moon"]);
    expect(pathTargets(ids(moons), "body-gone", moonIds)).toEqual(planets);
  });

  it("custom bodies added to the moons preset keep every planet path (moons never count towards the crowd limit)", () => {
    const five = Array.from({ length: 5 }, (_, i) => `x${i}`);
    expect(pathTargets([...ids(moons), ...five], undefined, moonIds)).toEqual([...planets, ...five]);
    expect(pathTargets([...ids(moons), "a", "b", "c"], undefined)).toEqual([]); // the old rule hid everything at 22 bodies
    expect(pathTargets([...ids(moons), "a", "b", "c"], undefined, moonIds)).toHaveLength(12);
    expect(pathTargets([...ids(moons), ...Array.from({ length: 30 }, (_, i) => `x${i}`)], undefined, moonIds)).toEqual([]); // genuinely crowded
  });

  it("the crowd note is not shown for a moons scene", () => {
    expect(pathsNote(true, 19, undefined, true)).toBeUndefined();
    expect(pathsNote(true, 25, undefined, false)).toMatch(/Select a body/);
  });
});
